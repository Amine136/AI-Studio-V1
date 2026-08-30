"""Tests for the cert-refresh retry that guards Firebase token verification.

The cert cache introduced exactly one new failure mode: a token signed by a key
Google published *after* we cached will not verify, even though it is valid. The
retry in ``verify_with_cert_retry`` fixes that by dropping the cache and trying
once more.

That retry is the security-sensitive part of the whole cache, because the input
that triggers it is attacker-controlled. Two properties keep it safe, and both
are asserted below:

1. **Only unknown-key-id errors may refresh.** An expired token, a wrong
   audience or a forged signature must fail on the first attempt with zero
   outbound fetches. This matters more than it looks: in ``google.auth.jwt`` the
   key-id lookup runs *before* signature verification, so a token with a random
   ``kid`` and a garbage signature produces an unknown-key error without being
   valid in any sense.

2. **Refreshes are throttled.** Because of the ordering above, property 1 alone
   does not stop an attacker — they can mint unlimited random ``kid`` values.
   The throttle bounds it to one fetch per minute no matter how many bad tokens
   arrive.

These live apart from ``test_google_certs_cache.py`` (which covers the caching
transport) and are written against the stdlib policy helper rather than
``app.services.auth``, so no fastapi/google-auth stubs are needed. The real
``google.oauth2`` call site is a one-line closure passed into the helper.
"""

from __future__ import annotations

import json
import threading

import pytest

from app.services.google_certs_cache import (
    _REFRESH_MIN_INTERVAL_SECONDS,
    CachingTransportRequest,
    is_unknown_key_error,
    verify_with_cert_retry,
)

CERTS_URL = (
    "https://www.googleapis.com/robot/v1/metadata/x509"
    "/securetoken@system.gserviceaccount.com"
)

# Verbatim from google.auth.jwt.decode, which is what actually reaches us.
UNKNOWN_KID_MESSAGE = "Certificate for key id abc123 not found."


class FakeResponse:
    def __init__(self, status=200, data=b'{"kid1": "cert1"}', headers=None):
        self.status = status
        self.data = data
        self.headers = headers if headers is not None else {"cache-control": "max-age=3600"}


class FakeTransport:
    """Counts fetches so we can assert an error path made no network call.

    ``published_kids`` stands in for the key set Google is currently serving and
    can be mutated mid-test to simulate a rotation.
    """

    def __init__(self, published_kids=("kid1",)):
        self.calls = []
        self.published_kids = set(published_kids)

    def __call__(self, url, method="GET", *args, **kwargs):
        self.calls.append((url, method))
        certs = {kid: f"cert-for-{kid}" for kid in sorted(self.published_kids)}
        return FakeResponse(data=json.dumps(certs).encode("utf-8"))


def make_verifier(cache, transport, token_kid, claims=None):
    """Build a verify() closure shaped like google.oauth2's real one.

    The ordering here is what matters and it mirrors ``google.auth.jwt.decode``:
    certs are fetched *through the cache* first, then the token's key id is
    looked up in them, and only after that would a signature be checked. So a
    cache hit costs no network call, and an unknown kid raises before any
    cryptography happens — which is exactly why the throttle is load-bearing.
    """
    calls = []

    def verify():
        calls.append(1)
        response = cache(CERTS_URL)
        certs = json.loads(response.data.decode("utf-8"))
        if token_kid not in certs:
            raise ValueError(f"Certificate for key id {token_kid} not found.")
        return claims if claims is not None else {"uid": "u1"}

    verify.calls = calls
    return verify


def _warm_cache(cache, transport):
    """Populate the cache and reset the counter, so later counts are unambiguous."""
    cache(CERTS_URL)
    transport.calls.clear()


# ---------------------------------------------------------------------------
# Error classification
# ---------------------------------------------------------------------------


def test_classifies_the_real_google_auth_message():
    assert is_unknown_key_error(ValueError(UNKNOWN_KID_MESSAGE))


@pytest.mark.parametrize(
    "exc",
    [
        ValueError("Token expired, iat 123 exp 456"),
        ValueError("Token has wrong audience some-other-project"),
        ValueError("Could not verify token signature."),
        ValueError("Token is missing the kid claim"),
        ValueError("Issuer must be https://securetoken.google.com/x"),
        # A bare "not found" must NOT qualify. The first implementation matched
        # only this substring, which let unrelated ValueErrors force a fetch.
        ValueError("user not found"),
        ValueError("project not found"),
        # Non-ValueError failures (transport, TLS, programming errors) are never
        # fixable by new certs.
        ConnectionError(UNKNOWN_KID_MESSAGE),
        RuntimeError(UNKNOWN_KID_MESSAGE),
        KeyError("key id not found"),
    ],
)
def test_rejects_everything_else(exc):
    assert not is_unknown_key_error(exc)


