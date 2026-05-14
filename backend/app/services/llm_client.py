from typing import Any, Optional

from app.services.apikeymanager_client import generate_text_payload_via_proxy, generate_text_via_proxy

def generate_text(
    provider: str, 
    model_id: str, 
    prompt: str, 
    response_schema: Optional[Any] = None,
    input_images: Optional[list[dict[str, str]]] = None,
    options: Optional[dict[str, Any]] = None,
) -> str:
    """
    Sends text generation through ApiKeyManager.

    This thin wrapper keeps the rest of the workflow code stable while the
    actual provider routing is delegated to ApiKeyManager.
    """
    answer = generate_text_via_proxy(
        provider,
        model_id,
        prompt,
        response_schema,
        input_images=input_images,
        options=options,
    )
    print(f"llm answer: {answer}")
    return answer


def generate_text_payload(
    provider: str,
    model_id: str,
    prompt: str,
    response_schema: Optional[Any] = None,
    input_images: Optional[list[dict[str, str]]] = None,
    options: Optional[dict[str, Any]] = None,
) -> dict:
    return generate_text_payload_via_proxy(
        provider,
        model_id,
        prompt,
        response_schema,
        input_images=input_images,
        options=options,
    )
