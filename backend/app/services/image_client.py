from app.services.apikeymanager_client import generate_image_via_proxy, generate_text_and_image_via_proxy


def generate_image_url(
    provider: str,
    model_id: str,
    prompt: str,
    model_type: str = "",
    image_config: dict = None,
    input_image: dict | None = None,
) -> str:
    """Sends image generation through ApiKeyManager."""
    return generate_image_via_proxy(provider, model_id, prompt, image_config=image_config, input_image=input_image)


def generate_image_and_text(
    provider: str,
    model_id: str,
    prompt: str,
    image_config: dict = None,
    input_image: dict | None = None,
) -> dict[str, str]:
    """Sends a single multimodal generation request through ApiKeyManager."""
    return generate_text_and_image_via_proxy(
        provider,
        model_id,
        prompt,
        image_config=image_config,
        input_image=input_image,
    )
