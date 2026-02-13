from typing import Any, Optional
from app.services.llm.factory import LLMFactory

# ---------------------------------------------------------
# The Facade (Main Entry Point)
# ---------------------------------------------------------

def generate_text(
    provider: str, 
    model_id: str, 
    prompt: str, 
    response_schema: Optional[Any] = None
) -> str:
    """
    Routes the text generation request to the appropriate registered provider.
    
    This facade maintains backward compatibility with the rest of the application.
    """
    provider_client = LLMFactory.get_provider(provider)
    answer = provider_client.generate(model_id, prompt, response_schema)
    print(f"llm answer: {answer}")
    return answer