import json
import logging
import os
from copy import deepcopy
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

CREATE_FLOW_IMAGE_PARAM_KEYS = {
    "aspectRatio",
    "imageSize",
    "resolution",
    "sampleImageSize",
    "quality",
    "seed",
    "addWatermark",
    "enhancePrompt",
    "outputMimeType",
}

CREATE_FLOW_TEXT_PARAM_KEYS = {
    "temperature",
    "topP",
    "maxOutputTokens",
    "thinkingBudget",
    "thinkingLevel",
    "mediaResolution",
    "promptCacheKey",
}

# The credit packs a user can order. Server-authoritative on purpose: the client
# only ever sends a plan id, and the order snapshots credits/price from here, so a
# tampered request can never make an admin approve a number the user invented.
# `price_minor` is millimes (TND has 3 decimals): 15000 = 15.000 DT.
CREDIT_PLANS = [
    {"id": "starter", "name": "Starter", "credits": 10.0, "price_minor": 15000, "currency": "TND"},
    {"id": "pro", "name": "Pro", "credits": 35.0, "price_minor": 39000, "currency": "TND"},
    {"id": "ultra", "name": "Ultra", "credits": 70.0, "price_minor": 69000, "currency": "TND"},
]

CREDIT_PLANS_BY_ID = {plan["id"]: plan for plan in CREDIT_PLANS}

# ---------------------------------------------------------------------------
# Where customers send the money.
#
# Static on purpose: these are the business's own published account details, they
# change about never, and keeping them here means the checkout page is complete
# straight out of a deploy. Fill each value in once and it shows up everywhere.
#
# These are LIVE account details — customers send real money to them. Treat any
# edit here as a payment change: the IBAN's mod-97 checksum and the Flouci number
# are the two values that lose money silently when mistyped.
# ---------------------------------------------------------------------------
PAYMENT_ACCOUNT_HOLDER = "Mohamed Amine Ouni"              # full name on the account
PAYMENT_FLOUCI_PHONE = "27 666 467"                        # Flouci number, local format
PAYMENT_BANK_IBAN = "TN59 24 031 122 2342 511101 75"       # as printed on the RIB
PAYMENT_BANK_BIC = "BTEXTNTT"                              # BIC / SWIFT
PAYMENT_BANK_NAME = "BTE"                                  # bank name
PAYMENT_WHATSAPP_NUMBER = "+216 48 190 039"                # country code + number

# Payment rails offered at checkout. `available` false renders the option locked
# ("coming soon") in the UI and is rejected server-side. International card
# payment stays locked until the automatic flow (incl. auto-redemption) is built.
#
# `primary_value` is the one string a customer copies (account number / IBAN);
# `meta` is the supporting line under it. Blank values are hidden by the UI, so a
# half-configured method degrades to just its name rather than showing gaps.
PAYMENT_METHODS = [
    {
        "id": "flouci",
        "group": "tunisia",
        "available": True,
        "label": "Flouci",
        "icon": "smartphone",
        "primary_label": "Number",
        "primary_value": PAYMENT_FLOUCI_PHONE,
        "meta": [m for m in ("Flouci app", PAYMENT_ACCOUNT_HOLDER) if m],
    },
    {
        "id": "bank_transfer",
        "group": "tunisia",
        "available": True,
        "label": "Bank transfer / RIB",
        "icon": "account_balance",
        "primary_label": "IBAN",
        "primary_value": PAYMENT_BANK_IBAN,
        "meta": [
            m
            for m in (
                f"BIC: {PAYMENT_BANK_BIC}" if PAYMENT_BANK_BIC else "",
                PAYMENT_BANK_NAME,
                PAYMENT_ACCOUNT_HOLDER,
            )
            if m
        ],
    },
    {
        "id": "d17",
        "group": "tunisia",
        "available": False,
        "label": "D17",
        "icon": "credit_card",
        "primary_label": "Number",
        "primary_value": "",
        "meta": [],
    },
    {
        "id": "edinar_post",
        "group": "tunisia",
        "available": False,
        "label": "E-dinar Post",
        "icon": "local_post_office",
        "primary_label": "Account",
        "primary_value": "",
        "meta": [],
    },
    {
        "id": "international_card",
        "group": "international",
        "available": False,
        "label": "International cards",
        "icon": "credit_card",
        "primary_label": "",
        "primary_value": "",
        "meta": [],
    },
]

PAYMENT_METHODS_BY_ID = {m["id"]: m for m in PAYMENT_METHODS}
AVAILABLE_PAYMENT_METHOD_IDS = {m["id"] for m in PAYMENT_METHODS if m["available"]}


