"""Automatic email dispatch: consent, idempotency, templating, and the Phase-2 sweeps.

One entry point — ``dispatch`` — runs the full pipeline for a single email:
claim an ``email_sends`` row (idempotency), check consent for marketing mail,
render the template, send via ``email_client``, and record the outcome. It never
raises; hooks call it directly (welcome, once per user) or via BackgroundTasks
(endpoint events), and the scheduled sweeps call it in a loop.

Copy is localized to en / fr / ar. ``dispatch`` resolves the recipient's stored
``users.preferred_language`` into ``ctx["lang"]`` (falling back to "en" when the
column is null); every template reads that and pulls its strings from a per-
template catalog. Arabic renders right-to-left via ``_shell(lang="ar")``.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import time
from datetime import datetime, timezone
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


# --- Localization primitives --------------------------------------------------

_BRAND = "Vibecraft"
_SUPPORT_EMAIL = "contact@ouni.space"
_LANGS = ("en", "fr", "ar")


def _pick(table: dict, lang: str):
    """Catalog lookup that degrades to English for any unexpected language."""
    return table.get(lang) or table["en"]


def _support_link() -> str:
    return (
        f'<a href="mailto:{_SUPPORT_EMAIL}" '
        f'style="color:#3d4552;text-decoration:underline">{_SUPPORT_EMAIL}</a>'
    )


def _policy_link(text: str) -> str:
    return (
        f"<a href='{settings.app_base_url}/policy' "
        f"style='color:#3d4552;text-decoration:underline'>{text}</a>"
    )


# Month names by language — never rely on strftime locale (not generated on the
# VPS, and it is process-global). Arabic uses Western numerals, standard online.
_MONTHS = {
    "en": ["January", "February", "March", "April", "May", "June", "July",
           "August", "September", "October", "November", "December"],
    "fr": ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
           "août", "septembre", "octobre", "novembre", "décembre"],
    "ar": ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو",
           "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
}


def _fmt_datetime(ts: int, lang: str) -> str:
    dt = datetime.fromtimestamp(int(ts), tz=timezone.utc)
    month = _MONTHS.get(lang, _MONTHS["en"])[dt.month - 1]
    hm = f"{dt:%H:%M}"
    if lang == "fr":
        return f"{dt.day} {month} {dt.year} à {hm} UTC"
    if lang == "ar":
        return f"{dt.day} {month} {dt.year} الساعة {hm} بالتوقيت العالمي"
    return f"{month} {dt.day}, {dt.year}, at {hm} UTC"


def _fmt_date(ts: int, lang: str) -> str:
    dt = datetime.fromtimestamp(int(ts), tz=timezone.utc)
    if lang in ("fr", "ar"):
        month = _MONTHS.get(lang, _MONTHS["en"])[dt.month - 1]
        return f"{dt.day} {month} {dt.year}"
    return f"{dt:%Y-%m-%d}"


def _fmt_n(n) -> str:
    return f"{n:g}" if isinstance(n, (int, float)) else str(n)


def _ar_credits(n, gift: bool = False) -> str:
    """Arabic counted-noun agreement for 'credit' (رصيد).

    Arabic inflects the counted noun by the number: 1 singular, 2 dual, 3-10
    plural, 11-99 singular accusative (tamyiz), 100+ singular genitive. A single
    fixed form would read wrong for most counts.
    """
    txt = _fmt_n(n)
    if isinstance(n, (int, float)) and float(n) == int(n):
        i = int(n)
        if i == 1:
            return "رصيد مجاني واحد" if gift else "رصيد واحد"
        if i == 2:
            # Genitive dual: the phrase always follows إضافة / صلاحية / على.
            return "رصيدين مجانيين" if gift else "رصيدين"
        r = i % 100
        if 3 <= r <= 10:
            return f"{txt} أرصدة مجانية" if gift else f"{txt} أرصدة"
        if 11 <= r <= 99:
            return f"{txt} رصيدًا مجانيًا" if gift else f"{txt} رصيدًا"
    # 0, 100+, and fractional counts take the singular.
    return f"{txt} رصيد مجاني" if gift else f"{txt} رصيد"


def _credits_phrase(n, lang: str, gift: bool = False) -> str:
    """Counted noun phrase: '1 credit', '5 crédits offerts', '35 رصيدًا'."""
    if lang == "ar":
        return _ar_credits(n, gift)
    txt = _fmt_n(n)
    if lang == "fr":
        # French takes the singular below 2 (0,5 crédit / 1 crédit).
        one = isinstance(n, (int, float)) and abs(n) < 2
        if gift:
            return f"{txt} crédit offert" if one else f"{txt} crédits offerts"
        return f"{txt} crédit" if one else f"{txt} crédits"
    one = isinstance(n, (int, float)) and n == 1
    if gift:
        return f"{txt} gift credit" if one else f"{txt} gift credits"
    return f"{txt} credit" if one else f"{txt} credits"


def _verb_key(n, lang: str) -> str:
    """Pick the sentence whose verb agrees with the count."""
    if lang == "ar":
        return "many"  # Arabic sentences are phrased so the verb never varies.
    if lang == "fr":
        return "one" if isinstance(n, (int, float)) and abs(n) < 2 else "many"
    return "one" if isinstance(n, (int, float)) and n == 1 else "many"


def _greeting(name: str, lang: str = "en") -> str:
    first = (name or "").strip().split(" ")[0]
    has = bool(first) and "@" not in first
    if lang == "fr":
        return f"Bonjour {first}," if has else "Bonjour,"
    if lang == "ar":
        return f"مرحبًا {first}،" if has else "مرحبًا،"
    return f"Hi {first}," if has else "Hi there,"


# --- HTML shell ---------------------------------------------------------------

# Structural strings that live in the shell, not per-template.
_SHELL_TR = {
    "en": {
        "ident": f"{_BRAND} &middot; Tunis, Tunisia &middot; vibecraft.ouni.space",
        "unsub_pre": "You are receiving occasional tips and reminders.",
        "unsub_link": "Unsubscribe",
    },
    "fr": {
        "ident": f"{_BRAND} &middot; Tunis, Tunisie &middot; vibecraft.ouni.space",
        "unsub_pre": "Vous recevez occasionnellement des conseils et des rappels.",
        "unsub_link": "Se désabonner",
    },
    "ar": {
        "ident": f"{_BRAND} &middot; تونس &middot; vibecraft.ouni.space",
        "unsub_pre": "أنت تتلقى من حين لآخر نصائح وتذكيرات.",
        "unsub_link": "إلغاء الاشتراك",
    },
}


def _shell(
    title: str,
    body_html: str,
    *,
    preheader: str = "",
    unsubscribe_url: Optional[str] = None,
    lang: str = "en",
) -> str:
    s = _pick(_SHELL_TR, lang)
    rtl = lang == "ar"
    direction = "rtl" if rtl else "ltr"
    align = "right" if rtl else "left"
    # Georgia has no Arabic glyphs — fall back to a system stack for the title.
    title_font = (
        "'Segoe UI',Tahoma,Arial,sans-serif" if rtl
        else "Georgia,'Times New Roman',serif"
    )
    footer_unsub = (
        f'<p style="margin:16px 0 0">{s["unsub_pre"]} '
        f'<a href="{unsubscribe_url}" style="color:#586274;text-decoration:underline">{s["unsub_link"]}</a>.</p>'
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
<!doctype html><html dir="{direction}" lang="{lang}"><body style="margin:0;background:#f5f6f9;padding:32px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif" dir="{direction}">{preheader_html}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#ffffff;border:1px solid #e7eaf0;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(30,37,49,0.06)">
      <tr><td style="padding:36px 40px 0;text-align:{align}"><h1 style="margin:0;font-family:{title_font};font-size:20px;font-weight:600;line-height:1.35;color:#1e2531">{title}</h1></td></tr>
      <tr><td style="padding:16px 40px 36px;color:#3d4552;font-size:15px;line-height:1.65;text-align:{align}">{body_html}</td></tr>
    </table>
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">
      <tr><td style="padding:18px 40px 8px;color:#586274;font-size:12px;line-height:1.55;text-align:{align}">
        <p style="margin:0;font-size:11px;color:#586274">{s["ident"]}</p>{footer_unsub}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>"""