def test_classification_is_case_insensitive():
    assert is_unknown_key_error(ValueError("CERTIFICATE FOR KEY ID XY NOT FOUND."))


# ---------------------------------------------------------------------------
# The happy path and the one recoverable failure
# ---------------------------------------------------------------------------


def test_valid_token_verifies_without_any_refresh():
    transport = FakeTransport(published_kids=("kid1",))
    cache = CachingTransportRequest(transport)
    _warm_cache(cache, transport)

    verify = make_verifier(cache, transport, "kid1", claims={"uid": "u1"})

    assert verify_with_cert_retry(verify, cache) == {"uid": "u1"}
    assert len(verify.calls) == 1, "a valid token must not be verified twice"
    assert transport.calls == [], "a cache hit must not touch the network"
    assert cache.stats()["forced_refreshes"] == 0


def test_key_published_after_caching_is_retried_and_accepted():
    """The whole reason the retry exists.

    Certs are cached while Google is serving only kid1. Google then rotates and
    starts signing with kid2. A user's genuinely valid kid2 token must still get
    in, via one forced refresh.
    """
    transport = FakeTransport(published_kids=("kid1",))
    cache = CachingTransportRequest(transport)
    _warm_cache(cache, transport)

    # Google rotates. Our cache still holds the pre-rotation set.
    transport.published_kids.add("kid2")

    verify = make_verifier(cache, transport, "kid2", claims={"uid": "u1", "email": "a@b.c"})
    claims = verify_with_cert_retry(verify, cache)

    assert claims == {"uid": "u1", "email": "a@b.c"}
    assert len(verify.calls) == 2
    assert cache.stats()["forced_refreshes"] == 1
    # First attempt hit the cache; only the retry went to the network.
    assert len(transport.calls) == 1


def test_unknown_key_that_stays_unknown_fails_after_one_retry():
    """No retry loop: a genuinely bogus kid gets exactly one second chance."""
    transport = FakeTransport(published_kids=("kid1",))
    cache = CachingTransportRequest(transport)
    _warm_cache(cache, transport)

    verify = make_verifier(cache, transport, "never-published")

    with pytest.raises(ValueError, match="not found"):
        verify_with_cert_retry(verify, cache)

    assert len(verify.calls) == 2, "expected exactly one retry, not a loop"


# ---------------------------------------------------------------------------
# Property 1: invalid tokens cost zero network calls
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "message",
    [
        "Token expired, iat 1 exp 2",
        "Token has wrong audience other-project, expected portfolio-645a8",
        "Could not verify token signature.",
        "Issuer must be https://securetoken.google.com/portfolio-645a8",
    ],
)
def test_invalid_tokens_do_not_touch_the_network(message):
    transport = FakeTransport()
    cache = CachingTransportRequest(transport)
    _warm_cache(cache, transport)

    attempts = []

    def verify():
        attempts.append(1)
        raise ValueError(message)

    with pytest.raises(ValueError):
        verify_with_cert_retry(verify, cache)

    assert len(attempts) == 1, "invalid token must not be retried"
    assert transport.calls == [], f"{message!r} triggered a cert fetch"
    assert cache.stats()["forced_refreshes"] == 0


def test_cached_certs_survive_a_forged_token():
    """A rejected token must not evict certs and slow down real users."""
    transport = FakeTransport()
    cache = CachingTransportRequest(transport)
    _warm_cache(cache, transport)

    def verify():
        raise ValueError("Could not verify token signature.")

    with pytest.raises(ValueError):
        verify_with_cert_retry(verify, cache)

    assert CERTS_URL in cache.stats()["entries"], "certs were evicted by a bad token"


def test_transport_errors_are_not_retried():
    transport = FakeTransport()
    cache = CachingTransportRequest(transport)

    attempts = []

    def verify():
        attempts.append(1)
        raise ConnectionError("googleapis unreachable")

    with pytest.raises(ConnectionError):
        verify_with_cert_retry(verify, cache)

    assert len(attempts) == 1


# ---------------------------------------------------------------------------
# Property 2: the throttle bounds attacker-forced fetches
# ---------------------------------------------------------------------------


