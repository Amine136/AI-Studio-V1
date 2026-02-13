import os
import json
from typing import Any, Optional
from app.services.llm.base import LLMProvider
from app.services.llm.providers.mock import MockProvider

class OpenRouterProvider(LLMProvider):
    """OpenRouter Provider (OpenAI-compatible)."""

    def generate(self, model_id: str, prompt: str, schema: Optional[Any] = None) -> str:
        api_key = os.getenv("OPENROUTER_API_KEY")
        if not api_key:
            print("⚠️ Warning: No OPENROUTER_API_KEY found. Using Mock.")
            return MockProvider().generate(model_id, prompt, schema)

        try:
            from openai import OpenAI
            
            # OpenRouter uses the OpenAI client with a different Base URL
            client = OpenAI(
                base_url="https://openrouter.ai/api/v1",
                api_key=api_key,
            )
            
            messages = [{"role": "user", "content": prompt}]
            
            # Helper to append JSON instruction if schema is present
            # Many OpenRouter models need explicit instruction even with json_object mode
            if schema:
                sys_msg = "You are a helpful assistant that outputs strict JSON."
                # If it's a Pydantic model, we can try to get the schema
                if hasattr(schema, "model_json_schema"):
                    schema_json = json.dumps(schema.model_json_schema(), indent=2)
                    sys_msg += f"\nHere is the required JSON schema:\n{schema_json}"
                
                messages.insert(0, {"role": "system", "content": sys_msg})
                
                # Use JSON mode if supported (most modern models on OR do)
                response = client.chat.completions.create(
                    model=model_id,
                    messages=messages,
                    response_format={"type": "json_object"},
                    extra_headers={
                        "HTTP-Referer": "https://ai-studio.local", # Optional: for OpenRouter rankings
                        "X-Title": "AI Studio V1",
                    },
                )
            else:
                response = client.chat.completions.create(
                    model=model_id,
                    messages=messages,
                    extra_headers={
                        "HTTP-Referer": "https://ai-studio.local",
                        "X-Title": "AI Studio V1",
                    },
                )
                
            return response.choices[0].message.content
            
        except Exception as e:
            print(f"❌ OpenRouter API Error: {e}")
            return MockProvider().generate(model_id, prompt, schema)
