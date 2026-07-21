"""Transactional email transport.

Thin wrapper over the email provider (Brevo by default). Mirrors the sync httpx
style of ``apikeymanager_client._post_apikeymanager``. In DRY-RUN (no API key, or
EMAIL_DRY_RUN set) it logs the payload and sends nothing, so the whole email
system is exercisable before the sender domain is verified.

Kept deliberately dumb: it only ships an already-rendered message. Consent,
idempotency, templating and dedupe live in ``email_service``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email"


@dataclass
class EmailSendResult:
    ok: bool
    message_id: Optional[str] = None
    error: Optional[str] = None
    dry_run: bool = False


@dataclass
class OutgoingEmail:
    to_email: str
    to_name: str
    subject: str
    html: str
    text: Optional[str] = None
    # Extra SMTP headers (e.g. List-Unsubscribe for marketing mail).
    headers: dict[str, str] = field(default_factory=dict)


def transport_status() -> str:
    """One-line description of the live transport, logged once at boot.

    Exists because a keyless box dry-runs *silently and successfully* — without
    this line there is no way to tell "delivered" from "swallowed" in the logs.
    """
    if settings.email_dry_run:
        cause = "EMAIL_DRY_RUN is set" if settings.brevo_api_key else "no BREVO_API_KEY in env"
        return f"DRY-RUN — {cause}; messages are rendered and recorded but NOT delivered"
    return (
        f"LIVE via {settings.email_provider} "
        f"from={settings.email_from_name} <{settings.email_from}> timeout={settings.email_timeout}s"
    )


def send_email(message: OutgoingEmail) -> EmailSendResult:
    """Deliver one email. Never raises — returns a result the caller records."""
    to_email = (message.to_email or "").strip()
    if not to_email or "@" not in to_email:
        return EmailSendResult(ok=False, error="missing or invalid recipient")

    if settings.email_dry_run:
        logger.info(
            "[email] DRY-RUN (nothing delivered) to=%s subject=%r headers=%s\n%s",
            to_email,
            message.subject,
            message.headers or {},
            (message.text or _strip_html(message.html))[:1200],
        )
        return EmailSendResult(ok=True, message_id="dry-run", dry_run=True)

    if settings.email_provider == "brevo":
        return _send_brevo(message)
    return EmailSendResult(ok=False, error=f"unsupported email provider: {settings.email_provider}")


def _send_brevo(message: OutgoingEmail) -> EmailSendResult:
    payload: dict = {
        "sender": {"name": settings.email_from_name, "email": settings.email_from},
        "to": [{"email": message.to_email.strip(), "name": message.to_name or ""}],
        "subject": message.subject,
        "htmlContent": message.html,
    }
    if message.text:
        payload["textContent"] = message.text
    if message.headers:
        payload["headers"] = message.headers
    if settings.email_reply_to:
        payload["replyTo"] = {"email": settings.email_reply_to}

    try:
        with httpx.Client(timeout=settings.email_timeout) as client:
            response = client.post(
                BREVO_ENDPOINT,
                json=payload,
                headers={"api-key": settings.brevo_api_key, "accept": "application/json"},
            )
    except httpx.TimeoutException:
        logger.error(
            "[email] brevo TIMEOUT after %ss to=%s subject=%r",
            settings.email_timeout,
            message.to_email,
            message.subject,
        )
        return EmailSendResult(ok=False, error="provider timeout")
    except httpx.RequestError as exc:
        logger.error(
            "[email] brevo NETWORK ERROR to=%s subject=%r: %s",
            message.to_email,
            message.subject,
            exc,
        )
        return EmailSendResult(ok=False, error=f"network error: {exc}")

    if response.status_code in (200, 201, 202):
        message_id = None
        try:
            message_id = str(response.json().get("messageId") or "") or None
        except Exception:
            pass
        logger.info(
            "[email] brevo SENT to=%s subject=%r message_id=%s",
            message.to_email,
            message.subject,
            message_id or "(none returned)",
        )
        return EmailSendResult(ok=True, message_id=message_id)

    # Failures carry the raw status + body so the stored `error` stays diagnosable,
    # prefixed with the plain-language cause (a 401 reads as "bad key", not "HTTP 401").
    reason = _explain_http(response.status_code)
    error = f"{reason} — provider HTTP {response.status_code}: {response.text[:300]}"
    logger.error(
        "[email] brevo FAILED (%s) to=%s subject=%r status=%s body=%s",
        reason,
        message.to_email,
        message.subject,
        response.status_code,
        response.text[:600],
    )
    return EmailSendResult(ok=False, error=error)


def _explain_http(status_code: int) -> str:
    """Plain-language cause for a Brevo HTTP status, so the stored error is readable."""
    if status_code in (401, 403):
        return "auth rejected: BREVO_API_KEY missing, wrong, or revoked"
    if status_code == 429:
        return "rate limited by provider (send quota or per-second cap)"
    if status_code == 400:
        return "payload rejected: check sender address is a verified Brevo sender"
    if status_code == 402:
        return "provider credit/plan limit reached"
    if 500 <= status_code < 600:
        return "provider outage"
    return "unexpected provider response"


def _strip_html(html: str) -> str:
    import re

    text = re.sub(r"<[^>]+>", " ", html or "")
    return re.sub(r"\s+", " ", text).strip()
