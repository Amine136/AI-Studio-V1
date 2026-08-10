"""Manual credit orders, reviewed from Discord.

A second surface over the SAME service calls the admin panel uses
(``accept_credit_order`` / ``refuse_credit_order``) — no order logic is
reimplemented here, so both surfaces share one audit trail and one set of
guards.

Why this surface is safe to expose on a phone
---------------------------------------------
``accept_credit_order`` only ever *validates* a redeem code against
``credit_codes``; it cannot create one. Codes are minted exclusively from the
web admin panel. So an attacker holding the Discord account can attach codes
that already exist — it cannot mint credits. That property is the entire point
of this integration, and it survives only as long as nothing here calls a
code-*creating* function. Do not add one.

Transport (talking to Discord) lives in ``discord_client``. This module owns
what a card looks like, who may press its buttons, and what a press does.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import time
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric import ed25519

from app.config import PAYMENT_METHODS_BY_ID, settings
from app.services import discord_client
from app.services.postgres_security_store import (
    accept_credit_order,
    get_admin_credit_order,
    refuse_credit_order,
    set_credit_order_discord_message_id,
)

logger = logging.getLogger(__name__)

# Interaction + response type numbers from the Discord API. Spelled out because
# the raw protocol uses bare ints and `"type": 9` reads as nothing.
INTERACTION_PING = 1
INTERACTION_COMPONENT = 3
INTERACTION_MODAL_SUBMIT = 5

RESPONSE_PONG = 1
RESPONSE_MESSAGE = 4
RESPONSE_UPDATE_MESSAGE = 7
RESPONSE_MODAL = 9

EPHEMERAL = 64  # message flag: only the clicker sees it

COLOR_PENDING = 0x5865F2
COLOR_ACCEPTED = 0x2ECC71
COLOR_REFUSED = 0xED4245

# `custom_id` is capped at 100 chars; "vc_order_accept_modal:" + a 36-char uuid
# is 58, so the order id rides along in the id itself. That is deliberate — it
# means a press is resolved from the DB, never from whatever the message body
# happens to say.
ACCEPT_BUTTON = "vc_order_accept"
REFUSE_BUTTON = "vc_order_refuse"
ACCEPT_MODAL = "vc_order_accept_modal"
REFUSE_MODAL = "vc_order_refuse_modal"
CODE_INPUT = "credit_code"
REASON_INPUT = "refuse_reason"

# Same ValueError codes main.py maps to HTTP statuses (CREDIT_ORDER_ERRORS),
# worded for someone holding a phone rather than for an API client.
ORDER_ERROR_MESSAGES = {
    "ORDER_NOT_FOUND": "That order no longer exists.",
    "ORDER_NOT_PENDING": "Already resolved — someone got to this one first.",
    "CODE_REQUIRED": "You need to type a code.",
    "CODE_NOT_FOUND": "No such code. Generate it in the admin panel first, then come back.",
    "CODE_INACTIVE": "That code has been disabled.",
    "CODE_EXPIRED": "That code has expired.",
    "CODE_EXHAUSTED": "That code has already been claimed.",
    "CODE_CREDITS_MISMATCH": (
        "That code is worth a different number of credits than this order. "
        "Use a matching code, or override it from the admin panel."
    ),
}


# --------------------------------------------------------------------------
# Signed proof links
# --------------------------------------------------------------------------
# The admin proof route is session-gated, so a bare URL renders nothing in
# Discord. Rather than attach the receipt bytes — which would park customer
# payment documents in channel history forever — the card carries a link that
# expires. An old card's link is dead, so scrolling back through the channel
# does not hand over a stack of receipts.


def _sign_proof(order_id: str, file_id: str, expires_at: int) -> str:
    secret = (settings.discord_proof_secret or "").encode()
    payload = f"{order_id}:{file_id}:{expires_at}"
    return hmac.new(secret, payload.encode(), hashlib.sha256).hexdigest()[:32]


def signed_proof_url(order_id: str, file_id: str) -> str:
    expires_at = int(time.time()) + int(settings.discord_proof_link_ttl)
    signature = _sign_proof(order_id, file_id, expires_at)
    base_url = (settings.public_backend_base_url or settings.app_base_url).rstrip("/")
    return (
        f"{base_url}/credits/orders/{order_id}/proof/{file_id}"
        f"?exp={expires_at}&sig={signature}"
    )


def verify_proof_link(order_id: str, file_id: str, expires_at: int, signature: str) -> bool:
    """Constant-time check of a signed proof link. Expiry is checked first."""
    if not settings.discord_proof_secret or not signature:
        return False
    if expires_at <= int(time.time()):
        return False
    return hmac.compare_digest(signature, _sign_proof(order_id, file_id, expires_at))


# --------------------------------------------------------------------------
# Interaction signature
# --------------------------------------------------------------------------


def verify_interaction_signature(signature: str, timestamp: str, body: bytes) -> bool:
    """Ed25519 check over `timestamp + raw body`. This IS the auth for the route.

    Must run against the exact bytes Discord sent — never a re-serialized dict.
    Discord validates a new interactions URL by sending deliberately BAD
    signatures and requiring a 401, so a permissive implementation here fails
    registration outright.
    """
    public_key = (settings.discord_public_key or "").strip()
    if not public_key or not signature or not timestamp:
        return False
    try:
        verifier = ed25519.Ed25519PublicKey.from_public_bytes(bytes.fromhex(public_key))
        verifier.verify(bytes.fromhex(signature), timestamp.encode() + body)
    except (InvalidSignature, ValueError):
        return False
    return True


# --------------------------------------------------------------------------
# Card rendering
# --------------------------------------------------------------------------


def _format_price(price_minor: int, currency: str) -> str:
    # TND is a 3-decimal currency; `price_minor` is millimes (see CREDIT_PLANS).
    return f"{price_minor / 1000:.3f} {currency}"


def _format_credits(credits: float) -> str:
    return f"{credits:g} Credits"


def _payment_label(method_id: str) -> str:
    method = PAYMENT_METHODS_BY_ID.get(method_id)
    return str(method["label"]) if method else (method_id or "—")


# Discord renders markdown inside embed field VALUES, so any buyer-supplied
# string reaching a field can otherwise forge the card: a display name of
# "Sami\n**Amount** 69.000 TND ✅ Verified" prints as extra structure, and a note
# of "[Receipt 1](https://evil.tld)" prints as a link indistinguishable from the
# real receipt links below it. A reviewer on a phone approves what the card says,
# so the card must only ever say what WE put in it.
#
# Exactly the characters Discord treats as markdown controls, no more: escaping
# something like "-" or "#" would leave a visible backslash in ordinary names.
# The backslash itself goes first, or every later escape gets double-escaped.
_MARKDOWN_SPECIALS = "\\*_~`|>[]()"


def _escape(text: str) -> str:
    """Neutralise buyer-controlled markdown. Newlines collapse to spaces so a
    single-line field cannot be made to look like several."""
    escaped = str(text or "")
    for char in _MARKDOWN_SPECIALS:
        escaped = escaped.replace(char, f"\\{char}")
    return " ".join(escaped.split())


def _customer_line(order: dict[str, Any]) -> str:
    name = _escape(str(order.get("userDisplayName") or "").strip())
    email = _escape(str(order.get("userEmail") or "").strip())
    if name and email:
        return f"{name}\n{email}"
    return email or name or _escape(str(order.get("uid") or "")) or "—"


def build_card(order: dict[str, Any]) -> dict[str, Any]:
    """The full message payload for an order, in whatever state it is in.

    Used for the first post, for a press handled here, and for repainting the
    card after the web panel resolved the order — one renderer, so the three
    paths cannot drift.
    """
    status = str(order.get("status") or "pending")
    order_id = str(order.get("id") or "")
    plan_name = str(order.get("planName") or "")
    credits = _format_credits(float(order.get("credits") or 0))

    if status == "accepted":
        title = f"✅ Approved — {plan_name} ({credits})"
        color = COLOR_ACCEPTED
    elif status == "refused":
        title = f"❌ Refused — {plan_name} ({credits})"
        color = COLOR_REFUSED
    else:
        title = f"🧾 New order — {plan_name} ({credits})"
        color = COLOR_PENDING

    fields: list[dict[str, Any]] = [
        {"name": "Customer", "value": _customer_line(order), "inline": True},
        {
            "name": "Amount",
            "value": _format_price(int(order.get("priceMinor") or 0), str(order.get("currency") or "TND")),
            "inline": True,
        },
        {"name": "Method", "value": _payment_label(str(order.get("paymentMethod") or "")), "inline": True},
    ]

    note = str(order.get("note") or "").strip()
    if note:
        fields.append({"name": "Customer note", "value": _escape(note)[:1000], "inline": False})

    # Loud, and directly above the receipt links, because it is the one thing on
    # the card that argues against approving. Escaped like everything else even
    # though the ids are ours — a field that is only sometimes safe is a field
    # someone eventually gets wrong.
    duplicates = list(order.get("duplicateProofs") or [])
    if duplicates:
        lines = "\n".join(
            f"• order `{_escape(str(dup.get('orderId') or ''))[:36]}` "
            f"({_escape(str(dup.get('status') or 'unknown'))}, {_relative_age(int(dup.get('createdAt') or 0))})"
            for dup in duplicates[:5]
        )
        fields.append(
            {
                "name": "⚠️ Receipt already submitted",
                "value": f"The same file was attached to:\n{lines}",
                "inline": False,
            }
        )

    proof_ids = list(order.get("proofFileIds") or [])
    if proof_ids and not settings.discord_proof_secret:
        # Unsigned links would be dead on arrival (verify_proof_link fails closed
        # on a missing secret). Say so rather than printing links that 403.
        fields.append(
            {
                "name": "Proof of payment",
                "value": "Set DISCORD_PROOF_SECRET to link receipts here — open the admin panel meanwhile.",
                "inline": False,
            }
        )
    elif proof_ids:
        links = "\n".join(
            f"[Receipt {index}]({signed_proof_url(order_id, file_id)})"
            for index, file_id in enumerate(proof_ids, start=1)
        )
        ttl_hours = int(settings.discord_proof_link_ttl) // 3600
        fields.append(
            {"name": f"Proof of payment (links expire in {ttl_hours}h)", "value": links, "inline": False}
        )

    if status == "accepted":
        # MASKED, and it has to stay that way. A code is a bearer instrument
        # until the customer redeems it, which can be days later — printing it
        # in full would leave channel history stocked with live codes for anyone
        # who takes over the account to scroll back and redeem. That is the same
        # theft the type-it-in design exists to prevent, just by another route.
        # The admin typed the code seconds ago, so echoing it buys nothing; this
        # field is only here to confirm which code went out.
        fields.append({"name": "Code issued", "value": _mask_code(str(order.get("code") or "")), "inline": False})
    if status == "refused" and str(order.get("adminMessage") or "").strip():
        fields.append({"name": "Reason", "value": _escape(str(order["adminMessage"]))[:1000], "inline": False})
    if status != "pending" and str(order.get("resolvedByEmail") or "").strip():
        fields.append({"name": "Resolved by", "value": _escape(str(order["resolvedByEmail"])), "inline": False})

    embed = {
        "title": title,
        "color": color,
        "fields": fields,
        "footer": {"text": f"Order {order_id}"},
        "timestamp": _iso(int(order.get("createdAt") or time.time())),
    }

    payload: dict[str, Any] = {"embeds": [embed]}
    payload["components"] = _action_row(order_id) if status == "pending" else []
    return payload


def _action_row(order_id: str) -> list[dict[str, Any]]:
    return [
        {
            "type": 1,
            "components": [
                {
                    "type": 2,
                    "style": 3,  # green
                    "label": "Approve",
                    "custom_id": f"{ACCEPT_BUTTON}:{order_id}",
                },
                {
                    "type": 2,
                    "style": 4,  # red
                    "label": "Refuse",
                    "custom_id": f"{REFUSE_BUTTON}:{order_id}",
                },
            ],
        }
    ]


def _mask_code(code: str) -> str:
    """Same shape as `credit_codes.code_preview`, so the two read alike."""
    normalized = code.strip().upper()
    if len(normalized) < 12:
        return "—"
    return f"`{normalized[:6]}...{normalized[-4:]}`"


def _iso(epoch_seconds: int) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch_seconds))


def _relative_age(epoch_seconds: int) -> str:
    """"3 days ago" beats a timestamp when the question is "is this the same
    receipt I just approved?"."""
    if epoch_seconds <= 0:
        return "unknown date"
    delta = max(0, int(time.time()) - epoch_seconds)
    if delta < 3600:
        return "under an hour ago"
    if delta < 86400:
        hours = delta // 3600
        return f"{hours}h ago"
    days = delta // 86400
    return "yesterday" if days == 1 else f"{days} days ago"


