import os
import google.generativeai as genai
from typing import Any, Optional
from app.services.llm.base import LLMProvider
from app.services.llm.providers.mock import MockProvider
from app.config import settings

class GoogleProvider(LLMProvider):
    """Google Gemini Provider using google-generativeai SDK."""
    
    def __init__(self):
        api_key = os.getenv("GOOGLE_API_KEY")
        if api_key:
            genai.configure(api_key=api_key)
        else:
            self._available = False
            
    def generate(self, model_id: str, prompt: str, schema: Optional[Any] = None) -> str:
        if not os.getenv("GOOGLE_API_KEY"):
            print("⚠️ Warning: No GOOGLE_API_KEY found. Using Mock.")
            return MockProvider().generate(model_id, prompt, schema)

        try:
            # 1. Configure for JSON if schema is provided
            generation_config = {}
            if schema:
                # The old SDK supports this exact syntax for Pydantic!
                generation_config = genai.types.GenerationConfig(
                    response_mime_type="application/json",
                    response_schema=schema 
                )
            
            # 2. Handle Model IDs & Regional Fallback
            real_model_id = model_id
            if "gemini" in model_id and "flash" in model_id:
                 real_model_id = settings.fallback_llm_model  # Safe default is usually -lite or 1.5-flash

            model = genai.GenerativeModel(real_model_id)
            
            # 3. Generate
            response = model.generate_content(
                prompt,
                generation_config=generation_config
            )
            return response.text
            
        except Exception as e:
            print(f"❌ Google API Error: {str(e)}")
            
            # Retroactive Fallback Logic
            if "404" in str(e) or "not found" in str(e).lower():
                try:
                    print(f"🔄 Retrying with {settings.fallback_llm_model}...")
                    model = genai.GenerativeModel(settings.fallback_llm_model)
                    response = model.generate_content(prompt, generation_config=generation_config)
                    return response.text
                except:
                    pass
            
            # Ultimate fail-safe
            return MockProvider().generate(model_id, prompt, schema)