def _button(label: str, url: str) -> str:
    return (
        f'<a href="{url}" style="display:inline-block;background-color:#2563eb;color:#ffffff;'
        f'font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px">{label}</a>'
    )


def _paras(items) -> str:
    return "".join(f"<p>{p}</p>" for p in items)


# --- Templates ----------------------------------------------------------------
# Each returns (subject, html, text). `ctx` carries trigger-specific data;
# `ctx["lang"]` (set by dispatch) selects the language. Brand name is left in
# Latin in every language; product nouns match the shipped UI translations.

_TR_WELCOME = {
    "en": {
        "subject": "Welcome to Vibecraft",
        "heading": "Welcome to Vibecraft 🎨",
        "preheader": "Your first creations are on us — no card needed.",
        "p": [
            "Thanks for joining Vibecraft! You've just unlocked a single workspace packed with the latest state-of-the-art AI image models.",
            "We've already dropped free credits into your account so you can start experimenting right away.",
            "No setup, no friction. Just pure creativity.",
        ],
        "cta": "Claim Your Credits &amp; Create",
        "text": "Welcome to Vibecraft. Open Playground: {url}",
    },
    "fr": {
        "subject": "Bienvenue sur Vibecraft",
        "heading": "Bienvenue sur Vibecraft 🎨",
        "preheader": "Vos premières créations sont offertes — sans carte bancaire.",
        "p": [
            "Merci d'avoir rejoint Vibecraft ! Vous venez de débloquer un espace de travail unique réunissant les tout derniers modèles d'IA de génération d'images.",
            "Nous avons déjà ajouté des crédits gratuits à votre compte pour que vous puissiez commencer à expérimenter dès maintenant.",
            "Aucune configuration, aucune friction. Juste de la créativité.",
        ],
        "cta": "Récupérez vos crédits &amp; créez",
        "text": "Bienvenue sur Vibecraft. Ouvrir le Playground : {url}",
    },
    "ar": {
        "subject": "مرحبًا بك في Vibecraft",
        "heading": "مرحبًا بك في Vibecraft 🎨",
        "preheader": "أولى إبداعاتك على حسابنا — دون الحاجة إلى بطاقة.",
        "p": [
            "شكرًا لانضمامك إلى Vibecraft! لقد فتحت للتو مساحة عمل واحدة تضم أحدث نماذج الذكاء الاصطناعي لتوليد الصور.",
            "لقد أضفنا بالفعل أرصدة مجانية إلى حسابك حتى تتمكن من بدء التجربة على الفور.",
            "دون أي إعداد ودون أي تعقيد. فقط إبداع خالص.",
        ],
        "cta": "احصل على رصيدك وابدأ الإنشاء",
        "text": "مرحبًا بك في Vibecraft. افتح مساحة التجربة: {url}",
    },
}