# --------------------------------------------------------------------------
# Outbound: posting and repainting cards
# --------------------------------------------------------------------------


def announce_credit_order(order_id: str) -> None:
    """Post a new order's card. Runs as a background task — never raises.

    Fail-open by construction: a Discord outage must not fail a customer's
    purchase, and the order is already committed by the time this runs.
    """
    try:
        order = get_admin_credit_order(order_id)
        if order is None:
            logger.warning("[discord] order %s vanished before it could be announced", order_id)
            return
        result = discord_client.post_message(build_card(order))
        if result.ok and result.message_id:
            set_credit_order_discord_message_id(order_id, result.message_id)
    except Exception:
        logger.exception("[discord] failed to announce order %s", order_id)


def sync_credit_order_card(order_id: str) -> None:
    """Repaint an order's card after it was resolved somewhere else.

    Without this, an order accepted in the web panel keeps live Approve/Refuse
    buttons in Discord. Pressing them is harmless — ``ORDER_NOT_PENDING`` stops
    it at the service layer — but the card would be lying.
    """
    try:
        order = get_admin_credit_order(order_id)
        if order is None:
            return
        message_id = str(order.get("discordMessageId") or "")
        if not message_id:
            return
        discord_client.edit_message(message_id, build_card(order))
    except Exception:
        logger.exception("[discord] failed to sync card for order %s", order_id)


