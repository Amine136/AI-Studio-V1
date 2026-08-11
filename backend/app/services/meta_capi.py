"""Meta Conversions API (server-side) — CompleteRegistration.

Why this exists: the browser Pixel alone undercounts registrations. Ad blockers,
Safari ITP and the Instagram/Facebook in-app-browser -> default-browser hop (the
magic-link sign-in flow) all drop or fail to attribute the browser event. This
sends the same event server-to-server, where none of that applies.

Deduplication: the browser Pixel and this server event use the SAME event_id
(``reg_<uid>``). Meta collapses the matching (event_name, event_id) pair into one
registration, so dual-firing never double-counts.

Fail-safe by design: missing token => no-op; any error is swallowed and the HTTP
request that triggered it is never blocked (fired on a daemon thread).
"""

from __future__ import annotations

import hashlib
import logging
import threading
import time
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_GRAPH_VERSION = "v21.0"


def _hash(value: str) -> str:
    """SHA-256 of the normalized (trim + lowercase) value, as Meta requires for
    advanced-matching fields. Mirrors the browser Pixel's auto-normalization so
    em/external_id match across the two channels."""
    return hashlib.sha256(value.strip().lower().encode("utf-8")).hexdigest()


def _client_ip(request: Any) -> str | None:
    # Trust the proxy chain (nginx/Cloudflare) the same way the rest of the app
    # does: the left-most X-Forwarded-For entry is the real client.
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    return request.client.host if getattr(request, "client", None) else None


# Minor units per major unit. TND is a 3-decimal currency (millimes), USD is 2
# (cents) — the Tunisian and card rails are priced in different lists, so a single
# divisor would report one of them 10x wrong into Meta's value optimisation.
_MINOR_PER_MAJOR = {"TND": 1000, "USD": 100}


def _major_amount(price_minor: int, currency: str) -> float:
    """Minor units -> the major amount Meta expects. Raises on an unknown
    currency: a purchase logged at the wrong value is worse than none at all,
    because value optimisation and reported ROAS both consume it silently."""
    divisor = _MINOR_PER_MAJOR.get((currency or "").upper())
    if divisor is None:
        raise ValueError(f"no minor-unit exponent known for currency {currency!r}")
    return price_minor / divisor


def _dispatch(*, event: dict[str, Any], label: str) -> None:
    """POST one already-built event on a daemon thread. Never raises."""
    token = settings.meta_capi_access_token
    payload: dict[str, Any] = {"data": [event]}
    if settings.meta_capi_test_event_code:
        payload["test_event_code"] = settings.meta_capi_test_event_code
    pixel_id = settings.meta_capi_pixel_id

    def _post() -> None:
        try:
            url = f"https://graph.facebook.com/{_GRAPH_VERSION}/{pixel_id}/events"
            with httpx.Client(timeout=5.0) as client:
                resp = client.post(url, params={"access_token": token}, json=payload)
            if resp.status_code >= 300:
                logger.warning("meta_capi: %s HTTP %s: %s", label, resp.status_code, resp.text[:300])
            else:
                logger.info("meta_capi: %s sent (%s)", label, event.get("event_id"))
        except Exception:
            logger.exception("meta_capi: %s send failed", label)

    threading.Thread(target=_post, name="meta-capi", daemon=True).start()


def send_complete_registration(*, request: Any, uid: str, email: str) -> None:
    """Fire a server-side CompleteRegistration for a brand-new user.

    Call this only when the user row was just created (first time we see the uid).
    Non-blocking: builds the payload synchronously, then posts on a daemon thread.
    """
    if not settings.meta_capi_access_token:
        return  # CAPI disabled (no token configured) -> safe no-op

    try:
        user_data: dict[str, Any] = {
            "external_id": _hash(uid),
            "client_user_agent": request.headers.get("user-agent", ""),
        }
        ip = _client_ip(request)
        if ip:
            user_data["client_ip_address"] = ip
        if email:
            user_data["em"] = _hash(email)
        # fbp/fbc cookies sharpen attribution when present (same-site requests only).
        fbp = request.cookies.get("_fbp")
        fbc = request.cookies.get("_fbc")
        if fbp:
            user_data["fbp"] = fbp
        if fbc:
            user_data["fbc"] = fbc

        event: dict[str, Any] = {
            "event_name": "CompleteRegistration",
            "event_time": int(time.time()),
            "event_id": f"reg_{uid}",  # shared with the browser Pixel -> Meta dedup
            "action_source": "website",
            "user_data": user_data,
            "custom_data": {
                "value": settings.meta_capi_registration_value,
                "currency": "USD",
            },
        }
        source_url = request.headers.get("referer") or request.headers.get("origin")
        if source_url:
            event["event_source_url"] = source_url
    except Exception:
        logger.exception("meta_capi: failed to build CompleteRegistration payload")
        return

    _dispatch(event=event, label="CompleteRegistration")


def send_purchase(
    *,
    event_id: str,
    uid: str,
    email: str,
    plan_id: str,
    plan_name: str,
    price_minor: int,
    currency: str,
    fbp: str | None = None,
    fbc: str | None = None,
) -> None:
    """Fire a server-side Purchase for money actually received.

    Server-side is not an optimisation here, it is the only option: both rails
    complete with no buyer browser present. The Tunisian rail is confirmed by an
    admin (in the web panel or from Discord) hours or days after the payment, and
    the card rail lands as a Dodo webhook. Sending this from the browser would
    mean firing it on a page the buyer may never load.

    ``event_id`` must be derived from the payment itself (order id / Dodo payment
    id) so a webhook retry or a repeated admin action collapses into one purchase
    rather than inflating revenue.

    ``fbp``/``fbc`` are the buyer's own Pixel cookies, captured when they started
    checkout and stored since — without them Meta can rarely tie the purchase back
    to the ad click that caused it.
    """
    if not settings.meta_capi_access_token:
        return  # CAPI disabled (no token configured) -> safe no-op

    try:
        value = _major_amount(price_minor, currency)

        user_data: dict[str, Any] = {"external_id": _hash(uid)}
        if email:
            user_data["em"] = _hash(email)
        if fbp:
            user_data["fbp"] = fbp
        if fbc:
            user_data["fbc"] = fbc

        event: dict[str, Any] = {
            "event_name": "Purchase",
            "event_time": int(time.time()),
            "event_id": event_id,
            "action_source": "website",
            "user_data": user_data,
            "custom_data": {
                "value": value,
                "currency": currency.upper(),
                "content_ids": [plan_id],
                "content_name": plan_name,
                "content_type": "product",
                "num_items": 1,
            },
        }
    except Exception:
        logger.exception("meta_capi: failed to build Purchase payload (uid=%s)", uid)
        return

    _dispatch(event=event, label="Purchase")
