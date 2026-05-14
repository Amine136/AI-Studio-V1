from app.services.apikeymanager_client import (
    generate_image_payload_via_proxy,
    generate_image_via_proxy,
    generate_text_and_image_payload_via_proxy,
    generate_text_and_image_via_proxy,
)


def generate_image_url(
    provider: str,
    model_id: str,
    prompt: str,
    *,
    owner_uid: str,
    model_type: str = "",
    image_config: dict = None,
    input_images: list[dict] | None = None,
    options: dict | None = None,
) -> str:
    """Sends image generation through ApiKeyManager."""
    return generate_image_via_proxy(
        provider,
        model_id,
        prompt,
        owner_uid=owner_uid,
        image_config=image_config,
        input_images=input_images,
        options=options,
    )


def generate_image_and_text(
    provider: str,
    model_id: str,
    prompt: str,
    *,
    owner_uid: str,
    image_config: dict = None,
    input_images: list[dict] | None = None,
    options: dict | None = None,
) -> dict[str, str]:
    """Sends a single multimodal generation request through ApiKeyManager."""
    return generate_text_and_image_via_proxy(
        provider,
        model_id,
        prompt,
        owner_uid=owner_uid,
        image_config=image_config,
        input_images=input_images,
        options=options,
    )


def generate_image_payload(
    provider: str,
    model_id: str,
    prompt: str,
    *,
    owner_uid: str,
    model_type: str = "",
    image_config: dict = None,
    input_images: list[dict] | None = None,
    options: dict | None = None,
) -> dict:
    del model_type
    return generate_image_payload_via_proxy(
        provider,
        model_id,
        prompt,
        owner_uid=owner_uid,
        image_config=image_config,
        input_images=input_images,
        options=options,
    )


def generate_image_and_text_payload(
    provider: str,
    model_id: str,
    prompt: str,
    *,
    owner_uid: str,
    image_config: dict = None,
    input_images: list[dict] | None = None,
    options: dict | None = None,
) -> dict:
    return generate_text_and_image_payload_via_proxy(
        provider,
        model_id,
        prompt,
        owner_uid=owner_uid,
        image_config=image_config,
        input_images=input_images,
        options=options,
    )
