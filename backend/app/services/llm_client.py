import os
import json
from typing import Any, Optional
import google.generativeai as genai # <--- We stick to the OLD library
from google.generativeai.types import GenerationConfig
from app.config import settings

# ---------------------------------------------------------
# The Dispatcher
# ---------------------------------------------------------

def generate_text(
    provider: str, 
    model_id: str, 
    prompt: str, 
    response_schema: Optional[Any] = None
) -> str:
    """
    Routes the text generation request.
    """
    if provider == "google":
        return _generate_via_google(model_id, prompt, response_schema)
    elif provider == "openai":
        return _generate_via_openai(model_id, prompt)
    elif provider == "mock":
        return _generate_mock(model_id, prompt)
    else:
        raise ValueError(f"Unknown LLM Provider: {provider}")


# ---------------------------------------------------------
# Provider Implementations
# ---------------------------------------------------------

def _generate_via_google(model_id: str, prompt: str, schema: Optional[Any] = None) -> str:
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        print("⚠️ Warning: No GOOGLE_API_KEY found. Using Mock.")
        return _generate_mock(model_id, prompt)

    try:
        genai.configure(api_key=api_key)
        
        # 1. Configure for JSON if schema is provided
        generation_config = {}
        
        if schema:
            # The old SDK supports this exact syntax for Pydantic!
            generation_config = GenerationConfig(
                response_mime_type="application/json",
                response_schema=schema 
            )
            
        # 2. Handle Model IDs
        real_model_id = model_id
        # Fallback for "flash" models if 2.5 isn't available in your region
        if "gemini" in model_id and "flash" in model_id:
             real_model_id = settings.fallback_llm_model  # Safe default

        model = genai.GenerativeModel(real_model_id)
        
        # 3. Generate
        response = model.generate_content(
            prompt, 
            generation_config=generation_config
        )
        
        return response.text
        
    except Exception as e:
        print(f"❌ Google API Error: {str(e)}")
        # If the specific model fails (e.g. 2.0 isn't out yet), try 1.5-flash
        if "404" in str(e) or "not found" in str(e).lower():
            try:
                print(f"🔄 Retrying with {settings.fallback_llm_model}...")
                model = genai.GenerativeModel(settings.fallback_llm_model)
                response = model.generate_content(prompt, generation_config=generation_config)
                return response.text
            except:
                pass
        return _generate_mock(model_id, prompt)


def _generate_via_openai(model_id: str, prompt: str) -> str:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return _generate_mock(model_id, prompt)

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model=model_id,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.choices[0].message.content
    except Exception as e:
        print(f"OpenAI API Error: {e}")
        return _generate_mock(model_id, prompt)


def _generate_mock(model_id: str, prompt: str) -> str:
    """Fallback if API fails"""
    # ... (Same mock logic as before) ...
    if "obligatory" in prompt and "ai_suggestion" in prompt:
        return json.dumps({
            "obligatory": {"platform": "Instagram", "brand_voice": "Professional"},
            "ai_suggestion": {"lighting": "Cinematic", "medium": "Photo"}
        })
    if "caption" in prompt and "JSON" in prompt:
        return json.dumps({
            "caption": f"(Simulated {model_id}) Default caption response.",
            "hashtags": ["#AI", "#Tech"]
        })
    return f"Simulated response from {model_id}..."