def test_unknown_kid_flood_forces_only_one_fetch(monkeypatch):
    """The amplification test.

    Property 1 does not cover this case: the kid lookup precedes signature
    verification in google.auth, so an attacker can mint unlimited tokens that
    legitimately produce an unknown-key error. Only the throttle stops each one
    from buying an outbound fetch and a cache flush.
    """
    transport = FakeTransport(published_kids=("kid1",))
    cache = CachingTransportRequest(transport)

    clock = {"now": 1000.0}
    monkeypatch.setattr(
        "app.services.google_certs_cache.time.monotonic", lambda: clock["now"]
    )
    _warm_cache(cache, transport)

    for i in range(50):
        # A fresh random-looking kid each time, as an attacker would.
        verify = make_verifier(cache, transport, f"forged-kid-{i}")
        with pytest.raises(ValueError):
            verify_with_cert_retry(verify, cache)
        clock["now"] += 0.5  # ~25s of sustained spraying

    stats = cache.stats()
    assert stats["forced_refreshes"] == 1
    assert stats["forced_refreshes_throttled"] == 49
    assert len(transport.calls) == 1, (
        f"50 bad tokens caused {len(transport.calls)} cert fetches"
    )


def test_throttled_attempt_is_not_retried(monkeypatch):
    """When the throttle refuses, skip the retry — the cert set is unchanged."""
    transport = FakeTransport(published_kids=("kid1",))
    cache = CachingTransportRequest(transport)

    clock = {"now": 0.0}
    monkeypatch.setattr(
        "app.services.google_certs_cache.time.monotonic", lambda: clock["now"]
    )
    _warm_cache(cache, transport)

    # Consumes the one allowed refresh: 2 attempts.
    first = make_verifier(cache, transport, "unknown-a")
    with pytest.raises(ValueError):
        verify_with_cert_retry(first, cache)
    assert len(first.calls) == 2

    clock["now"] += 1
    second = make_verifier(cache, transport, "unknown-b")
    with pytest.raises(ValueError):
        verify_with_cert_retry(second, cache)
    assert len(second.calls) == 1, "throttled call should not re-verify"


def test_refresh_allowed_again_after_the_window(monkeypatch):
    """The throttle is a rate limit, not a one-shot. A real rotation must recover."""
    transport = FakeTransport()
    cache = CachingTransportRequest(transport)

    clock = {"now": 0.0}
    monkeypatch.setattr(
        "app.services.google_certs_cache.time.monotonic", lambda: clock["now"]
    )

    assert cache.request_refresh() is True
    clock["now"] += _REFRESH_MIN_INTERVAL_SECONDS - 1
    assert cache.request_refresh() is False
    clock["now"] += 2  # past the window
    assert cache.request_refresh() is True


def test_rotation_recovers_after_an_attack_window(monkeypatch):
    """A legitimate user is not permanently locked out by someone else's flood."""
    transport = FakeTransport(published_kids=("kid1",))
    cache = CachingTransportRequest(transport)

    clock = {"now": 0.0}
    monkeypatch.setattr(
        "app.services.google_certs_cache.time.monotonic", lambda: clock["now"]
    )
    _warm_cache(cache, transport)

    attacker = make_verifier(cache, transport, "forged")
    with pytest.raises(ValueError):
        verify_with_cert_retry(attacker, cache)

    clock["now"] += _REFRESH_MIN_INTERVAL_SECONDS + 1
    transport.published_kids.add("kid2")

    real_user = make_verifier(cache, transport, "kid2", claims={"uid": "real-user"})
    assert verify_with_cert_retry(real_user, cache) == {"uid": "real-user"}


def test_throttle_counts_are_exact_under_concurrency(monkeypatch):
    """Cold start: many threads see an unknown kid at once, one refresh happens."""
    transport = FakeTransport(published_kids=("kid1",))
    cache = CachingTransportRequest(transport)

    monkeypatch.setattr(
        "app.services.google_certs_cache.time.monotonic", lambda: 500.0
    )
    _warm_cache(cache, transport)

    barrier = threading.Barrier(12)
    errors = []

    def worker(index):
        verify = make_verifier(cache, transport, f"unknown-{index}")
        barrier.wait()
        try:
            verify_with_cert_retry(verify, cache)
        except ValueError:
            pass
        except Exception as exc:  # pragma: no cover - would be a real bug
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []
    stats = cache.stats()
    assert stats["forced_refreshes"] == 1
    assert stats["forced_refreshes_throttled"] == 11


def test_invalidate_is_not_throttled():
    """Internal/administrative invalidation stays unconditional."""
    transport = FakeTransport()
    cache = CachingTransportRequest(transport)

    for _ in range(5):
        cache(CERTS_URL)
        cache.invalidate()

    assert len(transport.calls) == 5
    assert cache.stats()["forced_refreshes"] == 0


def test_invalidate_is_not_throttled():
    """Internal/administrative invalidation stays unconditional."""
    transport = FakeTransport()
    cache = CachingTransportRequest(transport)

    for _ in range(5):
        cache(CERTS_URL)
        cache.invalidate()

    assert len(transport.calls) == 5
    assert cache.stats()["forced_refreshes"] == 0
