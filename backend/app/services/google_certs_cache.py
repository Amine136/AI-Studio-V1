"""In-process HTTP cache for Google's public signing certificates.

``google.oauth2.id_token.verify_firebase_token`` calls ``_fetch_certs`` on every
single invocation, which means one outbound HTTPS round-trip to
``www.googleapis.com`` for *every* authenticated API request. On Cloud Run that
is 50-200ms of added latency per request plus a hard dependency on an external
host inside our auth path: if googleapis.com blips, every request 401s.

The upstream docs recommend fixing this by wrapping the transport in
``cachecontrol``. We deliberately do not, because it pulls in a new third-party
dependency (plus ``requests``/``msgpack``) purely to memoize two URLs that never
vary by caller. This module is the same idea in ~100 lines with no new deps.

Why cache the certs and not the decoded claims: a claims cache would keep a
revoked, suspended, or deleted user authenticated until the entry expired. A
cert cache cannot weaken verification at all -- signature, ``aud``, ``iss`` and
``exp`` are still checked in full on every request. The only failure mode is the
opposite direction (briefly rejecting a token signed by a key we have not seen
yet), and the refresh-on-miss behaviour below makes even that self-healing.

Google rotates these keys on the order of once per day and advertises the
remaining lifetime in the response's ``Cache-Control: max-age`` header, which we
honour rather than guess at.
"""

from __future__ import annotations

import http.client as http_client
import threading
import time
from typing import Any, Dict, Optional, Tuple

# Only these two URLs are ever cached. Anything else this transport is asked to
# fetch is passed straight through, so the wrapper stays safe to use as a
# general-purpose google.auth transport.
_CACHEABLE_URLS = frozenset(
    {
        "https://www.googleapis.com/oauth2/v1/certs",
        "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com",
    }
)

# Floor/ceiling applied to whatever max-age the server advertises. The floor
# stops a pathologically small max-age from degenerating back into fetch-per-
# request; the ceiling bounds how long we can lag behind a key rotation.
_MIN_TTL_SECONDS = 300
_MAX_TTL_SECONDS = 6 * 60 * 60
_DEFAULT_TTL_SECONDS = 3600

# How long past expiry a cached copy may still be served *if* the network is
# down. Serving a stale-but-valid cert set degrades gracefully (tokens signed by
# older keys keep working) instead of taking all authentication offline.
_STALE_GRACE_SECONDS = 12 * 60 * 60

# Minimum spacing between *forced* refreshes (see request_refresh). A forced
# refresh is triggered by an incoming token we cannot verify against the cached
# certs, which means an unauthenticated caller controls when it fires. Without a
# floor here that is an amplification vector: one cheap request in, one outbound
# HTTPS fetch to googleapis.com out, plus a cache flush that penalises every
# other user. Google rotates keys about once a day, so one forced refresh per
# minute is far more headroom than a genuine rotation needs.
_REFRESH_MIN_INTERVAL_SECONDS = 60


def is_unknown_key_error(exc: BaseException) -> bool:
    """True if ``exc`` means "the signing key is not in the cert set we hold".

    This is the one error a cert refresh can plausibly fix, and it is the only
    error allowed to trigger one. Matched narrowly against ``google.auth.jwt``'s
    ``"Certificate for key id {kid} not found."`` — requiring *both* fragments,
    because a bare ``"not found"`` substring test would also catch unrelated
    ValueErrors and widen what an attacker can use to force a fetch.

    Note this check is deliberately not the only line of defence. In
    ``google.auth.jwt.decode`` the key-id lookup happens *before* signature
    verification, so a token with a random ``kid`` and a garbage signature
    reaches this error without being valid in any way. Classification narrows
    *which* errors may refresh; ``request_refresh``'s throttle bounds how often
    that can actually happen.
    """
    if not isinstance(exc, ValueError):
        return False
    message = str(exc).lower()
    return "not found" in message and "key id" in message


