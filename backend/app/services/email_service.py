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
_SUPPORT_EMAIL = "contact@ouni.space"


def _support_link() -> str:
    return (
        f'<a href="mailto:{_SUPPORT_EMAIL}" '
        f'style="color:#3d4552;text-decoration:underline">{_SUPPORT_EMAIL}</a>'
    )


def _shell(title: str, body_html: str, *, preheader: str = "", unsubscribe_url: Optional[str] = None) -> str:
    footer_unsub = (
        f'<p style="margin:16px 0 0">You are receiving occasional tips and reminders. '
        f'<a href="{unsubscribe_url}" style="color:#586274;text-decoration:underline">Unsubscribe</a>.</p>'
        if unsubscribe_url
        else ""
    )
    # Hidden inbox-preview text; the padding run stops body copy bleeding into it.
    if preheader:
        pad = "&#8199;&#65279;&#847; " * 20
        preheader_html = (
            '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;'
            'opacity:0;color:transparent;height:0;width:0;font-size:1px;line-height:1px">'
            f"{preheader}{pad}</div>"
        )
    else:
        preheader_html = ""
    return f"""\
<!doctype html><html><body style="margin:0;background:#f5f6f9;padding:32px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">{preheader_html}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#ffffff;border:1px solid #e7eaf0;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(30,37,49,0.06)">
      <tr><td style="padding:36px 40px 0"><h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:600;line-height:1.35;color:#1e2531">{title}</h1></td></tr>
      <tr><td style="padding:16px 40px 36px;color:#3d4552;font-size:15px;line-height:1.65">{body_html}</td></tr>
    </table>
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">
      <tr><td style="padding:18px 40px 8px;color:#586274;font-size:12px;line-height:1.55">
        <p style="margin:0;font-size:11px;color:#586274">{_BRAND} &middot; Tunis, Tunisia &middot; vibecraft.ouni.space</p>{footer_unsub}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>"""


def _button(label: str, url: str) -> str:
    return (
        f'<a href="{url}" style="display:inline-block;background-color:#2563eb;color:#ffffff;'
        f'font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px">{label}</a>'
    )


def _greeting(name: str) -> str:
    first = (name or "").strip().split(" ")[0]
    return f"Hi {first}," if first and "@" not in first else "Hi there,"


# --- Templates ----------------------------------------------------------------
# Each returns (subject, html, text). `ctx` carries trigger-specific data.