# --------------------------------------------------------------------------
# Inbound: handling a press
# --------------------------------------------------------------------------


def handle_interaction(payload: dict[str, Any]) -> dict[str, Any]:
    """Turn a signature-verified interaction into a Discord response body.

    Must return within Discord's 3-second budget; every path here is one DB
    transaction, so it does.
    """
    interaction_type = int(payload.get("type") or 0)

    if interaction_type == INTERACTION_PING:
        return {"type": RESPONSE_PONG}

    if interaction_type not in (INTERACTION_COMPONENT, INTERACTION_MODAL_SUBMIT):
        return _ephemeral("Unsupported interaction.")

    if not _authorized(payload):
        logger.warning(
            "[discord] rejected interaction from user=%s channel=%s",
            _actor_id(payload) or "(unknown)",
            payload.get("channel_id"),
        )
        return _ephemeral("You are not allowed to act on orders.")

    action, order_id = _split_custom_id(payload)
    if not order_id:
        return _ephemeral("This card is missing its order id — resolve it from the admin panel.")

    if interaction_type == INTERACTION_COMPONENT:
        if action == ACCEPT_BUTTON:
            return _accept_modal(order_id)
        if action == REFUSE_BUTTON:
            return _refuse_modal(order_id)
        return _ephemeral("Unknown button.")

    if action == ACCEPT_MODAL:
        return _do_accept(payload, order_id)
    if action == REFUSE_MODAL:
        return _do_refuse(payload, order_id)
    return _ephemeral("Unknown form.")


