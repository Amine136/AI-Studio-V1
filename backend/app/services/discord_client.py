"""Discord transport for the payment-approval channel.

Thin wrapper over the Discord REST API. Mirrors the sync httpx style of
``email_client``: never raises, returns a result the caller records, and in
DRY-RUN (no bot token) logs the payload and sends nothing — so the order card
is exercisable before the bot has been invited anywhere.

Kept deliberately dumb: it ships an already-built message payload. What a card
looks like, who may press its buttons, and what a press does all live in
``discord_orders``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

DISCORD_API_BASE = "https://discord.com/api/v10"


@dataclass
class DiscordMessageResult:
    ok: bool
    message_id: Optional[str] = None
    error: Optional[str] = None
    dry_run: bool = False


def transport_status() -> str:
    """One-line description of the live transport, logged once at boot.

    Exists for the same reason as the email one: a token-less box dry-runs
    *silently and successfully*, and without this line there is no way to tell
    "posted to Discord" from "swallowed" in the logs.
    """
    if not settings.discord_bot_token:
        return "DISABLED — no DISCORD_BOT_TOKEN in env; order cards are logged, not posted"
    if not settings.discord_channel_id:
        return "DISABLED — DISCORD_CHANNEL_ID is unset; nowhere to post order cards"
    if not settings.discord_public_key:
        return (
            f"POST-ONLY — cards go to channel {settings.discord_channel_id}, but DISCORD_PUBLIC_KEY "
            f"is unset so button presses cannot be verified and will be rejected"
        )
    admins = ", ".join(settings.discord_admin_ids) or "(none — every press will be rejected)"
    return f"LIVE — channel={settings.discord_channel_id} admins={admins} timeout={settings.discord_timeout}s"


def is_configured() -> bool:
    """True when a card can actually be delivered."""
    return bool(settings.discord_bot_token and settings.discord_channel_id)


def post_message(payload: dict[str, Any]) -> DiscordMessageResult:
    """Post one message to the approval channel. Never raises."""
    if not is_configured():
        logger.info("[discord] DRY-RUN (nothing posted) payload=%s", _summarize(payload))
        return DiscordMessageResult(ok=True, message_id=None, dry_run=True)
    return _request(
        "POST",
        f"/channels/{settings.discord_channel_id}/messages",
        payload,
        what="post",
    )


def edit_message(message_id: str, payload: dict[str, Any]) -> DiscordMessageResult:
    """Rewrite an already-posted card (used when an order is resolved elsewhere)."""
    if not is_configured():
        logger.info("[discord] DRY-RUN (nothing edited) id=%s payload=%s", message_id, _summarize(payload))
        return DiscordMessageResult(ok=True, message_id=message_id, dry_run=True)
    if not message_id:
        return DiscordMessageResult(ok=False, error="no message id to edit")
    return _request(
        "PATCH",
        f"/channels/{settings.discord_channel_id}/messages/{message_id}",
        payload,
        what="edit",
    )


def _request(method: str, path: str, payload: dict[str, Any], *, what: str) -> DiscordMessageResult:
    url = f"{DISCORD_API_BASE}{path}"
    headers = {
        "Authorization": f"Bot {settings.discord_bot_token}",
        "Content-Type": "application/json",
    }
    try:
        with httpx.Client(timeout=settings.discord_timeout) as client:
            response = client.request(method, url, json=payload, headers=headers)
    except httpx.TimeoutException:
        logger.error("[discord] %s TIMEOUT after %ss path=%s", what, settings.discord_timeout, path)
        return DiscordMessageResult(ok=False, error="discord timeout")
    except httpx.RequestError as exc:
        logger.error("[discord] %s NETWORK ERROR path=%s: %s", what, path, exc)
        return DiscordMessageResult(ok=False, error=f"network error: {exc}")

    if response.status_code in (200, 201):
        message_id = None
        try:
            message_id = str(response.json().get("id") or "") or None
        except Exception:
            pass
        logger.info("[discord] %s OK path=%s message_id=%s", what, path, message_id or "(none)")
        return DiscordMessageResult(ok=True, message_id=message_id)

    reason = _explain_http(response.status_code)
    logger.error(
        "[discord] %s FAILED (%s) path=%s status=%s body=%s",
        what,
        reason,
        path,
        response.status_code,
        response.text[:600],
    )
    return DiscordMessageResult(ok=False, error=f"{reason} — HTTP {response.status_code}")


def _explain_http(status_code: int) -> str:
    if status_code == 401:
        return "auth rejected: DISCORD_BOT_TOKEN missing, wrong, or regenerated"
    if status_code == 403:
        return "bot lacks permission in that channel (needs View Channel + Send Messages)"
    if status_code == 404:
        return "channel or message not found: check DISCORD_CHANNEL_ID"
    if status_code == 429:
        return "rate limited by Discord"
    if 500 <= status_code < 600:
        return "Discord outage"
    return "unexpected Discord response"


def _summarize(payload: dict[str, Any]) -> str:
    """Readable one-liner for the dry-run log — the raw payload is mostly noise."""
    embeds = payload.get("embeds") or []
    title = embeds[0].get("title") if embeds and isinstance(embeds[0], dict) else None
    fields = embeds[0].get("fields") if embeds and isinstance(embeds[0], dict) else []
    pairs = " | ".join(f"{f.get('name')}={f.get('value')}" for f in (fields or [])[:6])
    return f"title={title!r} {pairs}"[:800]