class Config:
    def __init__(self):
        self.BASE_DIR = Path(__file__).resolve().parent
        self.DATA_DIR = self.BASE_DIR / "data"
        self.PROMPTS_DIR = self.DATA_DIR / "prompts"
        self.live_model_catalog_path = self.DATA_DIR / "model_catalog.live.json"

        # Load dynamic JSON configs
        self.field_options = self._load_json("field_options.json")
        self.model_catalog = self._load_json("model_catalog.json")
        self.model_parameters = self._load_model_parameters("model_parameters.json")
        
        # Load Prompts
        self.prompts = self._load_prompts()

        self.apikeymanager_base_url = os.getenv(
            "APIKEYMANAGER_BASE_URL",
            os.getenv("APIKEYMANAGER_URL", "https://akm-gateway-634345037897.europe-west3.run.app"),
        ).rstrip("/")
        # The API gateway is public by design. Reuse its configured API URL when
        # a separate public URL was not supplied, so generated-image URLs returned
        # by AKM can always be retrieved and secured by this backend.
        self.apikeymanager_public_base_url = os.getenv(
            "APIKEYMANAGER_PUBLIC_BASE_URL", self.apikeymanager_base_url
        ).rstrip("/")
        self.apikeymanager_token = os.getenv("APIKEYMANAGER_TOKEN", "")
        self.apikeymanager_timeout = float(os.getenv("APIKEYMANAGER_TIMEOUT", "120"))
        self.discord_webhook_url = os.getenv("DISCORD_WEBHOOK_URL", "").strip()
        self.public_backend_base_url = os.getenv("PUBLIC_BACKEND_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
        self.catalog_webhook_secret = os.getenv("CATALOG_WEBHOOK_SECRET", "").strip()
        # Dedicated secret for the internal gift-credit expiry sweep endpoint.
        # Falls back to the catalog webhook secret if unset (back-compat), but a
        # separate value is recommended to isolate blast radius.
        self.internal_sweep_secret = os.getenv("INTERNAL_SWEEP_SECRET", "").strip()
        self.firebase_project_id = os.getenv("FIREBASE_PROJECT_ID", "portfolio-645a8").strip()

        self.firestore_project_id = os.getenv("FIRESTORE_PROJECT_ID", self.firebase_project_id).strip()
        self.firestore_database = os.getenv("FIRESTORE_DATABASE", "(default)").strip()
        self.firebase_credentials_path = os.getenv("FIREBASE_CREDENTIALS_PATH", "").strip()
        # Meta Conversions API (server-side CompleteRegistration). Server-to-server
        # event that can't be blocked by ad blockers/ITP/cross-browser hops; it is
        # deduplicated against the browser Pixel via a shared event_id (reg_<uid>).
        # No token configured => CAPI is a safe no-op. test_event_code (optional)
        # routes events to the Events Manager "Test Events" tab without affecting
        # real metrics (used for staging validation).
        self.meta_capi_pixel_id = os.getenv("META_CAPI_PIXEL_ID", "1370764631891853").strip()
        self.meta_capi_access_token = os.getenv("META_CAPI_ACCESS_TOKEN", "").strip()
        self.meta_capi_test_event_code = os.getenv("META_CAPI_TEST_EVENT_CODE", "").strip()
        # Predicted/nominal value for a CompleteRegistration (Meta requires value > 0
        # so it can value-optimize). No real purchase price exists at signup; tune via env.
        try:
            self.meta_capi_registration_value = float(os.getenv("META_CAPI_REGISTRATION_VALUE", "1.0"))
        except ValueError:
            self.meta_capi_registration_value = 1.0
        self.app_env = os.getenv("APP_ENV", "prod").strip().lower() or "prod"

        # Automatic transactional/lifecycle email (separate from Firebase magic-link).
        # Provider is Brevo by default; the client is a thin wrapper so it can be
        # swapped. No API key => the sender runs in DRY-RUN (logs the payload, sends
        # nothing), so the whole system is testable before the sender domain is
        # verified. EMAIL_DRY_RUN=1 forces dry-run even with a key configured.
        self.email_provider = os.getenv("EMAIL_PROVIDER", "brevo").strip().lower() or "brevo"
        self.brevo_api_key = os.getenv("BREVO_API_KEY", "").strip()
        self.email_from = os.getenv("EMAIL_FROM", "no-reply@vibecraft.ouni.space").strip()
        self.email_from_name = os.getenv("EMAIL_FROM_NAME", "Vibecraft").strip() or "Vibecraft"
        self.email_reply_to = os.getenv("EMAIL_REPLY_TO", "").strip()
        self.email_timeout = float(os.getenv("EMAIL_TIMEOUT", "20"))
        _email_dry_run_forced = os.getenv("EMAIL_DRY_RUN", "").strip().lower() in {"1", "true", "yes", "on"}
        self.email_dry_run = _email_dry_run_forced or not self.brevo_api_key
        # ONLY production delivers mail. Staging shares the Brevo account with prod
        # (same send quota, same sender reputation) and its DB holds real user
        # addresses, so a test redeem or an enabled sweep there would email real
        # people. Enforced in code rather than by keeping staging's .env keyless,
        # so it cannot be undone by copying an .env between boxes. Note APP_ENV
        # defaults to "prod" when unset (see app_env above), matching the existing
        # `packs_test_fake_provider` idiom. EMAIL_ALLOW_NONPROD=1 re-enables real
        # delivery for a deliberate, supervised test on a non-prod box.
        self.email_allow_nonprod = os.getenv("EMAIL_ALLOW_NONPROD", "").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        if self.app_env != "prod" and not self.email_allow_nonprod:
            self.email_dry_run = True
        # Public app base used to build links in emails (unsubscribe, deep links).
        # Routes through nginx to the backend for /api/* paths.
        self.app_base_url = (
            os.getenv("APP_BASE_URL", "").strip().rstrip("/")
            or ("https://testvibecraft.ouni.space" if self.app_env != "prod" else "https://vibecraft.ouni.space")
        )
        # HMAC secret for one-click unsubscribe tokens. Falls back to the admin
        # session secret so staging links work before a dedicated one is provisioned.
        self.email_unsubscribe_secret = (
            os.getenv("EMAIL_UNSUBSCRIBE_SECRET", "").strip()
            or os.getenv("ADMIN_SESSION_SECRET", "").strip()
        )

        # Staging-only test hook: when truthy, Pack GENERATIONS route through the
        # $0 fake provider (estimates stay real). Hard-gated on APP_ENV: prod ignores
        # the flag outright, so a stray copy of it in a production .env cannot silently
        # turn paid customer generations into free placeholder images. Ignoring it is
        # deliberate — refusing to boot over a test flag would be a worse prod outcome.
        _fake_requested = os.getenv("PACKS_TEST_FAKE_PROVIDER", "").strip().lower() in {"1", "true", "yes", "on"}
        self.packs_test_fake_provider = _fake_requested and self.app_env != "prod"
        if _fake_requested and not self.packs_test_fake_provider:
            logging.getLogger(__name__).warning(
                "PACKS_TEST_FAKE_PROVIDER is set but APP_ENV=%s: ignoring it, pack generations "
                "will use the real providers.",
                self.app_env,
            )
        elif self.packs_test_fake_provider:
            logging.getLogger(__name__).warning(
                "PACKS_TEST_FAKE_PROVIDER is ACTIVE (APP_ENV=%s): pack generations route to the "
                "$0 fake provider and are NOT billed.",
                self.app_env,
            )
        # Manual credit orders can also be reviewed from a private Discord
        # channel. No bot token => the whole thing is a no-op that only logs, so
        # the flow is testable before the bot exists.
        #
        # SECURITY: there is deliberately no way to MINT a code from Discord —
        # approving requires typing a code that was already generated in the web
        # admin panel. A stolen Discord account can therefore attach existing
        # codes, but cannot create credits. See services/discord_orders.py.
        self.discord_bot_token = os.getenv("DISCORD_BOT_TOKEN", "").strip()
        self.discord_public_key = os.getenv("DISCORD_PUBLIC_KEY", "").strip()
        self.discord_channel_id = os.getenv("DISCORD_CHANNEL_ID", "").strip()
        self.discord_guild_id = os.getenv("DISCORD_GUILD_ID", "").strip()
        # Comma-separated so a second reviewer can be added without a code change.
        self.discord_admin_ids = {
            part.strip()
            for part in os.getenv("DISCORD_ADMIN_ID", "").split(",")
            if part.strip()
        }
        self.discord_timeout = float(os.getenv("DISCORD_TIMEOUT", "15"))
        # Proof-of-payment links in a card are HMAC-signed and expire, so
        # scrolling back through channel history does not hand over a pile of
        # customer receipts. Falls back to the admin session secret so staging
        # works before a dedicated one is provisioned (same idiom as
        # EMAIL_UNSUBSCRIBE_SECRET above).
        self.discord_proof_secret = (
            os.getenv("DISCORD_PROOF_SECRET", "").strip()
            or os.getenv("ADMIN_SESSION_SECRET", "").strip()
        )
        try:
            self.discord_proof_link_ttl = max(300, int(os.getenv("DISCORD_PROOF_LINK_TTL", "86400")))
        except ValueError:
            self.discord_proof_link_ttl = 86400

        self.admin_session_secret = os.getenv("ADMIN_SESSION_SECRET", "").strip()
        self.admin_session_cookie_name = os.getenv("ADMIN_SESSION_COOKIE_NAME", "vibecraft_admin_session").strip() or "vibecraft_admin_session"
        self.admin_csrf_cookie_name = os.getenv("ADMIN_CSRF_COOKIE_NAME", "vibecraft_admin_csrf").strip() or "vibecraft_admin_csrf"
        self.admin_session_ttl_seconds = int(os.getenv("ADMIN_SESSION_TTL_SECONDS", str(15 * 60)))
        self.admin_cookie_secure = os.getenv("ADMIN_COOKIE_SECURE", "true").strip().lower() not in {"0", "false", "no", "off"}
        self.admin_cookie_samesite = os.getenv("ADMIN_COOKIE_SAMESITE", "none").strip().lower() or "none"
        if self.admin_cookie_samesite not in {"lax", "strict", "none"}:
            raise ValueError("ADMIN_COOKIE_SAMESITE must be lax, strict, or none")
        # Leave unset for a Cloud Run API. It cannot issue a cookie for the
        # unrelated prodxvibecraft.ouni.space domain.
        self.admin_cookie_domain = os.getenv("ADMIN_COOKIE_DOMAIN", "").strip().lstrip(".")
        default_origins = (
            "http://localhost:3000,http://localhost:3003,https://vibecraft.ouni.space,"
            "https://testvibecraft.ouni.space,https://prodxvibecraft.ouni.space,"
            "https://adminvibecraft.ouni.space,https://vibecraft.vercel.app"
        )
        required_origins = [origin.strip() for origin in default_origins.split(",") if origin.strip()]
        configured_origins = [
            origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "").split(",") if origin.strip()
        ]
        # Keep production admin origins enabled even if Cloud Run still has an
        # older ALLOWED_ORIGINS value configured.
        self.allowed_origins = list(dict.fromkeys([*required_origins, *configured_origins]))
        self.admin_login_username_limit = int(os.getenv("ADMIN_LOGIN_USERNAME_LIMIT", "5"))
        self.admin_login_ip_limit = int(os.getenv("ADMIN_LOGIN_IP_LIMIT", "10"))
        self.admin_login_username_ip_limit = int(os.getenv("ADMIN_LOGIN_USERNAME_IP_LIMIT", "5"))
        self.admin_login_window_seconds = int(os.getenv("ADMIN_LOGIN_WINDOW_SECONDS", str(15 * 60)))
        self.admin_login_lockout_threshold = int(os.getenv("ADMIN_LOGIN_LOCKOUT_THRESHOLD", "5"))
        self.admin_login_lockout_seconds = int(os.getenv("ADMIN_LOGIN_LOCKOUT_SECONDS", str(15 * 60)))
        self.admin_login_deactivate_threshold = int(os.getenv("ADMIN_LOGIN_DEACTIVATE_THRESHOLD", "30"))
        self.admin_login_deactivate_window_seconds = int(os.getenv("ADMIN_LOGIN_DEACTIVATE_WINDOW_SECONDS", str(60 * 60)))
        self.admin_login_min_latency_seconds = float(os.getenv("ADMIN_LOGIN_MIN_LATENCY_SECONDS", "3"))
        
        raw_db_url = os.getenv("DATABASE_URL", "postgresql+psycopg://neondb_owner:npg_6JgE1mbktdWf@ep-damp-fire-b19ookvd-pooler.c-5.eu-central-1.aws.neon.tech/neondb?sslmode=require").strip()
        if raw_db_url.startswith("postgresql://"):
            raw_db_url = raw_db_url.replace("postgresql://", "postgresql+psycopg://", 1)
        self.database_url = raw_db_url

        self.database_echo = os.getenv("DATABASE_ECHO", "false").strip().lower() in {"1", "true", "yes", "on"}
        self.database_pool_size = int(os.getenv("DATABASE_POOL_SIZE", "5"))
        self.database_max_overflow = int(os.getenv("DATABASE_MAX_OVERFLOW", "10"))
        self.database_pool_pre_ping = os.getenv("DATABASE_POOL_PRE_PING", "true").strip().lower() not in {"0", "false", "no", "off"}
        self.database_connect_timeout = int(os.getenv("DATABASE_CONNECT_TIMEOUT", "10"))
        self.security_db_path = os.getenv(
            "SECURITY_DB_PATH",
            str(self.DATA_DIR / "security.sqlite3"),
        )
        self.smart_analysis_fee = float(os.getenv("SMART_ANALYSIS_FEE", "0.1"))
        self.pending_analyze_session_ttl_seconds = int(os.getenv("PENDING_ANALYZE_SESSION_TTL_SECONDS", str(15 * 60)))
        self.max_pending_analyze_sessions_per_user = int(os.getenv("MAX_PENDING_ANALYZE_SESSIONS_PER_USER", "2"))
        self.quick_generate_user_limit = int(os.getenv("QUICK_GENERATE_USER_LIMIT", "50"))
        self.quick_generate_ip_limit = int(os.getenv("QUICK_GENERATE_IP_LIMIT", "100"))
        self.quick_generate_window_seconds = int(os.getenv("QUICK_GENERATE_WINDOW_SECONDS", str(15 * 60)))
        self.quick_generate_burst_user_limit = int(os.getenv("QUICK_GENERATE_BURST_USER_LIMIT", "10"))
        self.quick_generate_burst_ip_limit = int(os.getenv("QUICK_GENERATE_BURST_IP_LIMIT", "20"))
        self.quick_generate_burst_window_seconds = int(os.getenv("QUICK_GENERATE_BURST_WINDOW_SECONDS", "60"))
        self.plain_chat_user_limit = int(os.getenv("PLAIN_CHAT_USER_LIMIT", "50"))
        self.plain_chat_ip_limit = int(os.getenv("PLAIN_CHAT_IP_LIMIT", "100"))
        self.plain_chat_window_seconds = int(os.getenv("PLAIN_CHAT_WINDOW_SECONDS", str(15 * 60)))
        self.plain_chat_burst_user_limit = int(os.getenv("PLAIN_CHAT_BURST_USER_LIMIT", "10"))
        self.plain_chat_burst_ip_limit = int(os.getenv("PLAIN_CHAT_BURST_IP_LIMIT", "20"))
        self.plain_chat_burst_window_seconds = int(os.getenv("PLAIN_CHAT_BURST_WINDOW_SECONDS", "60"))
        self.plain_chat_context_message_limit = int(os.getenv("PLAIN_CHAT_CONTEXT_MESSAGE_LIMIT", "20"))
        self.plain_chat_context_char_limit = int(os.getenv("PLAIN_CHAT_CONTEXT_CHAR_LIMIT", "24000"))
        self.plain_chat_max_request_bytes = int(os.getenv("PLAIN_CHAT_MAX_REQUEST_BYTES", str(96 * 1024)))
        # Packs: the planning agent is free to the user but makes billed provider
        # calls, so it is metered per user. Session autosave is capped by body size
        # (real sessions are ~3-11 KB) and by how many a user may keep.
        self.packs_plan_user_limit = int(os.getenv("PACKS_PLAN_USER_LIMIT", "30"))
        self.packs_plan_window_seconds = int(os.getenv("PACKS_PLAN_WINDOW_SECONDS", str(60 * 60)))
        self.pack_session_max_request_bytes = int(os.getenv("PACK_SESSION_MAX_REQUEST_BYTES", str(256 * 1024)))
        self.pack_sessions_per_user_limit = int(os.getenv("PACK_SESSIONS_PER_USER_LIMIT", "200"))
        self.plain_chat_max_text_chars_per_part = int(os.getenv("PLAIN_CHAT_MAX_TEXT_CHARS_PER_PART", "4000"))
        self.plain_chat_max_message_chars = int(os.getenv("PLAIN_CHAT_MAX_MESSAGE_CHARS", "12000"))
        self.plain_chat_max_system_chars = int(os.getenv("PLAIN_CHAT_MAX_SYSTEM_CHARS", "4000"))
        self.plain_chat_default_max_tokens = int(os.getenv("PLAIN_CHAT_DEFAULT_MAX_TOKENS", "8192"))
        self.plain_chat_max_output_tokens = int(os.getenv("PLAIN_CHAT_MAX_OUTPUT_TOKENS", "15000"))
        self.plain_chat_max_response_text_chars_per_part = int(os.getenv("PLAIN_CHAT_MAX_RESPONSE_TEXT_CHARS_PER_PART", "15000"))
        self.plain_chat_max_response_chars = int(os.getenv("PLAIN_CHAT_MAX_RESPONSE_CHARS", "15000"))
        self.plain_chat_default_system_prompt = os.getenv(
            "PLAIN_CHAT_DEFAULT_SYSTEM_PROMPT",
            "You are Vibecraft Simple Chat. Reply like a normal helpful assistant in plain language.",
        ).strip()
        self.smart_generate_user_limit = int(os.getenv("SMART_GENERATE_USER_LIMIT", "10"))
        self.smart_generate_ip_limit = int(os.getenv("SMART_GENERATE_IP_LIMIT", "20"))
        self.smart_generate_window_seconds = int(os.getenv("SMART_GENERATE_WINDOW_SECONDS", str(15 * 60)))
        self.upload_user_limit = int(os.getenv("UPLOAD_USER_LIMIT", "12"))
        self.upload_ip_limit = int(os.getenv("UPLOAD_IP_LIMIT", "24"))
        self.upload_window_seconds = int(os.getenv("UPLOAD_WINDOW_SECONDS", str(15 * 60)))
        self.minimum_text_generation_cost = float(os.getenv("MINIMUM_TEXT_GENERATION_COST", "0.005"))
        self.minimum_image_generation_cost = float(os.getenv("MINIMUM_IMAGE_GENERATION_COST", "0.25"))
        self.new_account_usage_cap_first_24h = float(os.getenv("NEW_ACCOUNT_USAGE_CAP_FIRST_24H", "30.0"))
        self.daily_usage_cap = float(os.getenv("DAILY_USAGE_CAP", "30.0"))
        self.max_redeemed_codes_per_day = int(os.getenv("MAX_REDEEMED_CODES_PER_DAY", "4"))
        self.max_redeemed_codes_per_week = int(os.getenv("MAX_REDEEMED_CODES_PER_WEEK", "10"))
        self.redeem_failed_attempt_limit = int(os.getenv("REDEEM_FAILED_ATTEMPT_LIMIT", "5"))
        self.redeem_failed_attempt_window_seconds = int(os.getenv("REDEEM_FAILED_ATTEMPT_WINDOW_SECONDS", str(5 * 60)))
        self.redeem_failed_cooldown_seconds = int(os.getenv("REDEEM_FAILED_COOLDOWN_SECONDS", str(5 * 60)))
        self.redeem_consecutive_suspend_threshold = int(os.getenv("REDEEM_CONSECUTIVE_SUSPEND_THRESHOLD", "10"))
        self.redeem_consecutive_admin_threshold = int(os.getenv("REDEEM_CONSECUTIVE_ADMIN_THRESHOLD", "20"))
        self.redeem_consecutive_window_seconds = int(os.getenv("REDEEM_CONSECUTIVE_WINDOW_SECONDS", str(24 * 60 * 60)))
        self.redeem_temp_suspension_seconds = int(os.getenv("REDEEM_TEMP_SUSPENSION_SECONDS", str(60 * 60)))

        # Content-moderation repeat-offender bans (Section 2 of the moderation layer).
        # THRESHOLD content_blocked rejections within the rolling window → a ban,
        # counted only since the user's last ban (a served ban resets the count to
        # 0). The ban duration escalates per the ladder below; after that many
        # temporary bans the next ban is permanent.
        self.moderation_rejection_threshold = int(os.getenv("MODERATION_REJECTION_THRESHOLD", "3"))
        self.moderation_rejection_window_seconds = int(
            os.getenv("MODERATION_REJECTION_WINDOW_SECONDS", str(10 * 24 * 60 * 60))
        )
        # Ordered ladder of temporary-ban durations in seconds, one per successive
        # ban: 1st ban → 24h, 2nd ban → 7 days. After len(ladder) temporary bans the
        # next ban is permanent. Override with a comma-separated list of seconds.
        _mod_temp_ban_env = os.getenv("MODERATION_TEMP_BAN_DURATIONS_SECONDS")
        if _mod_temp_ban_env:
            self.moderation_temp_ban_durations_seconds = [
                int(x) for x in _mod_temp_ban_env.split(",") if x.strip()
            ]
        else:
            self.moderation_temp_ban_durations_seconds = [24 * 60 * 60, 7 * 24 * 60 * 60]
        self.moderation_max_temp_bans = len(self.moderation_temp_ban_durations_seconds)

        # Zero-tolerance hard ban. Certain categories (child sexual content) are an
        # immediate + PERMANENT ban that bypasses the escalating ladder and the
        # rolling-window count entirely - even on a first offence. Triggered when the
        # AKM moderation cause reports one of these categories strictly above the
        # score floor.
        self.moderation_hard_ban_categories = {
            c.strip()
            for c in os.getenv("MODERATION_HARD_BAN_CATEGORIES", "sexual/minors").split(",")
            if c.strip()
        }
        self.moderation_hard_ban_score = float(os.getenv("MODERATION_HARD_BAN_SCORE", "0.3"))

        # Gift-credit expiry. A reservation will not draw from a gift lot that
        # would expire within this safety window (so a long-running generation
        # can't be caught mid-flight by expiry). Should be >= the maximum
        # generation lifetime (gunicorn --timeout 300).
        self.gift_reserve_safety_window_seconds = int(os.getenv("GIFT_RESERVE_SAFETY_WINDOW_SECONDS", "300"))
        # Default validity (seconds) applied to redeemed gift credits when a code
        # does not specify its own. 0 = redeemed credits never expire by default.
        self.default_gift_validity_seconds = int(os.getenv("DEFAULT_GIFT_VALIDITY_SECONDS", "0"))

        # One-time welcome bonus granted at account creation: free credits that
        # expire after a validity window. Created as a gift lot (so every gift-lot
        # mechanic applies: soonest-expiry-first spend, expiry sweep, breakdown
        # display) and distinguished in the ledger by reason="signup_bonus". Set
        # SIGNUP_BONUS_CREDITS to 0 to disable the bonus entirely.
        self.signup_bonus_credits = float(os.getenv("SIGNUP_BONUS_CREDITS", "1.0"))
        self.signup_bonus_validity_seconds = int(os.getenv("SIGNUP_BONUS_VALIDITY_SECONDS", str(7 * 24 * 60 * 60)))

        # Manual (Tunisian) checkout. Account details are static constants at the
        # top of this module; only the abuse caps are tunable per environment.
        #
        # Two caps, doing different jobs. The open cap bounds the REVIEW QUEUE —
        # how much one account can put in front of a human at once — and clears as
        # soon as those orders are resolved. The weekly cap bounds TOTAL VOLUME
        # over a rolling 7 days regardless of outcome, so an account cannot cycle
        # "submit 3, get refused, submit 3 more" indefinitely.
        self.max_open_credit_orders = int(os.getenv("MAX_OPEN_CREDIT_ORDERS", "3"))
        self.max_credit_orders_per_week = int(os.getenv("MAX_CREDIT_ORDERS_PER_WEEK", "10"))

        # How long a payment proof survives after its order is resolved. Proofs on
        # PENDING orders are never swept, whatever this is set to — a reviewer must
        # always be able to see what they are approving.
        #
        # This is the number that replaces "kept forever". It is a data-retention
        # decision, not a disk one: these files are customer bank receipts. 0
        # disables the sweep and restores the old keep-everything behaviour.
        self.payment_proof_retention_days = int(os.getenv("PAYMENT_PROOF_RETENTION_DAYS", "90"))

        # System model settings used for the intent-analysis step.
        self.system_llm_provider = os.getenv("SYSTEM_LLM_PROVIDER", "google-gemini")
        self.system_llm_models = [
            model.strip()
            for model in os.getenv(
                "SYSTEM_LLM_MODELS",
                "gemini-3-flash-preview,gemini-3.1-flash-lite-preview",
            ).split(",")
            if model.strip()
        ]
        self.system_llm_model = os.getenv(
            "SYSTEM_LLM_MODEL",
            self.system_llm_models[0] if self.system_llm_models else "gemini-3-flash-preview",
        )
        self.fallback_llm_model = os.getenv(
            "FALLBACK_LLM_MODEL",
            self.system_llm_models[1] if len(self.system_llm_models) > 1 else "gemini-3.1-flash-lite-preview",
        )

        # Authentication
        self.api_key = os.getenv("API_KEY")
        # NOTE: self.app_env is set earlier — the packs fake-provider gate depends on it.
        self.authorized_user_emails = {
            email.strip().lower()
            for email in os.getenv("AUTHORIZED_USER_EMAILS", "").split(",")
            if email.strip()
        }

    @property
    def postgres_enabled(self) -> bool:
        return bool(self.database_url)

    def refresh_model_catalog(self) -> dict:
        try:
            from app.services.apikeymanager_client import fetch_model_catalog

            self.model_catalog = fetch_model_catalog()
        except Exception as e:
            print(f"⚠️ Warning: Failed to refresh live model catalog, using cached fallback: {e}")
            if not self.model_catalog:
                self.model_catalog = self._load_json("model_catalog.json")
        return self.model_catalog

    def _load_json(self, filename: str) -> dict:
        filepath = self.DATA_DIR / filename
        if not filepath.exists():
            return {}
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"❌ Error loading {filename}: {e}")
            return {}

    def _load_model_parameters(self, filename: str) -> dict:
        filepath = self.DATA_DIR / filename
        if not filepath.exists():
            return {}
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                raw = json.load(f)
        except Exception as e:
            print(f"❌ Error loading {filename}: {e}")
            return {}

        if not isinstance(raw, list):
            print(f"⚠️ Warning: {filename} must contain a list of model parameter entries")
            return {}

        normalized: dict[str, dict] = {}
        for entry in raw:
            if not isinstance(entry, dict):
                continue
            model_id = str(entry.get("model_id") or "").strip()
            if not model_id:
                continue
            normalized[model_id] = self._normalize_model_parameter_entry(entry)
        return normalized

    def _normalize_model_parameter_entry(self, entry: dict) -> dict:
        normalized: dict[str, object] = {}
        for key, value in entry.items():
            if key == "model_id":
                normalized["modelId"] = str(value).strip()
                continue
            normalized[self._to_camel_case(str(key))] = self._normalize_model_parameter_value(value)
        return normalized

    def _normalize_model_parameter_value(self, value):
        if isinstance(value, dict):
            return {
                self._to_camel_case(str(key)): self._normalize_model_parameter_value(item)
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [self._normalize_model_parameter_value(item) for item in value]
        return value

    def _to_camel_case(self, value: str) -> str:
        if "_" not in value:
            return value
        parts = [part for part in value.split("_") if part]
        if not parts:
            return value
        head, *tail = parts
        return head + "".join(part[:1].upper() + part[1:] for part in tail)

    def get_model_parameter_schema(self, model_name: str, model_entry: dict | None = None) -> dict:
        candidates = [str(model_name or "").strip()]
        if isinstance(model_entry, dict):
            candidates.append(str(model_entry.get("model_id") or "").strip())
        for candidate in candidates:
            if candidate and candidate in self.model_parameters:
                return self._apply_parameter_schema_overrides(candidate, self.model_parameters[candidate])
        return {}

    def _apply_parameter_schema_overrides(self, model_name: str, schema: dict) -> dict:
        normalized_name = str(model_name or "").strip().lower()
        normalized_schema = deepcopy(schema) if isinstance(schema, dict) else {}
        image_config = normalized_schema.get("imageConfig")

        if "aspectRatio" not in normalized_schema and isinstance(image_config, dict):
            aspect_ratio_values = image_config.get("aspectRatio")
            if not isinstance(aspect_ratio_values, list):
                aspect_ratio_values = image_config.get("supportedAspectRatios")

            if isinstance(aspect_ratio_values, list) and aspect_ratio_values:
                aspect_ratio_entry = {
                    "type": "enum",
                    "values": [str(value) for value in aspect_ratio_values if str(value).strip()],
                }

                max_input_images = image_config.get("maxInputImages")
                max_output_images = image_config.get("maxOutputImages")
                max_input_images_per_prompt = image_config.get("maxInputImagesPerPrompt")
                max_output_images_per_prompt = image_config.get("maxOutputImagesPerPrompt")

                note_parts = []
                if max_input_images is not None:
                    note_parts.append(f"Max input images: {max_input_images}")
                if max_input_images_per_prompt is not None:
                    note_parts.append(f"Max input images per prompt: {max_input_images_per_prompt}")
                if max_output_images is not None:
                    note_parts.append(f"Max output images: {max_output_images}")
                if max_output_images_per_prompt is not None:
                    note_parts.append(f"Max output images per prompt: {max_output_images_per_prompt}")

                if note_parts:
                    aspect_ratio_entry["note"] = " | ".join(note_parts)

                normalized_schema["aspectRatio"] = aspect_ratio_entry

        for key, entry in list(normalized_schema.items()):
            if not isinstance(entry, dict):
                continue
            if key in CREATE_FLOW_IMAGE_PARAM_KEYS:
                entry["createFlowCategory"] = "image"
            elif key in CREATE_FLOW_TEXT_PARAM_KEYS:
                entry["createFlowCategory"] = "text"

        max_output_tokens = normalized_schema.get("maxOutputTokens")
        if isinstance(max_output_tokens, dict):
            # Keep the UI and backend contract aligned on one supported chat range.
            max_output_tokens["min"] = 10
            max_output_tokens["max"] = 15000
            max_output_tokens["recommendedDefault"] = 8192
            max_output_tokens.pop("minExclusive", None)
            max_output_tokens.pop("maxExclusive", None)

        temperature = normalized_schema.get("temperature")
        if isinstance(temperature, dict) and "recommendedDefault" not in temperature and "default" in temperature:
            temperature["recommendedDefault"] = temperature["default"]

        top_p = normalized_schema.get("topP")
        if isinstance(top_p, dict) and "recommendedDefault" not in top_p and "default" in top_p:
            top_p["recommendedDefault"] = top_p["default"]

        normalized_schema.pop("presencePenalty", None)
        normalized_schema.pop("frequencyPenalty", None)

        thinking_level = normalized_schema.get("thinkingLevel")
        if isinstance(thinking_level, dict):
            thinking_level["recommendedDefault"] = "low"

        normalized_schema.pop("candidateCount", None)

        # Imagen through the Google AI Gemini API rejects these Vertex-only controls.
        if "imagen" in normalized_name:
            normalized_schema.pop("sampleCount", None)
            normalized_schema.pop("addWatermark", None)
            normalized_schema.pop("enhancePrompt", None)
            normalized_schema.pop("seed", None)

        return normalized_schema

    def _load_prompts(self) -> dict:
        """Reads all .txt files in data/prompts and returns a dict."""
        prompts = {}
        if not self.PROMPTS_DIR.exists():
            print(f"⚠️ Warning: Prompts dir not found at {self.PROMPTS_DIR}")
            return prompts

        for file in self.PROMPTS_DIR.glob("*.txt"):
            try:
                # Key becomes 'analyze_intent' for 'analyze_intent.txt'
                key = file.stem
                with open(file, "r", encoding="utf-8") as f:
                    prompts[key] = f.read().strip()
            except Exception as e:
                print(f"❌ Error loading prompt {file.name}: {e}")

        return prompts

settings = Config()
