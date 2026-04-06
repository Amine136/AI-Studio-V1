from typing import Any, Optional

from app.services.apikeymanager_client import generate_text_via_proxy

def generate_text(
    provider: str, 
    model_id: str, 
    prompt: str, 
    response_schema: Optional[Any] = None,
    input_image: Optional[dict[str, str]] = None,
) -> str:
    """
    Sends text generation through ApiKeyManager.

    This thin wrapper keeps the rest of the workflow code stable while the
    actual provider routing is delegated to ApiKeyManager.
    """
    answer = generate_text_via_proxy(provider, model_id, prompt, response_schema, input_image=input_image)
    print(f"llm answer: {answer}")
    return answer
