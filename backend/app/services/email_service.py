"""Automatic email dispatch: consent, idempotency, templating, and the Phase-2 sweeps.

One entry point — ``dispatch`` — runs the full pipeline for a single email:
claim an ``email_sends`` row (idempotency), check consent for marketing mail,
render the template, send via ``email_client``, and record the outcome. It never
raises; hooks call it directly (welcome, once per user) or via BackgroundTasks
(endpoint events), and the scheduled sweeps call it in a loop.

Copy is English-only for v1. The user's UI language is not persisted server-side
(only a cookie), so localized sends need a stored language column first; every
render takes a ``lang`` arg already so that is a drop-in later.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import time
from typing import Optional

from app.config import settings
from app.db.repositories import SecurityRepository
from app.db.session import session_scope
from app.services.email_client import OutgoingEmail, send_email

logger = logging.getLogger(__name__)

# Consent buckets. Transactional mail follows a user action and always sends;
# marketing (lifecycle) mail requires the email_lifecycle_enabled flag.
_MARKETING_TRIGGERS = {"drip", "winback"}


def _category_for(trigger: str) -> str:
    return "marketing" if trigger in _MARKETING_TRIGGERS else "transactional"


# --- Unsubscribe tokens -------------------------------------------------------

def _sign(payload: str) -> str:
    secret = (settings.email_unsubscribe_secret or "vibecraft-email").encode()
    return hmac.new(secret, payload.encode(), hashlib.sha256).hexdigest()[:32]


def unsubscribe_token(uid: str, category: str = "lifecycle") -> str:
    raw = f"{uid}:{category}:{_sign(f'{uid}:{category}')}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def verify_unsubscribe_token(token: str) -> Optional[tuple[str, str]]:
    """Return (uid, category) if the token is valid, else None."""
    try:
        padded = token + "=" * (-len(token) % 4)
        raw = base64.urlsafe_b64decode(padded.encode()).decode()
        uid, category, sig = raw.split(":", 2)
    except Exception:
        return None
    if hmac.compare_digest(sig, _sign(f"{uid}:{category}")):
        return uid, category
    return None


def _unsubscribe_url(uid: str) -> str:
    return f"{settings.app_base_url}/api/email/unsubscribe?token={unsubscribe_token(uid)}"


# --- HTML shell ---------------------------------------------------------------

_BRAND = "Vibecraft"


def _shell(title: str, body_html: str, *, unsubscribe_url: Optional[str] = None) -> str:
    footer_unsub = (
        f'<p style="margin:16px 0 0">You are receiving occasional tips and reminders. '
        f'<a href="{unsubscribe_url}" style="color:#8a8f9c">Unsubscribe</a>.</p>'
        if unsubscribe_url
        else ""
    )
    return f"""\