class _CachedResponse:
    """Minimal stand-in for ``google.auth.transport.Response``.

    ``_fetch_certs`` only touches ``.status`` and ``.data``; ``.headers`` is
    carried along so the object is indistinguishable from a real response to any
    other caller.
    """

    __slots__ = ("status", "headers", "data")

    def __init__(self, status: int, headers: Dict[str, str], data: bytes) -> None:
        self.status = status
        self.headers = headers
        self.data = data


def _parse_max_age(headers: Any) -> Optional[int]:
    """Extract ``max-age`` from a Cache-Control header, if usable.

    Returns ``None`` when the header is absent, unparseable, or explicitly
    forbids caching (``no-store``/``no-cache``), in which case the caller falls
    back to the default TTL.
    """
    if not headers:
        return None

    raw = None
    getter = getattr(headers, "get", None)
    if callable(getter):
        # requests uses a CaseInsensitiveDict; urllib3-backed transports may not,
        # so try both spellings before giving up.
        raw = getter("cache-control") or getter("Cache-Control")
    if not raw:
        return None

    directives = str(raw).lower()
    if "no-store" in directives or "no-cache" in directives:
        return None

    for part in directives.split(","):
        part = part.strip()
        if not part.startswith("max-age"):
            continue
        _, _, value = part.partition("=")
        try:
            return int(value.strip())
        except ValueError:
            return None
    return None