def _accept_modal(order_id: str) -> dict[str, Any]:
    """Ask for a code — the only way to approve from here.

    There is deliberately NO generate button. A code has to be minted in the web
    panel and typed in from wherever the admin keeps it, so possession of the
    Discord account alone is not enough to hand out credits.
    """
    return {
        "type": RESPONSE_MODAL,
        "data": {
            "custom_id": f"{ACCEPT_MODAL}:{order_id}",
            "title": "Approve order",  # Discord caps modal titles at 45 chars
            "components": [
                {
                    "type": 1,
                    "components": [
                        {
                            "type": 4,
                            "custom_id": CODE_INPUT,
                            "label": "Redeem code",
                            "style": 1,  # single line
                            "min_length": 1,
                            "max_length": 64,
                            "placeholder": "Type the code you generated",
                            "required": True,
                        }
                    ],
                }
            ],
        },
    }


def _refuse_modal(order_id: str) -> dict[str, Any]:
    """Ask for a reason. Optional, but the customer is shown whatever is typed,
    and the extra step makes a mis-tap on a phone harder."""
    return {
        "type": RESPONSE_MODAL,
        "data": {
            "custom_id": f"{REFUSE_MODAL}:{order_id}",
            "title": "Refuse order",
            "components": [
                {
                    "type": 1,
                    "components": [
                        {
                            "type": 4,
                            "custom_id": REASON_INPUT,
                            "label": "Reason (shown to the customer)",
                            "style": 2,  # paragraph
                            "max_length": 400,
                            "placeholder": "e.g. The receipt does not match the amount",
                            "required": False,
                        }
                    ],
                }
            ],
        },
    }