<!doctype html><html><body style="margin:0;background:#0f1320;padding:24px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#151b2d;border-radius:14px;overflow:hidden">
      <tr><td style="padding:28px 32px 8px"><span style="font-size:20px;font-weight:800;color:#adc6ff">{_BRAND}</span></td></tr>
      <tr><td style="padding:8px 32px 4px"><h1 style="margin:0;font-size:22px;line-height:1.3;color:#eef1fb">{title}</h1></td></tr>
      <tr><td style="padding:12px 32px 28px;color:#c2c6d6;font-size:15px;line-height:1.6">{body_html}</td></tr>
    </table>
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">
      <tr><td style="padding:16px 32px;color:#6b7080;font-size:12px;line-height:1.5">
        <p style="margin:0">{_BRAND} — AI image & caption studio.</p>{footer_unsub}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>"""


def _button(label: str, url: str) -> str:
    return (
        f'<a href="{url}" style="display:inline-block;background:#adc6ff;color:#0f1320;'
        f'font-weight:700;text-decoration:none;padding:11px 20px;border-radius:9px">{label}</a>'
    )


def _greeting(name: str) -> str:
    first = (name or "").strip().split(" ")[0]
    return f"Hi {first}," if first and "@" not in first else "Hi there,"


# --- Templates ----------------------------------------------------------------
# Each returns (subject, html, text). `ctx` carries trigger-specific data.

def _tpl_welcome(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    body = (
        f"<p>{_greeting(name)}</p>"
        f"<p>Welcome to {_BRAND} — your studio for AI-generated images and captions. "
        f"Describe what you want and let the models do the work.</p>"
        f"<p style='margin:22px 0'>{_button('Open the studio', f'{settings.app_base_url}/create')}</p>"
        f"<p>Need credits to generate? You can grab some any time from your account.</p>"
    )
    return f"Welcome to {_BRAND} 🎨", _shell(f"Welcome to {_BRAND}", body), \
        f"Welcome to {_BRAND}. Open the studio: {settings.app_base_url}/create"


def _tpl_drip(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    step = ctx.get("step", "day1")
    unsub = _unsubscribe_url(uid)
    lessons = {
        "day1": (
            "Get the most out of Smart Generation",
            "<p>Smart Generation writes a caption <em>and</em> an image from one prompt. "
            "Try describing a scene, a mood, and a style together — the more specific, the better.</p>",
            "Try Smart Generation",
            "/create",
        ),
        "day3": (
            "Explore Packs — batch-create on brand",
            "<p>Packs let you generate a whole set of on-brand visuals at once — great for a launch, "
            "a campaign, or a social calendar. Pick a pack and let the agent plan it.</p>",
            "Browse Packs",
            "/packs",
        ),
        "day7": (
            "Make it yours",
            "<p>Upload reference images, reuse them across generations, and switch models to match the look "
            "you want. Small tweaks to your prompt go a long way.</p>",
            "Keep creating",
            "/create",
        ),
    }
    title, para, cta, path = lessons.get(step, lessons["day1"])
    body = (
        f"<p>{_greeting(name)}</p>{para}"
        f"<p style='margin:22px 0'>{_button(cta, f'{settings.app_base_url}{path}')}</p>"
    )
    return f"{title} · {_BRAND}", _shell(title, body, unsubscribe_url=unsub), \
        f"{title}. {settings.app_base_url}{path}"


def _tpl_account_deactivated(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    body = (
        f"<p>{_greeting(name)}</p>"
        f"<p>Your {_BRAND} account has been deactivated and access is now disabled. "
        f"If this wasn't you or you'd like it restored, just reply to this email.</p>"
    )
    return f"Your {_BRAND} account was deactivated", _shell("Account deactivated", body), \
        f"Your {_BRAND} account has been deactivated."


def _tpl_account_suspended(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    reason = str(ctx.get("reason") or "").strip()
    until = ctx.get("until")
    reason_html = f"<p><strong>Reason:</strong> {reason}</p>" if reason else ""
    until_html = ""
    if until:
        try:
            from datetime import datetime, timezone

            until_html = (
                f"<p>Your access is restricted until "
                f"{datetime.fromtimestamp(int(until), tz=timezone.utc):%Y-%m-%d %H:%M UTC}.</p>"
            )
        except Exception:
            until_html = ""
    body = (
        f"<p>{_greeting(name)}</p>"
        f"<p>Your {_BRAND} account has been suspended for a policy violation.</p>"
        f"{reason_html}{until_html}"
        f"<p>If you believe this was a mistake, reply to this email and we'll review it.</p>"
    )
    return f"Your {_BRAND} account was suspended", _shell("Account suspended", body), \
        f"Your {_BRAND} account has been suspended. {reason}"


def _tpl_account_unsuspended(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    body = (
        f"<p>{_greeting(name)}</p>"
        f"<p>Good news — your {_BRAND} account has been reinstated and you can create again. "
        f"Thanks for keeping things within the guidelines.</p>"
        f"<p style='margin:22px 0'>{_button('Back to the studio', f'{settings.app_base_url}/create')}</p>"
    )
    return f"Your {_BRAND} account is active again", _shell("Account reinstated", body), \
        f"Your {_BRAND} account has been reinstated."


def _tpl_credit_receipt(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    credits = ctx.get("credits")
    balance = ctx.get("balance")
    expires_at = ctx.get("expires_at")
    credits_txt = f"{credits:g}" if isinstance(credits, (int, float)) else str(credits)
    balance_line = (
        f"<p><strong>New balance:</strong> {balance:g} credits</p>"
        if isinstance(balance, (int, float))
        else ""
    )
    expiry_line = ""
    if expires_at:
        try:
            from datetime import datetime, timezone

            expiry_line = (
                f"<p style='color:#ffcf8f'>These gift credits expire on "
                f"{datetime.fromtimestamp(int(expires_at), tz=timezone.utc):%Y-%m-%d} — use them before then.</p>"
            )
        except Exception:
            expiry_line = ""
    body = (
        f"<p>{_greeting(name)}</p>"
        f"<p><strong>{credits_txt} credits</strong> have been added to your account.</p>"
        f"{balance_line}{expiry_line}"
        f"<p style='margin:22px 0'>{_button('Start creating', f'{settings.app_base_url}/create')}</p>"
    )
    return f"You've got {credits_txt} {_BRAND} credits", _shell("Credits added", body), \
        f"{credits_txt} credits added to your {_BRAND} account."


def _tpl_credit_expiry_warn(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    remaining = ctx.get("remaining")
    remaining_txt = f"{remaining:g}" if isinstance(remaining, (int, float)) else str(remaining)
    body = (
        f"<p>{_greeting(name)}</p>"
        f"<p>Heads up — <strong>{remaining_txt} of your gift credits expire within the next 24 hours.</strong> "
        f"Use them before they're gone.</p>"
        f"<p style='margin:22px 0'>{_button('Use my credits', f'{settings.app_base_url}/create')}</p>"
    )
    return f"{remaining_txt} {_BRAND} credits expire soon", _shell("Your credits expire soon", body), \
        f"{remaining_txt} gift credits expire within 24 hours. {settings.app_base_url}/create"


def _tpl_winback(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    unsub = _unsubscribe_url(uid)
    step = ctx.get("step", "d7")
    if step == "d14":
        title = f"Your creations are waiting at {_BRAND}"
        para = "<p>It's been a couple of weeks. New models and packs have landed since you last created — come see what you can make now.</p>"
    else:
        title = f"We miss you at {_BRAND}"
        para = "<p>You haven't created in a while. Pick up where you left off — a great image is one prompt away.</p>"
    body = (
        f"<p>{_greeting(name)}</p>{para}"
        f"<p style='margin:22px 0'>{_button('Create something', f'{settings.app_base_url}/create')}</p>"
    )
    return title, _shell(title, body, unsubscribe_url=unsub), f"{title}. {settings.app_base_url}/create"


def _tpl_feedback_ack(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    body = (
        f"<p>{_greeting(name)}</p>"
        f"<p>Thanks for your feedback — we've received it and the team will take a look. "
        f"We read everything, even when we can't reply to each note individually.</p>"
    )
    return f"We got your feedback · {_BRAND}", _shell("Thanks for the feedback", body), \
        f"Thanks for your feedback — we've received it."


_TEMPLATES = {
    "welcome": _tpl_welcome,
    "drip": _tpl_drip,
    "account_deactivated": _tpl_account_deactivated,
    "account_suspended": _tpl_account_suspended,
    "account_unsuspended": _tpl_account_unsuspended,
    "credit_receipt": _tpl_credit_receipt,
    "credit_expiry_warn": _tpl_credit_expiry_warn,
    "winback": _tpl_winback,
    "feedback_ack": _tpl_feedback_ack,
}


# --- Core dispatch ------------------------------------------------------------

def dispatch(
    trigger: str,
    uid: str,
    *,
    dedupe_key: str,
    to_email: str,
    to_name: str = "",
    ctx: Optional[dict] = None,
    lang: str = "en",
) -> bool:
    """Send one automatic email. Idempotent, consent-aware, never raises.

    Returns True only when a message was actually accepted by the provider (or
    dry-run). False for: duplicate (already sent), missing consent, no email,
    unknown trigger, or a send failure (recorded as ``failed``)."""
    ctx = ctx or {}
    to_email = (to_email or "").strip()
    if not to_email or "@" not in to_email:
        return False
    template = _TEMPLATES.get(trigger)
    if template is None:
        logger.error("email dispatch: unknown trigger %r", trigger)
        return False

    category = _category_for(trigger)
    try:
        # Claim + consent in one transaction so a duplicate never even renders.
        with session_scope() as session:
            repo = SecurityRepository(session)
            user = repo.get_user(uid)
            if category == "marketing":
                if (
                    user is None
                    or bool(user.is_deactivated)
                    or bool(user.is_suspended)
                    or not bool(user.email_lifecycle_enabled)
                ):
                    return False
            # Localize to the recipient's stored UI language when we have it;
            # the caller-passed `lang` (default "en") is the fallback. Templates
            # read ctx["lang"]. Copy is English-only for now, so this is inert
            # until localized strings land — the plumbing is here as the drop-in.
            effective_lang = getattr(user, "preferred_language", None) or lang or "en"
            ctx.setdefault("lang", effective_lang)
            send_id = repo.claim_email_send(uid, trigger, dedupe_key)
            if send_id is None:
                return False  # already claimed → no double-send

        subject, html, text = template(to_name, ctx, uid)
        headers = {}
        if category == "marketing":
            unsub = _unsubscribe_url(uid)
            headers["List-Unsubscribe"] = f"<{unsub}>"
            headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"

        result = send_email(
            OutgoingEmail(
                to_email=to_email,
                to_name=to_name,
                subject=subject,
                html=html,
                text=text,
                headers=headers,
            )
        )

        with session_scope() as session:
            repo = SecurityRepository(session)
            repo.mark_email_send(
                send_id,
                status="sent" if result.ok else "failed",
                provider_message_id=result.message_id,
                error=result.error,
                sent_at=int(time.time()) if result.ok else None,
            )
        if not result.ok:
            logger.warning("email %s to %s failed: %s", trigger, uid, result.error)
        return result.ok
    except Exception:
        logger.exception("email dispatch crashed for %s/%s", trigger, uid)
        return False


# --- Phase-2 scheduled sweeps -------------------------------------------------

# Onboarding drip step windows, measured from created_at. Each daily run emails
# users whose account age fell into the [lo, hi) day band since the last run.
_DRIP_STEPS = [("day1", 1, 2), ("day3", 3, 4), ("day7", 7, 8)]
_DAY = 24 * 60 * 60


def run_drip_sweep() -> dict[str, int]:
    now = int(time.time())
    sent = 0
    scanned = 0
    for step, lo_days, hi_days in _DRIP_STEPS:
        # created between (now - hi_days) and (now - lo_days)
        start_at = now - hi_days * _DAY
        end_at = now - lo_days * _DAY
        with session_scope() as session:
            repo = SecurityRepository(session)
            rows = repo.list_users_created_between(start_at, end_at)
        scanned += len(rows)
        for uid, email, name in rows:
            if dispatch(
                "drip", uid, dedupe_key=step, to_email=email, to_name=name, ctx={"step": step}
            ):
                sent += 1
    return {"scanned": scanned, "sent": sent}


def run_expiry_warn_sweep() -> dict[str, int]:
    now = int(time.time())
    threshold = now + _DAY
    with session_scope() as session:
        repo = SecurityRepository(session)
        lots = repo.list_lots_expiring_before(threshold, now)
    sent = 0
    for lot_id, uid, email, name, expires_at, remaining_minor in lots:
        remaining_credits = round(remaining_minor / 100, 2)
        if dispatch(
            "credit_expiry_warn",
            uid,
            dedupe_key=lot_id,
            to_email=email,
            to_name=name,
            ctx={"remaining": remaining_credits, "expires_at": expires_at},
        ):
            sent += 1
    return {"scanned": len(lots), "sent": sent}


def run_winback_sweep() -> dict[str, int]:
    now = int(time.time())
    sent = 0
    scanned = 0
    # d7: last seen in (14d ago, 7d ago]; d14: last seen in (21d ago, 14d ago].
    for step, lo_days, hi_days in [("d7", 7, 14), ("d14", 14, 21)]:
        seen_before = now - lo_days * _DAY
        seen_after = now - hi_days * _DAY
        with session_scope() as session:
            repo = SecurityRepository(session)
            rows = repo.list_users_dormant_since(seen_before, seen_after)
        scanned += len(rows)
        for uid, email, name in rows:
            if dispatch(
                "winback", uid, dedupe_key=step, to_email=email, to_name=name, ctx={"step": step}
            ):
                sent += 1
    return {"scanned": scanned, "sent": sent}
