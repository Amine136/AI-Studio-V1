import json
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

class Config:
    def __init__(self):
        self.BASE_DIR = Path(__file__).resolve().parent 
        self.DATA_DIR = self.BASE_DIR / "data"
        self.PROMPTS_DIR = self.DATA_DIR / "prompts"  # <--- NEW

        # Load dynamic JSON configs
        self.field_options = self._load_json("field_options.json")
        self.model_catalog = self._load_json("model_catalog.json")
        
        # Load Prompts
        self.prompts = self._load_prompts() # <--- NEW

        self.GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
        self.OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
        self.OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

        # System Model Settings (centralizes hardcoded values)
        # Provider can be: google, openai, openrouter, or mock
        self.system_llm_provider = os.getenv("SYSTEM_LLM_PROVIDER", "google")
        self.system_llm_model = os.getenv("SYSTEM_LLM_MODEL", "gemini-2.5-flash")
        self.fallback_llm_model = os.getenv("FALLBACK_LLM_MODEL", "gemini-2.5-flash-lite")
        self.default_mock_model = "mock-default"

        # Authentication
        self.api_key = os.getenv("API_KEY")

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