def _tpl_welcome(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    play = f"{settings.app_base_url}/playground"
    body = (
        f"<p>{_greeting(name)}</p>"
        f"<p>Thanks for joining {_BRAND}! You've just unlocked a single workspace packed with "
        f"the latest state-of-the-art AI image models.</p>"
        f"<p>We've already dropped free credits into your account so you can start experimenting "
        f"right away.</p>"
        f"<p>No setup, no friction. Just pure creativity.</p>"
        f"<p style='margin:22px 0'>{_button('Claim Your Credits &amp; Create', play)}</p>"
    )
    return f"Welcome to {_BRAND}", _shell(
        f"Welcome to {_BRAND} 🎨", body,
        preheader="Your first creations are on us — no card needed.",
    ), f"Welcome to {_BRAND}. Open Playground: {play}"


def _tpl_drip(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    step = ctx.get("step", "day1")
    unsub = _unsubscribe_url(uid)
    # (subject, preheader, heading, body_html, cta_label, path)
    lessons = {
        "day1": (
            "Talk straight to the models",
            "Playground is the heart of Vibecraft — direct, no menus.",
            "Meet Playground",
            "<p>Playground is the heart of Vibecraft — you talk directly to the models, like a "
            "conversation. Ask for an image, refine it, change direction, ask again. No forms, "
            "no long setup.</p>"
            "<p>It's just you and the models, going back and forth until it's exactly right.</p>",
            "Open Playground",
            "/playground",
        ),
        "day3": (
            "Transform your ideas into reality with Packs",
            "Product mockups, packaging, ads, and social — one canvas.",
            "Meet Packs",
            "<p>Now that you've explored the basics of Vibecraft, it's time to see how it fits "
            "into your actual workflow. Welcome to Packs.</p>"
            "<p>Whether you need to showcase a physical product, drop it into a completely new "
            "background, or design high-converting marketing assets, Packs gives you the exact "
            "canvas you need.</p>"
            "<p>From stunning product mockups and packaging designs to ready-to-go social media "
            "images and high-performing ads, you can create professional-grade visuals in just a "
            "few clicks — or simply browse them for instant inspiration.</p>"
            "<p>Ready to see what you can build?</p>",
            "Explore Vibecraft Packs",
            "/packs",
        ),
        "day7": (
            "Make it yours",
            "Reference images, model switching, and small tweaks that go far.",
            "Make it yours",
            "<p>In Playground you can upload reference images, reuse them across generations, and "
            "switch models to match the look you want. Small tweaks to your prompt go a long way.</p>",
            "Open Playground",
            "/playground",
        ),
    }
    subject, preheader, heading, para, cta, path = lessons.get(step, lessons["day1"])
    body = (
        f"<p>{_greeting(name)}</p>{para}"
        f"<p style='margin:22px 0'>{_button(cta, f'{settings.app_base_url}{path}')}</p>"
    )
    return subject, _shell(heading, body, preheader=preheader, unsubscribe_url=unsub), \
        f"{heading}. {settings.app_base_url}{path}"


def _tpl_account_deactivated(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    body = (
        f"<p>{_greeting(name)}</p>"
        f"<p>Your {_BRAND} account has been deactivated and access is now disabled. "
        f"If this wasn't you or you'd like it restored, contact us at {_support_link()}.</p>"
    )
    return f"Your {_BRAND} account was deactivated", _shell("Account deactivated", body), \
        f"Your {_BRAND} account has been deactivated. Contact {_SUPPORT_EMAIL} to restore it."


def _tpl_account_suspended(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    reason = str(ctx.get("reason") or "").strip()
    until = ctx.get("until")
    reason_html = f"<p><strong>Reason:</strong> {reason}</p>" if reason else ""
    sign_off = f"<p style='margin:18px 0 0;color:#586274'>— The {_BRAND} Security Team</p>"

    if until:
        # Timed suspension — there is a defined end date.
        try:
            from datetime import datetime, timezone

            until_txt = f"{datetime.fromtimestamp(int(until), tz=timezone.utc):%B %d, %Y, at %H:%M UTC}"
        except Exception:
            until_txt = ""
        period_html = (
            f"<p><strong>Suspension Period:</strong> Access is restricted until {until_txt}.</p>"
            if until_txt
            else ""
        )
        body = (
            f"<p>{_greeting(name)}</p>"
            f"<p>Your {_BRAND} account has been temporarily suspended due to repeated policy "
            f"violations.</p>"
            f"{reason_html}{period_html}"
            f"<p>Please note that further violations may result in a permanent ban of your "
            f"account.</p>"
            f"<p>If you believe this suspension was made in error or would like to appeal the "
            f"decision, please contact our support team at {_support_link()}, and we will "
            f"review your case.</p>"
            f"{sign_off}"
        )
        return f"Notice: Your {_BRAND} account has been suspended", \
            _shell("Account suspended", body), \
            f"Your {_BRAND} account has been suspended. {reason} Appeal: {_SUPPORT_EMAIL}"

    # No end date → permanent termination.
    body = (
        f"<p>{_greeting(name)}</p>"
        f"<p>Following a review of your account activity, your {_BRAND} account has been "
        f"permanently suspended due to severe or repeated violations of our Terms of Service.</p>"
        f"{reason_html}"
        f"<p><strong>Status:</strong> Account terminated permanently.</p>"
        f"<p>As a result, your access to the platform has been revoked, and any remaining "
        f"credits or active subscriptions have been canceled.</p>"
        f"<p>If you believe this decision was made in error and wish to appeal the termination, "
        f"you may submit a final review request to our team at {_support_link()}.</p>"
        f"{sign_off}"
    )
    return f"Notice: Your {_BRAND} account has been permanently terminated", \
        _shell("Account permanently terminated", body), \
        f"Your {_BRAND} account has been permanently terminated. {reason} Appeal: {_SUPPORT_EMAIL}"


def _tpl_account_unsuspended(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    body = (
        f"<p>{_greeting(name)}</p>"
        f"<p>Good news — your {_BRAND} account has been reinstated and you can create again. "
        f"You're all set — welcome back.</p>"
        f"<p style='margin:22px 0'>{_button('Back to the studio', f'{settings.app_base_url}/playground')}</p>"
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
                f"<p style='color:#1e2531;font-weight:600'>These gift credits expire on "
                f"{datetime.fromtimestamp(int(expires_at), tz=timezone.utc):%Y-%m-%d} — use them before then.</p>"
            )
        except Exception:
            expiry_line = ""
    body = (
        f"<p>{_greeting(name)}</p>"
        f"<p><strong>{credits_txt} credits</strong> have been added to your account.</p>"
        f"{balance_line}{expiry_line}"
        f"<p style='margin:22px 0'>{_button('Start creating', f'{settings.app_base_url}/playground')}</p>"
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
        f"<p style='margin:22px 0'>{_button('Use my credits', f'{settings.app_base_url}/playground')}</p>"
    )
    return f"{remaining_txt} {_BRAND} credits expire soon", _shell("Your credits expire soon", body), \
        f"{remaining_txt} gift credits expire within 24 hours. {settings.app_base_url}/playground"


def _tpl_winback(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    unsub = _unsubscribe_url(uid)
    step = ctx.get("step", "d7")
    if step == "d14":
        subject = f"Your creations are waiting at {_BRAND}"
        preheader = "Fresh models and smoother workflows are waiting."
        heading = "Missing that creative spark? ✨"
        para = (
            "<p>It's been a couple of weeks since your last creation. The studio has been "
            "upgraded with fresh models and smoother workflows — come see what's waiting for "
            "you.</p>"
        )
        cta, path = "See what's new", "/packs"
    else:
        subject = "Ready for your next one?"
        preheader = "Your next idea is one prompt away."
        heading = "Your studio's still warm 🔥"
        para = (
            "<p>Your next big idea is just a prompt away. Drop back into the studio, describe "
            "what's in your head, and let the models handle the rest.</p>"
        )
        cta, path = "Bring it to life", "/playground"
    body = (
        f"<p>{_greeting(name)}</p>{para}"
        f"<p style='margin:22px 0'>{_button(cta, f'{settings.app_base_url}{path}')}</p>"
    )
    return subject, _shell(heading, body, preheader=preheader, unsubscribe_url=unsub), \
        f"{heading}. {settings.app_base_url}{path}"


def _tpl_feedback_ack(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    body = (
        f"<p>{_greeting(name)}</p>"
        f"<p>Thanks for sharing your thoughts with us! We've received your feedback, and our "
        f"team is already taking a look.</p>"
        f"<p>We read every single note that comes through, even if we aren't always able to "
        f"reply to each one individually. Your insights are what help us make {_BRAND} better "
        f"every day.</p>"
        f"<p>Thanks for helping us build!</p>"
        f"<p style='margin:18px 0 0;color:#586274'>— The {_BRAND} Team</p>"
    )
    return f"We've received your feedback! 🙌", _shell("Thanks for the feedback", body), \
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
