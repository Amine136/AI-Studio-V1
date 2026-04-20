import json
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


class Config:
    def __init__(self):
        self.BASE_DIR = Path(__file__).resolve().parent
        self.DATA_DIR = self.BASE_DIR / "data"
        self.PROMPTS_DIR = self.DATA_DIR / "prompts"
        self.live_model_catalog_path = self.DATA_DIR / "model_catalog.live.json"

        # Load dynamic JSON configs
        self.field_options = self._load_json("field_options.json")
        self.model_catalog = self._load_json("model_catalog.json")
        
        # Load Prompts
        self.prompts = self._load_prompts()

        self.apikeymanager_base_url = os.getenv("APIKEYMANAGER_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
        self.apikeymanager_token = os.getenv("APIKEYMANAGER_TOKEN", "")
        self.apikeymanager_timeout = float(os.getenv("APIKEYMANAGER_TIMEOUT", "120"))
        self.public_backend_base_url = os.getenv("PUBLIC_BACKEND_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
        self.catalog_webhook_secret = os.getenv("CATALOG_WEBHOOK_SECRET", "").strip()
        self.firebase_project_id = os.getenv("FIREBASE_PROJECT_ID", "novanodetn").strip()
        self.firestore_project_id = os.getenv("FIRESTORE_PROJECT_ID", self.firebase_project_id).strip()
        self.firestore_database = os.getenv("FIRESTORE_DATABASE", "(default)").strip()
        self.firebase_credentials_path = os.getenv("FIREBASE_CREDENTIALS_PATH", "").strip()
        self.admin_session_secret = os.getenv("ADMIN_SESSION_SECRET", "").strip()
        self.admin_session_cookie_name = os.getenv("ADMIN_SESSION_COOKIE_NAME", "vibecraft_admin_session").strip() or "vibecraft_admin_session"
        self.admin_csrf_cookie_name = os.getenv("ADMIN_CSRF_COOKIE_NAME", "vibecraft_admin_csrf").strip() or "vibecraft_admin_csrf"
        self.admin_session_ttl_seconds = int(os.getenv("ADMIN_SESSION_TTL_SECONDS", str(12 * 60 * 60)))
        self.admin_cookie_secure = os.getenv("ADMIN_COOKIE_SECURE", "true").strip().lower() not in {"0", "false", "no", "off"}
        self.admin_login_username_limit = int(os.getenv("ADMIN_LOGIN_USERNAME_LIMIT", "5"))
        self.admin_login_ip_limit = int(os.getenv("ADMIN_LOGIN_IP_LIMIT", "10"))
        self.admin_login_username_ip_limit = int(os.getenv("ADMIN_LOGIN_USERNAME_IP_LIMIT", "5"))
        self.admin_login_window_seconds = int(os.getenv("ADMIN_LOGIN_WINDOW_SECONDS", str(15 * 60)))
        self.admin_login_lockout_threshold = int(os.getenv("ADMIN_LOGIN_LOCKOUT_THRESHOLD", "5"))
        self.admin_login_lockout_seconds = int(os.getenv("ADMIN_LOGIN_LOCKOUT_SECONDS", str(15 * 60)))
        self.admin_login_deactivate_threshold = int(os.getenv("ADMIN_LOGIN_DEACTIVATE_THRESHOLD", "30"))
        self.admin_login_deactivate_window_seconds = int(os.getenv("ADMIN_LOGIN_DEACTIVATE_WINDOW_SECONDS", str(60 * 60)))
        self.admin_login_min_latency_seconds = float(os.getenv("ADMIN_LOGIN_MIN_LATENCY_SECONDS", "3"))
        self.database_url = os.getenv("DATABASE_URL", "").strip()
        self.database_echo = os.getenv("DATABASE_ECHO", "false").strip().lower() in {"1", "true", "yes", "on"}
        self.database_pool_size = int(os.getenv("DATABASE_POOL_SIZE", "5"))
        self.database_max_overflow = int(os.getenv("DATABASE_MAX_OVERFLOW", "10"))
        self.database_pool_pre_ping = os.getenv("DATABASE_POOL_PRE_PING", "true").strip().lower() not in {"0", "false", "no", "off"}
        self.database_connect_timeout = int(os.getenv("DATABASE_CONNECT_TIMEOUT", "10"))
        self.security_db_path = os.getenv(
            "SECURITY_DB_PATH",
            str(self.DATA_DIR / "security.sqlite3"),
        )
        self.smart_analysis_fee = float(os.getenv("SMART_ANALYSIS_FEE", "0.05"))
        self.analyze_abandon_fee = float(os.getenv("ANALYZE_ABANDON_FEE", "0.2"))
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
        self.plain_chat_max_request_bytes = int(os.getenv("PLAIN_CHAT_MAX_REQUEST_BYTES", str(64 * 1024)))
        self.plain_chat_max_text_chars_per_part = int(os.getenv("PLAIN_CHAT_MAX_TEXT_CHARS_PER_PART", "4000"))
        self.plain_chat_max_message_chars = int(os.getenv("PLAIN_CHAT_MAX_MESSAGE_CHARS", "12000"))
        self.plain_chat_max_system_chars = int(os.getenv("PLAIN_CHAT_MAX_SYSTEM_CHARS", "4000"))
        self.plain_chat_default_max_tokens = int(os.getenv("PLAIN_CHAT_DEFAULT_MAX_TOKENS", "512"))
        self.plain_chat_max_output_tokens = int(os.getenv("PLAIN_CHAT_MAX_OUTPUT_TOKENS", "1024"))
        self.plain_chat_max_response_text_chars_per_part = int(os.getenv("PLAIN_CHAT_MAX_RESPONSE_TEXT_CHARS_PER_PART", "8000"))
        self.plain_chat_max_response_chars = int(os.getenv("PLAIN_CHAT_MAX_RESPONSE_CHARS", "16000"))
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
        self.minimum_text_generation_cost = float(os.getenv("MINIMUM_TEXT_GENERATION_COST", "0.01"))
        self.minimum_image_generation_cost = float(os.getenv("MINIMUM_IMAGE_GENERATION_COST", "0.10"))
        self.new_account_usage_cap_first_24h = float(os.getenv("NEW_ACCOUNT_USAGE_CAP_FIRST_24H", "1.0"))
        self.daily_usage_cap = float(os.getenv("DAILY_USAGE_CAP", "5.0"))
        self.max_redeemed_codes_per_day = int(os.getenv("MAX_REDEEMED_CODES_PER_DAY", "4"))
        self.max_redeemed_codes_per_week = int(os.getenv("MAX_REDEEMED_CODES_PER_WEEK", "10"))
        self.redeem_failed_attempt_limit = int(os.getenv("REDEEM_FAILED_ATTEMPT_LIMIT", "5"))
        self.redeem_failed_attempt_window_seconds = int(os.getenv("REDEEM_FAILED_ATTEMPT_WINDOW_SECONDS", str(5 * 60)))
        self.redeem_failed_cooldown_seconds = int(os.getenv("REDEEM_FAILED_COOLDOWN_SECONDS", str(5 * 60)))
        self.redeem_consecutive_suspend_threshold = int(os.getenv("REDEEM_CONSECUTIVE_SUSPEND_THRESHOLD", "10"))
        self.redeem_consecutive_admin_threshold = int(os.getenv("REDEEM_CONSECUTIVE_ADMIN_THRESHOLD", "20"))
        self.redeem_consecutive_window_seconds = int(os.getenv("REDEEM_CONSECUTIVE_WINDOW_SECONDS", str(24 * 60 * 60)))
        self.redeem_temp_suspension_seconds = int(os.getenv("REDEEM_TEMP_SUSPENSION_SECONDS", str(60 * 60)))

        # System model settings used for the intent-analysis step.
        self.system_llm_provider = os.getenv("SYSTEM_LLM_PROVIDER", "google-gemini")
        self.system_llm_model = os.getenv("SYSTEM_LLM_MODEL", "gemini-3.1-flash-lite-preview")
        self.fallback_llm_model = os.getenv("FALLBACK_LLM_MODEL", "gemini-3-flash-preview")

        # Authentication
        self.api_key = os.getenv("API_KEY")

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