def _do_accept(payload: dict[str, Any], order_id: str) -> dict[str, Any]:
    code = _modal_value(payload, CODE_INPUT)
    try:
        accept_credit_order(
            order_id,
            code=code,
            admin_uid=None,
            admin_email=_admin_identity(payload),
            # Never auto-confirm a credits mismatch from here: a phone is the
            # wrong place to wave through "this code is worth something else".
            confirm_mismatch=False,
        )
    except ValueError as exc:
        # Deliberately does not echo a valid code back, ever.
        return _ephemeral(f"❌ {_error_message(str(exc))}")
    return _repaint(order_id, fallback="✅ Approved.")


def _do_refuse(payload: dict[str, Any], order_id: str) -> dict[str, Any]:
    reason = _modal_value(payload, REASON_INPUT)
    try:
        refuse_credit_order(
            order_id,
            reason=reason,
            admin_uid=None,
            admin_email=_admin_identity(payload),
        )
    except ValueError as exc:
        return _ephemeral(f"❌ {_error_message(str(exc))}")
    return _repaint(order_id, fallback="❌ Refused.")


def _repaint(order_id: str, *, fallback: str) -> dict[str, Any]:
    """Replace the card with its resolved state, buttons removed.

    A modal opened from a message component may answer with UPDATE_MESSAGE, so
    the card updates in place with no follow-up API call.
    """
    order = get_admin_credit_order(order_id)
    if order is None:
        return _ephemeral(fallback)
    return {"type": RESPONSE_UPDATE_MESSAGE, "data": build_card(order)}


# --------------------------------------------------------------------------
# Payload helpers
# --------------------------------------------------------------------------


def _actor_id(payload: dict[str, Any]) -> str:
    # In a guild the presser is member.user; in a DM it is the top-level user.
    member = payload.get("member") or {}
    user = member.get("user") or payload.get("user") or {}
    return str(user.get("id") or "")


def _authorized(payload: dict[str, Any]) -> bool:
    """Two independent pins: the card must live in the approval channel, and the
    presser must be on the allowlist. The signature only proves Discord sent it."""
    channel_id = str(payload.get("channel_id") or "")
    if settings.discord_channel_id and channel_id != settings.discord_channel_id:
        return False
    if settings.discord_guild_id and str(payload.get("guild_id") or "") != settings.discord_guild_id:
        return False
    return bool(settings.discord_admin_ids) and _actor_id(payload) in settings.discord_admin_ids


def _admin_identity(payload: dict[str, Any]) -> str:
    """What lands in `resolved_by_email` and the audit log.

    Prefixed so the admin panel's "Resolved by" column says which surface acted,
    and so it can never collide with a real admin email address.
    """
    member = payload.get("member") or {}
    user = member.get("user") or payload.get("user") or {}
    handle = str(user.get("username") or "").strip()
    actor = _actor_id(payload)
    return f"discord:{handle or 'unknown'}:{actor}"[:255]


def _split_custom_id(payload: dict[str, Any]) -> tuple[str, str]:
    custom_id = str((payload.get("data") or {}).get("custom_id") or "")
    action, _, order_id = custom_id.partition(":")
    return action, order_id


def _modal_value(payload: dict[str, Any], field_id: str) -> str:
    for row in (payload.get("data") or {}).get("components") or []:
        for component in row.get("components") or []:
            if component.get("custom_id") == field_id:
                return str(component.get("value") or "")
    return ""


def _error_message(code: str) -> str:
    return ORDER_ERROR_MESSAGES.get(code, "Could not update this order.")


def _ephemeral(content: str) -> dict[str, Any]:
    return {"type": RESPONSE_MESSAGE, "data": {"content": content, "flags": EPHEMERAL}}
