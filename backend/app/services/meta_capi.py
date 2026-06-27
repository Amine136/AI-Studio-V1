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


def send_complete_registration(*, request: Any, uid: str, email: str) -> None:
    """Fire a server-side CompleteRegistration for a brand-new user.

    Call this only when the user row was just created (first time we see the uid).
    Non-blocking: builds the payload synchronously, then posts on a daemon thread.
    """
    token = settings.meta_capi_access_token
    if not token:
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

        payload: dict[str, Any] = {"data": [event]}
        if settings.meta_capi_test_event_code:
            payload["test_event_code"] = settings.meta_capi_test_event_code
    except Exception:
        logger.exception("meta_capi: failed to build CompleteRegistration payload")
        return

    pixel_id = settings.meta_capi_pixel_id

    def _post() -> None:
        try:
            url = f"https://graph.facebook.com/{_GRAPH_VERSION}/{pixel_id}/events"
            with httpx.Client(timeout=5.0) as client:
                resp = client.post(url, params={"access_token": token}, json=payload)
            if resp.status_code >= 300:
                logger.warning(
                    "meta_capi: CompleteRegistration HTTP %s: %s",
                    resp.status_code,
                    resp.text[:300],
                )
            else:
                logger.info("meta_capi: CompleteRegistration sent (reg_%s)", uid)
        except Exception:
            logger.exception("meta_capi: CompleteRegistration send failed")

    threading.Thread(target=_post, name="meta-capi-reg", daemon=True).start()
