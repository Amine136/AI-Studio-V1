import json
from typing import Any, Optional
from app.services.llm.base import LLMProvider

class MockProvider(LLMProvider):
    """Fallback provider for testing or missing API keys."""
    
    def generate(self, model_id: str, prompt: str, schema: Optional[Any] = None) -> str:
        # Simulate structured response for Intent Analysis
        if "obligatory" in prompt and "ai_suggestion" in prompt:
            return json.dumps({
                "obligatory": {"platform": "Instagram", "brand_voice": "Professional"},
                "ai_suggestion": {"lighting": "Cinematic", "medium": "Photo"}
            })
            
        # Simulate structured response for Caption Generation
        if "caption" in prompt and "JSON" in prompt:
            return json.dumps({
                "caption": f"(Simulated {model_id}) Default caption response.",
                "hashtags": ["#AI", "#Tech"]
            })
            
        return f"Simulated response from {model_id}..."
