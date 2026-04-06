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

        # Load dynamic JSON configs
        self.field_options = self._load_json("field_options.json")
        self.model_catalog = self._load_json("model_catalog.json")
        
        # Load Prompts
        self.prompts = self._load_prompts()

        self.apikeymanager_base_url = os.getenv("APIKEYMANAGER_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
        self.apikeymanager_token = os.getenv("APIKEYMANAGER_TOKEN", "")
        self.apikeymanager_timeout = float(os.getenv("APIKEYMANAGER_TIMEOUT", "120"))
        self.public_backend_base_url = os.getenv("PUBLIC_BACKEND_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
        self.firebase_project_id = os.getenv("FIREBASE_PROJECT_ID", "novanodetn").strip()
        self.admin_emails = {
            email.strip().lower()
            for email in os.getenv("ADMIN_EMAILS", "").split(",")
            if email.strip()
        }
        self.security_db_path = os.getenv(
            "SECURITY_DB_PATH",
            str(self.DATA_DIR / "security.sqlite3"),
        )
        self.analyze_abandon_fee = float(os.getenv("ANALYZE_ABANDON_FEE", "0.2"))

        # System model settings used for the intent-analysis step.
        self.system_llm_provider = os.getenv("SYSTEM_LLM_PROVIDER", "google-gemini")
        self.system_llm_model = os.getenv("SYSTEM_LLM_MODEL", "gemini-3.1-flash-lite-preview")
        self.fallback_llm_model = os.getenv("FALLBACK_LLM_MODEL", "gemini-3-flash-preview")

        # Authentication
        self.api_key = os.getenv("API_KEY")

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