class CachingTransportRequest:
    """A ``google.auth.transport.Request`` that memoizes Google's cert endpoints.

    Wraps an existing transport rather than replacing it, so TLS, retries and
    proxy behaviour are unchanged. Instances are thread-safe and intended to be
    created once at import time and shared.
    """

    def __init__(self, inner: Any) -> None:
        self._inner = inner
        self._lock = threading.Lock()
        # url -> (expires_at_monotonic, fetched_at_monotonic, response)
        self._cache: Dict[str, Tuple[float, float, _CachedResponse]] = {}
        # Serialises refreshes so a burst of concurrent requests arriving on a
        # cold/expired cache produces one upstream fetch, not N.
        self._refresh_locks: Dict[str, threading.Lock] = {}
        self._hits = 0
        self._misses = 0
        # Timestamp of the last caller-forced refresh, and how many were refused
        # by the throttle. Counters are diagnostic: a climbing refusal count on a
        # healthy service means someone is spraying bad tokens.
        self._last_forced_refresh: Optional[float] = None
        self._forced_refreshes = 0
        self._forced_refreshes_throttled = 0

    def _refresh_lock_for(self, url: str) -> threading.Lock:
        with self._lock:
            lock = self._refresh_locks.get(url)
            if lock is None:
                lock = threading.Lock()
                self._refresh_locks[url] = lock
            return lock

    def _get_fresh(self, url: str, now: float) -> Optional[_CachedResponse]:
        with self._lock:
            entry = self._cache.get(url)
            if entry and entry[0] > now:
                self._hits += 1
                return entry[2]
        return None

    def _get_stale(self, url: str, now: float) -> Optional[_CachedResponse]:
        with self._lock:
            entry = self._cache.get(url)
            if entry and (now - entry[1]) <= _STALE_GRACE_SECONDS:
                return entry[2]
        return None

    def __call__(self, url: str, method: str = "GET", *args: Any, **kwargs: Any) -> Any:
        # Never cache anything but plain reads of the known cert endpoints.
        if method.upper() != "GET" or url not in _CACHEABLE_URLS:
            return self._inner(url, method=method, *args, **kwargs)

        now = time.monotonic()
        cached = self._get_fresh(url, now)
        if cached is not None:
            return cached

        with self._refresh_lock_for(url):
            # Another thread may have refreshed while we waited for the lock.
            now = time.monotonic()
            cached = self._get_fresh(url, now)
            if cached is not None:
                return cached

            try:
                response = self._inner(url, method=method, *args, **kwargs)
            except Exception:
                # Network/transport failure: fall back to a stale copy if we have
                # one, otherwise let the caller see the original error.
                stale = self._get_stale(url, time.monotonic())
                if stale is not None:
                    return stale
                raise

            status = getattr(response, "status", None)
            data = getattr(response, "data", None)
            if status != http_client.OK or not data:
                # Non-200 responses are not cached. Prefer a stale copy over
                # propagating a transient upstream 5xx into an auth failure.
                stale = self._get_stale(url, time.monotonic())
                if stale is not None:
                    return stale
                return response

            headers = getattr(response, "headers", None)
            ttl = _parse_max_age(headers)
            if ttl is None:
                ttl = _DEFAULT_TTL_SECONDS
            ttl = max(_MIN_TTL_SECONDS, min(_MAX_TTL_SECONDS, ttl))

            snapshot = _CachedResponse(
                status=status,
                headers=dict(headers.items()) if hasattr(headers, "items") else {},
                data=bytes(data),
            )
            fetched_at = time.monotonic()
            with self._lock:
                self._misses += 1
                self._cache[url] = (fetched_at + ttl, fetched_at, snapshot)
            return snapshot

    def invalidate(self, url: Optional[str] = None) -> None:
        """Drop cached certs. Used to force a re-fetch after a rotation."""
        with self._lock:
            if url is None:
                self._cache.clear()
            else:
                self._cache.pop(url, None)

    def request_refresh(self, url: Optional[str] = None) -> bool:
        """Invalidate on behalf of a failed verification, at most once a minute.

        Separate from :meth:`invalidate` (which is unconditional and for internal
        or administrative use) because this one is reachable by anyone who can
        send an HTTP request. Returns ``True`` if the cache was actually dropped,
        ``False`` if the throttle refused — letting the caller skip a retry it
        knows would verify against the exact same cert set.

        The window is global rather than per-URL or per-caller: per-caller would
        be trivially defeated by rotating source IPs, and there is nothing to
        gain from tracking the two cert URLs independently.
        """
        now = time.monotonic()
        with self._lock:
            last = self._last_forced_refresh
            if last is not None and (now - last) < _REFRESH_MIN_INTERVAL_SECONDS:
                self._forced_refreshes_throttled += 1
                return False
            self._last_forced_refresh = now
            self._forced_refreshes += 1
            if url is None:
                self._cache.clear()
            else:
                self._cache.pop(url, None)
        return True

    def stats(self) -> Dict[str, Any]:
        """Cache counters, surfaced for health/debug endpoints."""
        now = time.monotonic()
        with self._lock:
            return {
                "hits": self._hits,
                "misses": self._misses,
                "forced_refreshes": self._forced_refreshes,
                "forced_refreshes_throttled": self._forced_refreshes_throttled,
                "entries": {
                    url: {"expires_in": round(expires_at - now, 1)}
                    for url, (expires_at, _fetched_at, _resp) in self._cache.items()
                },
            }


def verify_with_cert_retry(verify: Any, cache: CachingTransportRequest) -> Any:
    """Call ``verify()``, retrying once against fresh certs on an unknown key id.

    ``verify`` is a zero-argument callable so this stays independent of
    ``google.oauth2``: the policy (which errors may refresh, how often, how many
    retries) is expressed here in pure stdlib and can be tested without the
    google-auth or fastapi import chain. ``app.services.auth`` supplies the
    closure that does the real Firebase verification.

    Exactly one retry, and only when all of the following hold:

    * the failure is an unknown-key-id error (:func:`is_unknown_key_error`) —
      every other failure, including expired tokens, wrong audience and forged
      signatures, propagates immediately with no network call;
    * the refresh throttle allows it (:meth:`CachingTransportRequest.request_refresh`),
      so a flood of bad tokens cannot drive a fetch per request.

    When the throttle refuses, the original error is re-raised rather than
    retried: the cert set is unchanged, so a second attempt would fail
    identically and only burn CPU.
    """
    try:
        return verify()
    except BaseException as exc:
        if not is_unknown_key_error(exc):
            raise
        if not cache.request_refresh():
            raise
    # Outside the handler so a failure here is reported on its own terms rather
    # than chained to the first attempt.
    return verify()