def _tpl_welcome(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    lang = ctx.get("lang", "en")
    t = _pick(_TR_WELCOME, lang)
    play = f"{settings.app_base_url}/playground"
    body = (
        f"<p>{_greeting(name, lang)}</p>{_paras(t['p'])}"
        f"<p style='margin:22px 0'>{_button(t['cta'], play)}</p>"
    )
    return t["subject"], _shell(t["heading"], body, preheader=t["preheader"], lang=lang), \
        t["text"].format(url=play)


_TR_DRIP = {
    "day1": {
        "en": {
            "subject": "Talk straight to the models",
            "preheader": "Playground is the heart of Vibecraft — direct, no menus.",
            "heading": "Meet Playground",
            "p": [
                "Playground is the heart of Vibecraft — you talk directly to the models, like a conversation. Ask for an image, refine it, change direction, ask again. No forms, no long setup.",
                "It's just you and the models, going back and forth until it's exactly right.",
            ],
            "cta": "Open Playground",
        },
        "fr": {
            "subject": "Parlez directement aux modèles",
            "preheader": "Le Playground est le cœur de Vibecraft — direct, sans menus.",
            "heading": "Découvrez le Playground",
            "p": [
                "Le Playground est le cœur de Vibecraft : vous parlez directement aux modèles, comme dans une conversation. Demandez une image, affinez-la, changez de direction, redemandez. Aucun formulaire, aucune configuration.",
                "Il n'y a que vous et les modèles, qui échangez jusqu'à obtenir exactement ce que vous voulez.",
            ],
            "cta": "Ouvrir le Playground",
        },
        "ar": {
            "subject": "تحدّث مباشرةً إلى النماذج",
            "preheader": "مساحة التجربة هي قلب Vibecraft — مباشرة، دون قوائم.",
            "heading": "تعرّف على مساحة التجربة",
            "p": [
                "مساحة التجربة هي قلب Vibecraft — تتحدث مباشرةً إلى النماذج، كما في محادثة. اطلب صورة، حسّنها، غيّر الاتجاه، ثم اطلب من جديد. دون نماذج ودون إعداد طويل.",
                "أنت والنماذج فقط، تتبادلان الأخذ والرد حتى تصل إلى النتيجة الصحيحة تمامًا.",
            ],
            "cta": "افتح مساحة التجربة",
        },
    },
    "day3": {
        "en": {
            "subject": "Transform your ideas into reality with Packs",
            "preheader": "Product mockups, packaging, ads, and social — one canvas.",
            "heading": "Meet Packs",
            "p": [
                "Now that you've explored the basics of Vibecraft, it's time to see how it fits into your actual workflow. Welcome to Packs.",
                "Whether you need to showcase a physical product, drop it into a completely new background, or design high-converting marketing assets, Packs gives you the exact canvas you need.",
                "From stunning product mockups and packaging designs to ready-to-go social media images and high-performing ads, you can create professional-grade visuals in just a few clicks — or simply browse them for instant inspiration.",
                "Ready to see what you can build?",
            ],
            "cta": "Explore Vibecraft Packs",
        },
        "fr": {
            "subject": "Transformez vos idées en réalité avec les Packs",
            "preheader": "Mockups produits, packaging, publicités et réseaux sociaux — un seul canevas.",
            "heading": "Découvrez les Packs",
            "p": [
                "Maintenant que vous avez exploré les bases de Vibecraft, il est temps de voir comment il s'intègre à votre véritable flux de travail. Bienvenue dans les Packs.",
                "Que vous souhaitiez mettre en valeur un produit physique, le placer dans un décor entièrement nouveau ou concevoir des visuels marketing performants, les Packs vous offrent exactement le canevas qu'il vous faut.",
                "Des superbes mockups produits et designs de packaging jusqu'aux images prêtes à publier sur les réseaux sociaux et aux publicités performantes, vous pouvez créer des visuels de qualité professionnelle en quelques clics — ou simplement les parcourir pour une inspiration immédiate.",
                "Prêt à découvrir ce que vous pouvez créer ?",
            ],
            "cta": "Explorer les Packs Vibecraft",
        },
        "ar": {
            "subject": "حوّل أفكارك إلى واقع مع الحزم",
            "preheader": "نماذج للمنتجات، وتغليف، وإعلانات، ومحتوى اجتماعي — لوحة واحدة.",
            "heading": "تعرّف على الحزم",
            "p": [
                "الآن بعد أن اطّلعت على أساسيات Vibecraft، حان الوقت لترى كيف تتكامل مع سير عملك الفعلي. مرحبًا بك في الحزم.",
                "سواء أردت إبراز منتج مادي، أو وضعه في خلفية جديدة تمامًا، أو تصميم مواد تسويقية عالية الأداء، تمنحك الحزم اللوحة المناسبة تمامًا لما تحتاجه.",
                "من نماذج المنتجات وتصاميم التغليف المبهرة إلى صور جاهزة للنشر على وسائل التواصل وإعلانات عالية الأداء، يمكنك إنشاء تصاميم بجودة احترافية بنقرات قليلة — أو تصفّحها ببساطة للحصول على إلهام فوري.",
                "هل أنت مستعد لاكتشاف ما يمكنك إنشاؤه؟",
            ],
            "cta": "استكشف حزم Vibecraft",
        },
    },
    "day7": {
        "en": {
            "subject": "Make it yours",
            "preheader": "Reference images, model switching, and small tweaks that go far.",
            "heading": "Make it yours",
            "p": [
                "In Playground you can upload reference images, reuse them across generations, and switch models to match the look you want. Small tweaks to your prompt go a long way.",
            ],
            "cta": "Open Playground",
        },
        "fr": {
            "subject": "Personnalisez à votre image",
            "preheader": "Images de référence, changement de modèle et petits ajustements qui font la différence.",
            "heading": "Personnalisez à votre image",
            "p": [
                "Dans le Playground, vous pouvez importer des images de référence, les réutiliser d'une génération à l'autre et changer de modèle pour obtenir le rendu souhaité. De petits ajustements à votre prompt font toute la différence.",
            ],
            "cta": "Ouvrir le Playground",
        },
        "ar": {
            "subject": "اجعلها تعبّر عنك",
            "preheader": "صور مرجعية، وتبديل النماذج، وتعديلات صغيرة ذات أثر كبير.",
            "heading": "اجعلها تعبّر عنك",
            "p": [
                "في مساحة التجربة يمكنك رفع صور مرجعية، وإعادة استخدامها عبر عمليات التوليد، وتبديل النماذج للوصول إلى المظهر الذي تريده. التعديلات الصغيرة على وصفك تُحدث فرقًا كبيرًا.",
            ],
            "cta": "افتح مساحة التجربة",
        },
    },
}

_DRIP_PATH = {"day1": "/playground", "day3": "/packs", "day7": "/playground"}


def _tpl_drip(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    lang = ctx.get("lang", "en")
    step = ctx.get("step", "day1")
    if step not in _TR_DRIP:
        step = "day1"
    t = _pick(_TR_DRIP[step], lang)
    path = _DRIP_PATH.get(step, "/playground")
    url = f"{settings.app_base_url}{path}"
    unsub = _unsubscribe_url(uid)
    body = (
        f"<p>{_greeting(name, lang)}</p>{_paras(t['p'])}"
        f"<p style='margin:22px 0'>{_button(t['cta'], url)}</p>"
    )
    return t["subject"], \
        _shell(t["heading"], body, preheader=t["preheader"], unsubscribe_url=unsub, lang=lang), \
        f"{t['heading']}. {url}"


_TR_DEACTIVATED = {
    "en": {
        "subject": "Your Vibecraft account was deactivated",
        "heading": "Account deactivated",
        "body": "Your Vibecraft account has been deactivated and access is now disabled. If this wasn't you or you'd like it restored, contact us at {support}.",
        "text": "Your Vibecraft account has been deactivated. Contact {email} to restore it.",
    },
    "fr": {
        "subject": "Votre compte Vibecraft a été désactivé",
        "heading": "Compte désactivé",
        "body": "Votre compte Vibecraft a été désactivé et l'accès est désormais bloqué. Si vous n'êtes pas à l'origine de cette action ou si vous souhaitez le réactiver, contactez-nous à {support}.",
        "text": "Votre compte Vibecraft a été désactivé. Contactez {email} pour le réactiver.",
    },
    "ar": {
        "subject": "تم إلغاء تنشيط حسابك على Vibecraft",
        "heading": "تم إلغاء تنشيط الحساب",
        "body": "تم إلغاء تنشيط حسابك على Vibecraft، والوصول إليه معطّل الآن. إذا لم تكن أنت من قام بذلك أو كنت ترغب في استعادته، تواصل معنا عبر {support}.",
        "text": "تم إلغاء تنشيط حسابك على Vibecraft. تواصل مع {email} لاستعادته.",
    },
}


def _tpl_account_deactivated(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    lang = ctx.get("lang", "en")
    t = _pick(_TR_DEACTIVATED, lang)
    body = (
        f"<p>{_greeting(name, lang)}</p>"
        f"<p>{t['body'].format(support=_support_link())}</p>"
    )
    return t["subject"], _shell(t["heading"], body, lang=lang), \
        t["text"].format(email=_SUPPORT_EMAIL)


_TR_SUSPENDED = {
    "temp": {
        "en": {
            "subject": "Notice: Your Vibecraft account has been suspended",
            "heading": "Account suspended",
            "policy_word": "policy",
            "intro": "Your Vibecraft account has been temporarily suspended due to repeated {policy} violations.",
            "reason_label": "Reason:",
            "period": "Suspension Period: Access is restricted until {until}.",
            "warn": "Please note that further violations may result in a permanent ban of your account.",
            "appeal": "If you believe this suspension was made in error or would like to appeal the decision, please contact our support team at {support}, and we will review your case.",
            "signoff": "— The Vibecraft Security Team",
            "text": "Your Vibecraft account has been suspended.{reason} Appeal: {email}",
            "text_reason": " Reason: {r}.",
        },
        "fr": {
            "subject": "Avis : votre compte Vibecraft a été suspendu",
            "heading": "Compte suspendu",
            "policy_word": "règles d'utilisation",
            "intro": "Votre compte Vibecraft a été temporairement suspendu en raison de violations répétées de nos {policy}.",
            "reason_label": "Motif :",
            "period": "Durée de la suspension : l'accès est restreint jusqu'au {until}.",
            "warn": "Veuillez noter que toute nouvelle violation pourra entraîner le bannissement définitif de votre compte.",
            "appeal": "Si vous estimez que cette suspension est une erreur ou souhaitez la contester, veuillez contacter notre équipe d'assistance à {support}, et nous examinerons votre cas.",
            "signoff": "— L'équipe de sécurité Vibecraft",
            "text": "Votre compte Vibecraft a été suspendu.{reason} Contestation : {email}",
            "text_reason": " Motif : {r}.",
        },
        "ar": {
            "subject": "إشعار: تم تعليق حسابك على Vibecraft",
            "heading": "تم تعليق الحساب",
            "policy_word": "سياسة الاستخدام",
            "intro": "تم تعليق حسابك على Vibecraft مؤقتًا بسبب مخالفات متكررة لـ{policy} الخاصة بنا.",
            "reason_label": "السبب:",
            "period": "مدة التعليق: الوصول مقيّد حتى {until}.",
            "warn": "يرجى العلم أن أي مخالفات إضافية قد تؤدي إلى حظر دائم لحسابك.",
            "appeal": "إذا كنت تعتقد أن هذا التعليق قد تم عن طريق الخطأ أو ترغب في الطعن في القرار، يرجى التواصل مع فريق الدعم عبر {support}، وسنراجع حالتك.",
            "signoff": "— فريق الأمان في Vibecraft",
            "text": "تم تعليق حسابك على Vibecraft.{reason} للطعن: {email}",
            "text_reason": " السبب: {r}.",
        },
    },
    "perm": {
        "en": {
            "subject": "Notice: Your Vibecraft account has been permanently terminated",
            "heading": "Account permanently terminated",
            "policy_word": "Terms of Service",
            "intro": "Following a review of your account activity, your Vibecraft account has been permanently suspended due to severe or repeated violations of our {policy}.",
            "reason_label": "Reason:",
            "status": "Status: Account terminated permanently.",
            "conseq": "As a result, your access to the platform has been revoked, and any remaining credits or active subscriptions have been canceled.",
            "appeal": "If you believe this decision was made in error and wish to appeal the termination, you may submit a final review request to our team at {support}.",
            "signoff": "— The Vibecraft Security Team",
            "text": "Your Vibecraft account has been permanently terminated.{reason} Appeal: {email}",
            "text_reason": " Reason: {r}.",
        },
        "fr": {
            "subject": "Avis : votre compte Vibecraft a été définitivement résilié",
            "heading": "Compte définitivement résilié",
            "policy_word": "conditions d'utilisation",
            "intro": "À la suite d'un examen de l'activité de votre compte, votre compte Vibecraft a été définitivement suspendu en raison de violations graves ou répétées de nos {policy}.",
            "reason_label": "Motif :",
            "status": "Statut : compte définitivement résilié.",
            "conseq": "Par conséquent, votre accès à la plateforme a été révoqué, et tout crédit restant ou abonnement actif a été annulé.",
            "appeal": "Si vous estimez que cette décision est une erreur et souhaitez contester la résiliation, vous pouvez adresser une demande de réexamen final à notre équipe à {support}.",
            "signoff": "— L'équipe de sécurité Vibecraft",
            "text": "Votre compte Vibecraft a été définitivement résilié.{reason} Contestation : {email}",
            "text_reason": " Motif : {r}.",
        },
        "ar": {
            "subject": "إشعار: تم إنهاء حسابك على Vibecraft نهائيًا",
            "heading": "تم إنهاء الحساب نهائيًا",
            "policy_word": "شروط الخدمة",
            "intro": "بعد مراجعة نشاط حسابك، تم تعليق حسابك على Vibecraft نهائيًا بسبب مخالفات جسيمة أو متكررة لـ{policy} الخاصة بنا.",
            "reason_label": "السبب:",
            "status": "الحالة: تم إنهاء الحساب نهائيًا.",
            "conseq": "نتيجة لذلك، تم إلغاء وصولك إلى المنصة، وأُلغيت أي أرصدة متبقية أو اشتراكات نشطة.",
            "appeal": "إذا كنت تعتقد أن هذا القرار قد تم عن طريق الخطأ وترغب في الطعن في الإنهاء، يمكنك تقديم طلب مراجعة نهائية إلى فريقنا عبر {support}.",
            "signoff": "— فريق الأمان في Vibecraft",
            "text": "تم إنهاء حسابك على Vibecraft نهائيًا.{reason} للطعن: {email}",
            "text_reason": " السبب: {r}.",
        },
    },
}


def _tpl_account_suspended(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    lang = ctx.get("lang", "en")
    reason = str(ctx.get("reason") or "").strip()
    until = ctx.get("until")
    variant = "temp" if until else "perm"
    t = _pick(_TR_SUSPENDED[variant], lang)

    reason_html = f"<p><strong>{t['reason_label']}</strong> {reason}</p>" if reason else ""
    intro = t["intro"].format(policy=_policy_link(t["policy_word"]))
    sign_off = f"<p style='margin:18px 0 0;color:#586274'>{t['signoff']}</p>"

    if variant == "temp":
        until_txt = ""
        try:
            until_txt = _fmt_datetime(int(until), lang)
        except Exception:
            until_txt = ""
        period_html = (
            f"<p><strong>{t['period'].format(until=until_txt)}</strong></p>"
            if until_txt
            else ""
        )
        body = (
            f"<p>{_greeting(name, lang)}</p>"
            f"<p>{intro}</p>{reason_html}{period_html}"
            f"<p>{t['warn']}</p>"
            f"<p>{t['appeal'].format(support=_support_link())}</p>"
            f"{sign_off}"
        )
    else:
        body = (
            f"<p>{_greeting(name, lang)}</p>"
            f"<p>{intro}</p>{reason_html}"
            f"<p><strong>{t['status']}</strong></p>"
            f"<p>{t['conseq']}</p>"
            f"<p>{t['appeal'].format(support=_support_link())}</p>"
            f"{sign_off}"
        )

    # Label the admin-entered reason in plain text too (the HTML already does),
    # and drop the clause entirely when no reason was given.
    reason_clause = t["text_reason"].format(r=reason.rstrip(". ")) if reason else ""
    return t["subject"], _shell(t["heading"], body, lang=lang), \
        t["text"].format(reason=reason_clause, email=_SUPPORT_EMAIL)


_TR_UNSUSPENDED = {
    "en": {
        "subject": "Your Vibecraft account is active again",
        "heading": "Account reinstated",
        "body": "Good news — your Vibecraft account has been reinstated and you can create again. You're all set — welcome back.",
        "cta": "Back to the studio",
        "text": "Your Vibecraft account has been reinstated.",
    },
    "fr": {
        "subject": "Votre compte Vibecraft est de nouveau actif",
        "heading": "Compte réactivé",
        "body": "Bonne nouvelle — votre compte Vibecraft a été réactivé et vous pouvez de nouveau créer. Tout est prêt — bon retour parmi nous.",
        "cta": "Retour au studio",
        "text": "Votre compte Vibecraft a été réactivé.",
    },
    "ar": {
        "subject": "أصبح حسابك على Vibecraft نشطًا من جديد",
        "heading": "تمت إعادة تفعيل الحساب",
        "body": "أخبار سارّة — تمت إعادة تفعيل حسابك على Vibecraft ويمكنك الإبداع من جديد. كل شيء جاهز — أهلًا بعودتك.",
        "cta": "العودة إلى الاستوديو",
        "text": "تمت إعادة تفعيل حسابك على Vibecraft.",
    },
}


def _tpl_account_unsuspended(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    lang = ctx.get("lang", "en")
    t = _pick(_TR_UNSUSPENDED, lang)
    play = f"{settings.app_base_url}/playground"
    body = (
        f"<p>{_greeting(name, lang)}</p>"
        f"<p>{t['body']}</p>"
        f"<p style='margin:22px 0'>{_button(t['cta'], play)}</p>"
    )
    return t["subject"], _shell(t["heading"], body, lang=lang), t["text"]


_TR_RECEIPT = {
    "en": {
        "subject": "You've got {c} on Vibecraft",
        "heading": "Credits added",
        "added": {
            "one": "<strong>{c}</strong> has been added to your account.",
            "many": "<strong>{c}</strong> have been added to your account.",
        },
        "balance": "New balance: {b}",
        "expiry": "These gift credits expire on {date} — use them before then.",
        "cta": "Start creating",
        "text": {
            "one": "{c} added to your Vibecraft account.",
            "many": "{c} added to your Vibecraft account.",
        },
    },
    "fr": {
        "subject": "Vous avez reçu {c} sur Vibecraft",
        "heading": "Crédits ajoutés",
        "added": {
            "one": "<strong>{c}</strong> a été ajouté à votre compte.",
            "many": "<strong>{c}</strong> ont été ajoutés à votre compte.",
        },
        "balance": "Nouveau solde : {b}",
        "expiry": "Ces crédits offerts expirent le {date} — utilisez-les avant cette date.",
        "cta": "Commencer à créer",
        "text": {
            "one": "{c} ajouté à votre compte Vibecraft.",
            "many": "{c} ajoutés à votre compte Vibecraft.",
        },
    },
    "ar": {
        "subject": "لقد حصلت على {c} في Vibecraft",
        "heading": "تمت إضافة الأرصدة",
        "added": {
            "one": "تمت إضافة <strong>{c}</strong> إلى حسابك.",
            "many": "تمت إضافة <strong>{c}</strong> إلى حسابك.",
        },
        "balance": "الرصيد الجديد: {b}",
        "expiry": "تنتهي صلاحية هذه الأرصدة المجانية في {date} — استخدمها قبل ذلك.",
        "cta": "ابدأ الإنشاء",
        "text": {
            "one": "تمت إضافة {c} إلى حسابك على Vibecraft.",
            "many": "تمت إضافة {c} إلى حسابك على Vibecraft.",
        },
    },
}


def _tpl_credit_receipt(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    lang = ctx.get("lang", "en")
    t = _pick(_TR_RECEIPT, lang)
    credits = ctx.get("credits")
    balance = ctx.get("balance")
    expires_at = ctx.get("expires_at")
    phrase = _credits_phrase(credits, lang)
    balance_line = (
        f"<p><strong>{t['balance'].format(b=_credits_phrase(balance, lang))}</strong></p>"
        if isinstance(balance, (int, float))
        else ""
    )
    expiry_line = ""
    if expires_at:
        try:
            expiry_line = (
                f"<p style='color:#1e2531;font-weight:600'>"
                f"{t['expiry'].format(date=_fmt_date(int(expires_at), lang))}</p>"
            )
        except Exception:
            expiry_line = ""
    body = (
        f"<p>{_greeting(name, lang)}</p>"
        f"<p>{t['added'][_verb_key(credits, lang)].format(c=phrase)}</p>"
        f"{balance_line}{expiry_line}"
        f"<p style='margin:22px 0'>{_button(t['cta'], f'{settings.app_base_url}/playground')}</p>"
    )
    return t["subject"].format(c=phrase), _shell(t["heading"], body, lang=lang), \
        t["text"][_verb_key(credits, lang)].format(c=phrase)


_TR_EXPIRY = {
    "en": {
        "subject": {
            "one": "{c} expires soon",
            "many": "{c} expire soon",
        },
        "heading": "Your credits expire soon",
        "body": {
            "one": "Heads up — <strong>{c} expires within the next 24 hours.</strong> Use it before it's gone.",
            "many": "Heads up — <strong>{c} expire within the next 24 hours.</strong> Use them before they're gone.",
        },
        "cta": "Use my credits",
        "text": {
            "one": "{c} expires within 24 hours. {url}",
            "many": "{c} expire within 24 hours. {url}",
        },
    },
    "fr": {
        "subject": {
            "one": "{c} expire bientôt",
            "many": "{c} expirent bientôt",
        },
        "heading": "Vos crédits expirent bientôt",
        "body": {
            "one": "Petit rappel — <strong>{c} expire dans les prochaines 24 heures.</strong> Utilisez-le avant qu'il ne disparaisse.",
            "many": "Petit rappel — <strong>{c} expirent dans les prochaines 24 heures.</strong> Utilisez-les avant qu'ils ne disparaissent.",
        },
        "cta": "Utiliser mes crédits",
        "text": {
            "one": "{c} expire dans 24 heures. {url}",
            "many": "{c} expirent dans 24 heures. {url}",
        },
    },
    "ar": {
        # Verb fronted (تنتهي صلاحية …) so it agrees with "صلاحية", never the count.
        "subject": {
            "one": "تنتهي قريبًا صلاحية {c} في Vibecraft",
            "many": "تنتهي قريبًا صلاحية {c} في Vibecraft",
        },
        "heading": "أرصدتك على وشك الانتهاء",
        "body": {
            "one": "تنبيه — <strong>تنتهي صلاحية {c} خلال الـ24 ساعة القادمة.</strong> استخدمها قبل أن تختفي.",
            "many": "تنبيه — <strong>تنتهي صلاحية {c} خلال الـ24 ساعة القادمة.</strong> استخدمها قبل أن تختفي.",
        },
        "cta": "استخدم أرصدتي",
        "text": {
            "one": "تنتهي صلاحية {c} خلال 24 ساعة. {url}",
            "many": "تنتهي صلاحية {c} خلال 24 ساعة. {url}",
        },
    },
}


def _tpl_credit_expiry_warn(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    lang = ctx.get("lang", "en")
    t = _pick(_TR_EXPIRY, lang)
    remaining = ctx.get("remaining")
    k = _verb_key(remaining, lang)
    phrase = _credits_phrase(remaining, lang, gift=True)
    play = f"{settings.app_base_url}/playground"
    body = (
        f"<p>{_greeting(name, lang)}</p>"
        f"<p>{t['body'][k].format(c=phrase)}</p>"
        f"<p style='margin:22px 0'>{_button(t['cta'], play)}</p>"
    )
    return t["subject"][k].format(c=phrase), _shell(t["heading"], body, lang=lang), \
        t["text"][k].format(c=phrase, url=play)


_TR_WINBACK = {
    "d7": {
        "en": {
            "subject": "Ready for your next one?",
            "preheader": "Your next idea is one prompt away.",
            "heading": "Your studio's still warm 🔥",
            "p": ["Your next big idea is just a prompt away. Drop back into the studio, describe what's in your head, and let the models handle the rest."],
            "cta": "Bring it to life",
        },
        "fr": {
            "subject": "Prêt pour la prochaine ?",
            "preheader": "Votre prochaine idée n'est qu'à un prompt.",
            "heading": "Votre studio est encore chaud 🔥",
            "p": ["Votre prochaine grande idée n'est qu'à un prompt. Revenez dans le studio, décrivez ce que vous avez en tête, et laissez les modèles s'occuper du reste."],
            "cta": "Donnez-lui vie",
        },
        "ar": {
            "subject": "مستعد للإبداع التالي؟",
            "preheader": "فكرتك التالية على بُعد وصف واحد.",
            "heading": "استوديوك ما زال متّقدًا 🔥",
            "p": ["فكرتك الكبيرة التالية على بُعد وصف واحد فقط. عُد إلى الاستوديو، صِف ما يدور في ذهنك، ودع النماذج تتكفّل بالباقي."],
            "cta": "حوّلها إلى واقع",
        },
    },
    "d14": {
        "en": {
            "subject": "Your creations are waiting at Vibecraft",
            "preheader": "Fresh models and smoother workflows are waiting.",
            "heading": "Missing that creative spark? ✨",
            "p": ["It's been a couple of weeks since your last creation. The studio has been upgraded with fresh models and smoother workflows — come see what's waiting for you."],
            "cta": "See what's new",
        },
        "fr": {
            "subject": "Vos créations vous attendent sur Vibecraft",
            "preheader": "De nouveaux modèles et des flux plus fluides vous attendent.",
            "heading": "L'étincelle créative vous manque ? ✨",
            "p": ["Cela fait deux semaines depuis votre dernière création. Le studio a été enrichi de nouveaux modèles et de flux de travail plus fluides — venez découvrir ce qui vous attend."],
            "cta": "Voir les nouveautés",
        },
        "ar": {
            "subject": "إبداعاتك بانتظارك في Vibecraft",
            "preheader": "نماذج جديدة وسير عمل أكثر سلاسة بانتظارك.",
            "heading": "هل تفتقد شرارة الإبداع؟ ✨",
            "p": ["مرّ أسبوعان منذ آخر إبداع لك. تم تطوير الاستوديو بنماذج جديدة وسير عمل أكثر سلاسة — تعال واكتشف ما ينتظرك."],
            "cta": "اكتشف الجديد",
        },
    },
}

_WINBACK_PATH = {"d7": "/playground", "d14": "/packs"}


def _tpl_winback(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    lang = ctx.get("lang", "en")
    step = ctx.get("step", "d7")
    if step not in _TR_WINBACK:
        step = "d7"
    t = _pick(_TR_WINBACK[step], lang)
    path = _WINBACK_PATH.get(step, "/playground")
    url = f"{settings.app_base_url}{path}"
    unsub = _unsubscribe_url(uid)
    body = (
        f"<p>{_greeting(name, lang)}</p>{_paras(t['p'])}"
        f"<p style='margin:22px 0'>{_button(t['cta'], url)}</p>"
    )
    return t["subject"], \
        _shell(t["heading"], body, preheader=t["preheader"], unsubscribe_url=unsub, lang=lang), \
        f"{t['heading']}. {url}"


_TR_FEEDBACK = {
    "en": {
        "subject": "We've received your feedback",
        "heading": "Thanks for the feedback",
        "p": [
            "Thanks for sharing your thoughts with us! 🙌 We've received your feedback, and our team is already taking a look.",
            "We read every single note that comes through, even if we aren't always able to reply to each one individually. Your insights are what help us make Vibecraft better every day.",
            "Thanks for helping us build!",
        ],
        "signoff": "— The Vibecraft Team",
        "text": "Thanks for your feedback — we've received it.",
    },
    "fr": {
        "subject": "Nous avons bien reçu votre retour",
        "heading": "Merci pour votre retour",
        "p": [
            "Merci d'avoir partagé votre avis avec nous ! 🙌 Nous avons bien reçu votre retour, et notre équipe y jette déjà un œil.",
            "Nous lisons chaque message qui nous parvient, même si nous ne pouvons pas toujours répondre à chacun individuellement. Vos retours sont ce qui nous aide à améliorer Vibecraft chaque jour.",
            "Merci de contribuer à notre développement !",
        ],
        "signoff": "— L'équipe Vibecraft",
        "text": "Merci pour votre retour — nous l'avons bien reçu.",
    },
    "ar": {
        "subject": "لقد استلمنا ملاحظاتك",
        "heading": "شكرًا على ملاحظاتك",
        "p": [
            "شكرًا لمشاركتنا رأيك! 🙌 لقد استلمنا ملاحظاتك، وفريقنا يطّلع عليها بالفعل.",
            "نقرأ كل رسالة تصلنا، حتى وإن لم نتمكن دائمًا من الرد على كل واحدة على حدة. ملاحظاتك هي ما يساعدنا على تحسين Vibecraft كل يوم.",
            "شكرًا لمساهمتك في بنائنا!",
        ],
        "signoff": "— فريق Vibecraft",
        "text": "شكرًا على ملاحظاتك — لقد استلمناها.",
    },
}


def _tpl_feedback_ack(name: str, ctx: dict, uid: str) -> tuple[str, str, str]:
    lang = ctx.get("lang", "en")
    t = _pick(_TR_FEEDBACK, lang)
    body = (
        f"<p>{_greeting(name, lang)}</p>{_paras(t['p'])}"
        f"<p style='margin:18px 0 0;color:#586274'>{t['signoff']}</p>"
    )
    return t["subject"], _shell(t["heading"], body, lang=lang), t["text"]


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
            # Localize to the recipient's stored UI language when we have it; the
            # caller-passed `lang` (default "en") is the fallback, and templates
            # degrade to English for any value outside en/fr/ar. Null column =>
            # English, per product rule.
            effective_lang = getattr(user, "preferred_language", None) or lang or "en"
            if effective_lang not in _LANGS:
                effective_lang = "en"
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
