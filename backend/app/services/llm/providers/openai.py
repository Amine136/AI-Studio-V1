import os
from typing import Any, Optional
from app.services.llm.base import LLMProvider
from app.services.llm.providers.mock import MockProvider

class OpenAIProvider(LLMProvider):
    """OpenAI Provider."""

    def generate(self, model_id: str, prompt: str, schema: Optional[Any] = None) -> str:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            return MockProvider().generate(model_id, prompt, schema)

        try:
            from openai import OpenAI
            client = OpenAI(api_key=api_key)
            
            # Note: OpenAI structured output uses a different syntax (json_schema), 
            # but for now we'll keep the basic string response to match existing logic.
            # Future enhancement: Map 'schema' to OpenAI's response_format.
            
            response = client.chat.completions.create(
                model=model_id,
                messages=[{"role": "user", "content": prompt}],
            )
            return response.choices[0].message.content
            
        except Exception as e:
            print(f"❌ OpenAI API Error: {e}")
            return MockProvider().generate(model_id, prompt, schema)
