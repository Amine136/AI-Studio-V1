import base64
import re
from pathlib import Path
from typing import Any, Dict
from urllib.parse import urlparse

from app.config import settings
from app.core.schema import ChatMessage, ChatMessagePart, PlainChatOptions, PlainChatRequest
from app.services.apikeymanager_client import generate_chat_via_proxy, generate_image_payload_via_proxy
from app.services.model_visibility import is_model_enabled
from app.services.user_files import load_private_user_file, private_file_id_from_url, private_file_url_prefix

MAX_CHAT_INPUT_IMAGES = 4
# Grok's image edit endpoint accepts at most 3 source images.
MAX_GROK_EDIT_INPUT_IMAGES = 3

SAFE_GENERATED_FILENAME = re.compile(r"^[0-9a-f-]{36}\.(png|jpg|webp)$")
MODEL_PARAMETER_OPTION_KEY_MAP = {
    "temperature": "temperature",
    "topP": "topP",
    "maxTokens": "maxOutputTokens",
    "thinkingLevel": "thinkingLevel",
    "thinkingBudget": "thinkingBudget",
    "presencePenalty": "presencePenalty",
    "frequencyPenalty": "frequencyPenalty",
    "mediaResolution": "mediaResolution",
    "imageSize": "imageSize",
    "resolution": "resolution",
    "quality": "quality",
    "sampleImageSize": "sampleImageSize",
    "aspectRatio": "aspectRatio",
    "seed": "seed",
    "addWatermark": "addWatermark",
    "enhancePrompt": "enhancePrompt",
    "outputMimeType": "outputMimeType",
    "styleType": "style_type",
    "stylePreset": "style_preset",
    "strength": "strength",
    "colors": "colors",
    "backgroundColor": "backgroundColor",
}


def _hex_to_rgb(value: Any) -> list[int] | None:
    """Accept a #rrggbb / #rgb string (or an [r,g,b] list) and return [r, g, b]."""
    if isinstance(value, (list, tuple)) and len(value) == 3:
        try:
            rgb = [int(channel) for channel in value]
        except (TypeError, ValueError):
            return None
        return rgb if all(0 <= channel <= 255 for channel in rgb) else None
    if not isinstance(value, str):
        return None
    text = value.strip().lstrip("#")
    if len(text) == 3:
        text = "".join(char * 2 for char in text)
    if len(text) != 6:
        return None
    try:
        return [int(text[i:i + 2], 16) for i in (0, 2, 4)]
    except ValueError:
        return None


def _normalize_modalities(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip().upper() for item in value if str(item).strip()]


def list_plain_chat_models() -> list[dict[str, Any]]:
    models: dict[str, dict[str, Any]] = {}

    for task_models in (settings.model_catalog or {}).values():
        if not isinstance(task_models, dict):
            continue
        for model_name, model_entry in task_models.items():
            if not isinstance(model_entry, dict) or not is_model_enabled(model_name, model_entry):
                continue
            models[model_name] = {
                "id": model_name,
                "displayName": str(model_entry.get("display_name") or model_name),
                "description": str(model_entry.get("description") or ""),
                "provider": str(model_entry.get("provider") or ""),
                "supportsImageInput": _supports_image_input(model_entry),
                "inputModalities": _normalize_modalities(model_entry.get("input_modalities")),
                "outputModalities": _normalize_modalities(model_entry.get("output_modalities")),
                "parameterSchema": settings.get_model_parameter_schema(model_name, model_entry),
                "pricing": _derive_plain_chat_model_pricing_summary(model_entry),
            }

    return sorted(
        models.values(),
        key=lambda item: (str(item.get("provider") or ""), str(item.get("displayName") or "")),
    )


def minimum_required_credits_for_plain_chat(model_name: str) -> float:
    _, model_entry = resolve_plain_chat_model(model_name)
    pricing = _derive_plain_chat_model_pricing_summary(model_entry)
    return round(float(pricing.get("minimum") or settings.minimum_text_generation_cost), 4)


def expected_required_credits_for_plain_chat(model_name: str, options: PlainChatOptions | dict[str, Any] | None = None) -> float:
    _, model_entry = resolve_plain_chat_model(model_name)
    pricing = _derive_plain_chat_model_pricing_summary(model_entry)
    expected = pricing.get("expected")
    minimum = round(float(pricing.get("minimum") or settings.minimum_text_generation_cost), 4)

    if isinstance(expected, (int, float)):
        return round(float(expected), 4)
    if not isinstance(expected, dict):
        return minimum

    amount = _parse_billing_float(expected.get("amount"))
    if amount is not None:
        return round(amount, 4)

    raw_options: dict[str, Any]
    if isinstance(options, PlainChatOptions):
        raw_options = options.model_dump(by_alias=True, exclude_none=True)
    elif isinstance(options, dict):
        raw_options = options
    else:
        raw_options = {}

    parameter_schema = settings.get_model_parameter_schema(model_name, model_entry)
    effective_options = {
        **_default_image_size_options(parameter_schema),
        **raw_options,
    }

    sample_variant = _resolve_expected_variant_price(
        expected.get("sampleImageSizePrices") if isinstance(expected.get("sampleImageSizePrices"), dict) else None,
        effective_options.get("sampleImageSize"),
    )
    if sample_variant is not None:
        return sample_variant

    image_variant = _resolve_expected_variant_price(
        expected.get("imageSizePrices") if isinstance(expected.get("imageSizePrices"), dict) else None,
        effective_options.get("imageSize"),
    )
    if image_variant is not None:
        return image_variant

    # Grok prices the image by resolution (1k/2k).
    resolution_variant = _resolve_expected_variant_price(
        expected.get("imageSizePrices") if isinstance(expected.get("imageSizePrices"), dict) else None,
        effective_options.get("resolution"),
    )
    if resolution_variant is not None:
        return resolution_variant

    base_price = _parse_billing_float(expected.get("basePrice"))
    if base_price is not None:
        return round(base_price, 4)

    return minimum


def _default_image_size_options(parameter_schema: dict[str, Any]) -> dict[str, Any]:
    defaults: dict[str, Any] = {}
    for key in ("sampleImageSize", "imageSize"):
        entry = parameter_schema.get(key)
        if not isinstance(entry, dict):
            continue
        value = entry.get("recommendedDefault")
        if value is None:
            value = entry.get("default")
        if value is None:
            value = entry.get("value")
        if value is None and "1K" in [str(item).upper() for item in entry.get("values", []) if str(item).strip()]:
            value = "1K"
        if value is not None:
            defaults[key] = value
    return defaults


def normalize_plain_chat_system(model_name: str, parts: list[ChatMessagePart]) -> list[dict[str, Any]]:
    _, model_entry = resolve_plain_chat_model(model_name)
    _validate_system_parts(parts, supports_image_input=_supports_image_input(model_entry))
    return [_serialize_part(part) for part in parts] if parts else _system_parts([], user_uid="")


def serialize_plain_chat_parts(parts: list[ChatMessagePart]) -> list[dict[str, Any]]:
    return [_serialize_part(part) for part in parts]


def assemble_plain_chat_context(
    *,
    existing_messages: list[dict[str, Any]],
    next_user_parts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    max_messages = max(int(settings.plain_chat_context_message_limit), 1)
    max_chars = max(int(settings.plain_chat_context_char_limit), 1)
    prior_window_size = max(max_messages - 1, 0)
    recent_existing = existing_messages[-prior_window_size:] if prior_window_size else []
    next_message = {"role": "user", "parts": next_user_parts}
    budget_remaining = max_chars - _message_char_count(next_message)
    if budget_remaining <= 0:
        return [next_message]

    kept_messages: list[dict[str, Any]] = []
    for message in reversed(recent_existing):
        message_chars = _message_char_count(message)
        if message_chars <= 0:
            continue
        if message_chars > budget_remaining:
            continue
        kept_messages.append(message)
        budget_remaining -= message_chars
        if budget_remaining <= 0:
            break

    kept_messages.reverse()
    return [*kept_messages, next_message]


def prepare_plain_chat_conversation_request(
    *,
    model_name: str,
    system_parts: list[dict[str, Any]],
    messages: list[dict[str, Any]],
    options: PlainChatOptions | None = None,
) -> PlainChatRequest:
    return PlainChatRequest(
        model=model_name,
        system=[ChatMessagePart.model_validate(part) for part in system_parts],
        messages=[
            ChatMessage(
                role=str(message.get("role") or ""),
                parts=[ChatMessagePart.model_validate(part) for part in list(message.get("parts") or [])],
            )
            for message in messages
        ],
        options=options,
    )


def resolve_plain_chat_model(model_name: str) -> tuple[str, dict[str, Any]]:
    requested = model_name.strip()
    if not requested:
        raise ValueError("CHAT_MODEL_REQUIRED")

    for task_name, task_models in (settings.model_catalog or {}).items():
        if not isinstance(task_models, dict):
            continue
        model_entry = task_models.get(requested)
        if isinstance(model_entry, dict) and is_model_enabled(requested, model_entry):
            return task_name, model_entry

    raise ValueError("CHAT_MODEL_NOT_FOUND")


def send_plain_chat(payload: PlainChatRequest, *, user_uid: str) -> dict[str, Any]:
    _, model_entry = resolve_plain_chat_model(payload.model)
    provider = str(model_entry.get("provider") or "").strip()
    model_id = str(model_entry.get("model_id") or payload.model).strip()

    if not provider:
        raise ValueError("CHAT_MODEL_PROVIDER_MISSING")
    if not model_id:
        raise ValueError("CHAT_MODEL_ID_MISSING")

    if _is_image_only_output_model(model_entry):
        one_shot_payload = PlainChatRequest(
            model=payload.model,
            messages=[payload.messages[-1]] if payload.messages else [],
            options=payload.options,
        )
        _validate_plain_chat_request(one_shot_payload, model_entry)
        request_options = _normalized_options(
            one_shot_payload.options,
            provider=provider,
            model_id=model_id,
            model_entry=model_entry,
            messages=one_shot_payload.messages,
        )
        # Image-editing models (e.g. Grok Imagine *-editing) need the uploaded image(s)
        # forwarded; the one-shot prompt is text-only otherwise.
        input_images = _extract_input_images(one_shot_payload.messages, user_uid=user_uid)
        image_result = generate_image_payload_via_proxy(
            provider,
            model_id,
            preview_plain_chat_prompt(one_shot_payload),
            owner_uid=user_uid,
            input_images=input_images or None,
            options=request_options,
        )
        assistant_parts: list[dict[str, Any]] = []
        if str(image_result.get("text") or "").strip():
            assistant_parts.append({"type": "text", "text": str(image_result.get("text"))})
        if str(image_result.get("image") or "").strip():
            assistant_parts.append({"type": "image_url", "url": str(image_result.get("image"))})
        return {
            **image_result,
            "message": {"role": "assistant", "parts": assistant_parts},
        }

    _validate_plain_chat_request(payload, model_entry)

    request_options = _normalized_options(
        payload.options,
        provider=provider,
        model_id=model_id,
        model_entry=model_entry,
        messages=payload.messages,
    )

    request_payload: dict[str, Any] = {
        "model": model_id,
        "provider": provider,
        "system": _system_parts(payload.system, user_uid=user_uid),
        "messages": _serialize_request_messages(payload.messages, user_uid=user_uid),
        "options": request_options,
    }

    result = generate_chat_via_proxy(request_payload, owner_uid=user_uid)
    result["message"] = _sanitize_provider_message(result.get("message"))
    return result


def preview_plain_chat_prompt(payload: PlainChatRequest) -> str:
    for message in reversed(payload.messages):
        if message.role != "user":
            continue
        text = " ".join(
            part.text.strip()
            for part in message.parts
            if part.type == "text" and isinstance(part.text, str) and part.text.strip()
        )
        if text:
            return text[:2000]
    return "plain_chat"


def _serialize_message(message: ChatMessage) -> dict[str, Any]:
    return {
        "role": message.role,
        "parts": [_serialize_part(part) for part in message.parts],
    }


def _serialize_request_messages(messages: list[ChatMessage], *, user_uid: str) -> list[dict[str, Any]]:
    serialized: list[dict[str, Any]] = []
    for message in messages:
        parts = [_request_part(part, user_uid=user_uid) for part in message.parts]
        if message.role == "assistant":
            # Gemini image-capable chat requests reject replaying assistant image parts
            # in history. Keep only assistant text for continuity.
            parts = [part for part in parts if part.get("type") == "text" and str(part.get("text") or "").strip()]
        if not parts:
            continue
        serialized.append({
            "role": message.role,
            "parts": parts,
        })
    return serialized


def _system_parts(parts: list[ChatMessagePart], *, user_uid: str) -> list[dict[str, Any]]:
    if parts:
        return [_request_part(part, user_uid=user_uid) for part in parts]
    if settings.plain_chat_default_system_prompt:
        return [{"type": "text", "text": settings.plain_chat_default_system_prompt}]
    return []


def _serialize_part(part: ChatMessagePart) -> dict[str, Any]:
    if part.type == "text":
        return {"type": "text", "text": (part.text or "").strip()}
    return {"type": "image_url", "url": str(part.url or "").strip()}


def _request_part(part: ChatMessagePart, *, user_uid: str) -> dict[str, Any]:
    if part.type == "text":
        return {"type": "text", "text": (part.text or "").strip()}

    image_url = str(part.url or "").strip()
    file_id = _private_file_id_from_url(image_url)
    if file_id:
        mime_type, encoded_image = _load_private_uploaded_image_data(file_id, user_uid=user_uid)
        return {"type": "image", "mimeType": mime_type, "data": encoded_image}
    return {"type": "image_url", "url": image_url}


def _extract_input_images(messages: list[ChatMessage], *, user_uid: str) -> list[dict[str, str]]:
    """Collect uploaded image parts (one-shot image editing) in the shape
    apikeymanager_client._build_input_parts expects: {url} or {data, mime_type}."""
    images: list[dict[str, str]] = []
    for message in messages:
        if message.role != "user":
            continue
        for part in message.parts:
            if part.type != "image_url":
                continue
            resolved = _request_part(part, user_uid=user_uid)
            if resolved.get("type") == "image" and resolved.get("data"):
                images.append({"data": resolved["data"], "mime_type": resolved.get("mimeType") or "image/jpeg"})
            elif resolved.get("type") == "image_url" and resolved.get("url"):
                images.append({"url": resolved["url"]})
    return images


def _validate_plain_chat_request(payload: PlainChatRequest, model_entry: dict[str, Any]) -> None:
    if not payload.messages:
        raise ValueError("CHAT_MESSAGES_REQUIRED")
    if payload.messages[-1].role != "user":
        raise ValueError("CHAT_LAST_MESSAGE_MUST_BE_USER")

    supports_image_input = _supports_image_input(model_entry)
    max_input_images = _max_input_images_for_model(model_entry)

    for message in payload.messages:
        _validate_message_parts(
            message.parts,
            supports_image_input=supports_image_input,
            max_input_images=max_input_images,
            max_text_chars_per_part=_max_text_chars_for_role(message.role),
            max_message_chars=_max_message_chars_for_role(message.role),
        )
    _validate_system_parts(payload.system, supports_image_input=supports_image_input)

    total_message_chars = sum(_message_char_count(_serialize_message(message)) for message in payload.messages)
    if total_message_chars > int(settings.plain_chat_context_char_limit):
        raise ValueError("CHAT_CONTEXT_TOO_LARGE")

    _validate_plain_chat_options(payload.options, payload.model, model_entry)


def _max_text_chars_for_role(role: str) -> int:
    if role == "assistant":
        return int(settings.plain_chat_max_response_text_chars_per_part)
    return int(settings.plain_chat_max_text_chars_per_part)


def _max_message_chars_for_role(role: str) -> int:
    if role == "assistant":
        return int(settings.plain_chat_max_response_chars)
    return int(settings.plain_chat_max_message_chars)


def _validate_message_parts(
    parts: list[ChatMessagePart],
    *,
    supports_image_input: bool,
    max_input_images: int = MAX_CHAT_INPUT_IMAGES,
    max_text_chars_per_part: int | None = None,
    max_message_chars: int | None = None,
) -> None:
    if not parts:
        raise ValueError("CHAT_MESSAGE_PARTS_REQUIRED")

    has_text = False
    total_chars = 0
    text_limit = int(max_text_chars_per_part or settings.plain_chat_max_text_chars_per_part)
    message_limit = int(max_message_chars or settings.plain_chat_max_message_chars)
    image_count = 0
    for part in parts:
        if part.type == "text":
            text = (part.text or "").strip()
            if not text:
                raise ValueError("CHAT_TEXT_PART_EMPTY")
            if len(text) > text_limit:
                raise ValueError("CHAT_TEXT_PART_TOO_LARGE")
            has_text = True
            total_chars += len(text)
            continue

        image_url = str(part.url or "").strip()
        if not image_url:
            raise ValueError("CHAT_IMAGE_URL_REQUIRED")
        if not supports_image_input:
            raise ValueError("CHAT_MODEL_DOES_NOT_SUPPORT_IMAGE_INPUT")
        image_count += 1
        if image_count > max_input_images:
            raise ValueError("CHAT_TOO_MANY_IMAGES")
        _validate_uploaded_image_url(image_url)
        total_chars += len(image_url)

    if not has_text and all(part.type != "image_url" for part in parts):
        raise ValueError("CHAT_MESSAGE_EMPTY")
    if total_chars > message_limit:
        raise ValueError("CHAT_MESSAGE_TOO_LARGE")


def _validate_system_parts(parts: list[ChatMessagePart], *, supports_image_input: bool) -> None:
    if not parts:
        return
    _validate_message_parts(parts, supports_image_input=supports_image_input)
    total_chars = sum(len((part.text or "").strip()) if part.type == "text" else len(str(part.url or "").strip()) for part in parts)
    if total_chars > int(settings.plain_chat_max_system_chars):
        raise ValueError("CHAT_SYSTEM_TOO_LARGE")


def _validate_uploaded_image_url(image_url: str) -> None:
    if private_file_id_from_url(image_url):
        return
    parsed = urlparse(image_url)
    filename = Path(parsed.path).name
    generated_prefixes: list[str] = []
    if settings.public_backend_base_url:
        generated_prefixes.append(f"{settings.public_backend_base_url}/generated-images/")
    for generated_prefix in generated_prefixes:
        if image_url.startswith(generated_prefix) and SAFE_GENERATED_FILENAME.match(filename):
            return
    raise ValueError("CHAT_IMAGE_URL_INVALID")


def _private_file_url_prefix() -> str:
    return private_file_url_prefix()


def _private_file_id_from_url(image_url: str) -> str | None:
    return private_file_id_from_url(image_url)


def _load_private_uploaded_image_data(file_id: str, *, user_uid: str) -> tuple[str, str]:
    try:
        file_record, storage_path = load_private_user_file(
            file_id,
            user_uid,
            allowed_kinds={"uploaded_input", "generated_output"},
        )
    except Exception as exc:
        raise ValueError("CHAT_IMAGE_URL_INVALID") from exc
    image_bytes = storage_path.read_bytes()
    return str(file_record["mime_type"]), base64.b64encode(image_bytes).decode("ascii")


def _supports_image_input(model_entry: dict[str, Any]) -> bool:
    input_modalities = set(model_entry.get("input_modalities") or [])
    return "IMAGE" in input_modalities or model_entry.get("type") == "gemini-image"


def _max_input_images_for_model(model_entry: dict[str, Any]) -> int:
    """Grok image-editing models cap at 3 source images; others use the chat default."""
    model_id = str(model_entry.get("model_id") or "").strip().lower()
    if model_id.startswith("grok") and _supports_image_input(model_entry):
        return MAX_GROK_EDIT_INPUT_IMAGES
    return MAX_CHAT_INPUT_IMAGES


def _is_image_only_output_model(model_entry: dict[str, Any]) -> bool:
    output_modalities = set(model_entry.get("output_modalities") or [])
    return "IMAGE" in output_modalities and "TEXT" not in output_modalities


def _parse_billing_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return round(parsed, 6)


def _normalize_expected_pricing_key(value: Any) -> str:
    raw = str(value or "").strip().lower().replace(" ", "")
    if raw in {"512", "512px", "0.5k"}:
        return "0.5k"
    if raw in {"1024", "1024px", "1k"}:
        return "1k"
    if raw in {"2048", "2048px", "2k"}:
        return "2k"
    if raw in {"4096", "4096px", "4k"}:
        return "4k"
    return raw


def _resolve_expected_variant_price(price_map: dict[str, Any] | None, value: Any) -> float | None:
    if not isinstance(price_map, dict):
        return None
    target = _normalize_expected_pricing_key(value)
    if not target:
        return None
    for raw_key, raw_value in price_map.items():
        if _normalize_expected_pricing_key(raw_key) != target:
            continue
        parsed = _parse_billing_float(raw_value)
        if parsed is not None:
            return round(parsed, 4)
    return None


def _derive_plain_chat_model_pricing_summary(model_config: dict[str, Any] | None) -> dict[str, Any]:
    config = dict(model_config or {})
    billing = config.get("billing") if isinstance(config.get("billing"), dict) else {}
    billing_mode = str(billing.get("mode") or "").strip().lower()
    fixed_config = billing.get("fixed") if isinstance(billing.get("fixed"), dict) else {}
    fixed_amount = _parse_billing_float(fixed_config.get("amount"))
    image_config = billing.get("image") if isinstance(billing.get("image"), dict) else {}
    image_size_prices = image_config.get("imageSizePrices") if isinstance(image_config.get("imageSizePrices"), dict) else {}
    sample_image_size_prices = image_config.get("sampleImageSizePrices") if isinstance(image_config.get("sampleImageSizePrices"), dict) else {}
    base_price = _parse_billing_float(image_config.get("basePrice"))

    normalized_image_size_prices = {
        str(key): parsed
        for key, raw in image_size_prices.items()
        if (parsed := _parse_billing_float(raw)) is not None
    }
    normalized_sample_image_size_prices = {
        str(key): parsed
        for key, raw in sample_image_size_prices.items()
        if (parsed := _parse_billing_float(raw)) is not None
    }

    candidates: list[float] = []
    if fixed_amount is not None:
        candidates.append(fixed_amount)
    if base_price is not None:
        candidates.append(base_price)
    candidates.extend(normalized_image_size_prices.values())
    candidates.extend(normalized_sample_image_size_prices.values())

    text_floor = round(settings.minimum_text_generation_cost, 4)
    image_floor = round(settings.minimum_image_generation_cost, 4)

    if not candidates:
        return {
            "minimum": text_floor,
            "expected": {
                "type": "usage_based" if billing_mode in {"token", "composite"} else "fixed",
                "label": "Usage-based billing",
                "amount": text_floor,
            },
        }

    raw_minimum = round(min(candidates), 4)
    minimum = round(max(raw_minimum, image_floor), 4)

    expected: dict[str, Any]
    if fixed_amount is not None and not normalized_image_size_prices and not normalized_sample_image_size_prices and base_price is None:
        expected = {
            "type": "fixed",
            "label": "Fixed billing",
            "amount": round(fixed_amount, 4),
        }
    else:
        expected = {
            "type": "image_variant" if (normalized_image_size_prices or normalized_sample_image_size_prices) else "fixed",
        }
    if base_price is not None:
        expected["basePrice"] = round(base_price, 4)
    if normalized_image_size_prices:
        expected["imageSizePrices"] = {key: round(value, 4) for key, value in normalized_image_size_prices.items()}
    if normalized_sample_image_size_prices:
        expected["sampleImageSizePrices"] = {key: round(value, 4) for key, value in normalized_sample_image_size_prices.items()}

    return {
        "minimum": minimum,
        "expected": expected,
    }


def _message_char_count(message: dict[str, Any]) -> int:
    total = 0
    for part in list(message.get("parts") or []):
        if not isinstance(part, dict):
            continue
        if str(part.get("type") or "") == "text":
            total += len(str(part.get("text") or "").strip())
        else:
            total += len(str(part.get("url") or "").strip())
    return total


def _normalized_options(
    options: PlainChatOptions | None,
    *,
    provider: str,
    model_id: str,
    model_entry: dict[str, Any],
    messages: list[ChatMessage],
) -> dict[str, Any]:
    default_max_tokens = min(max(int(settings.plain_chat_default_max_tokens), 10), int(settings.plain_chat_max_output_tokens))
    if not options:
        payload = {"maxTokens": default_max_tokens}
        _apply_response_modalities(payload, provider=provider, model_id=model_id, model_entry=model_entry, messages=messages)
        return payload

    payload: dict[str, Any] = {}

    if options.temperature is not None:
        payload["temperature"] = float(options.temperature)

    if options.top_p is not None:
        payload["topP"] = float(options.top_p)

    if options.thinking_budget is not None:
        payload["thinkingBudget"] = int(options.thinking_budget)

    if options.thinking_level is not None:
        payload["thinkingLevel"] = str(options.thinking_level).upper()

    if options.presence_penalty is not None:
        payload["presencePenalty"] = float(options.presence_penalty)

    if options.frequency_penalty is not None:
        payload["frequencyPenalty"] = float(options.frequency_penalty)

    payload["candidateCount"] = 1

    if options.media_resolution is not None:
        payload["mediaResolution"] = str(options.media_resolution).lower()

    if options.image_size is not None:
        payload["imageSize"] = str(options.image_size)

    if options.resolution is not None:
        payload["resolution"] = str(options.resolution)

    if options.quality is not None:
        payload["quality"] = str(options.quality)

    if options.sample_image_size is not None:
        payload["sampleImageSize"] = str(options.sample_image_size)

    if options.aspect_ratio is not None:
        payload["aspectRatio"] = str(options.aspect_ratio)

    if options.seed is not None:
        payload["seed"] = int(options.seed)

    if options.add_watermark is not None:
        payload["addWatermark"] = bool(options.add_watermark)

    if options.enhance_prompt is not None:
        payload["enhancePrompt"] = bool(options.enhance_prompt)

    if options.output_mime_type is not None:
        payload["outputMimeType"] = str(options.output_mime_type)

    if options.prompt_cache_key is not None:
        payload["promptCacheKey"] = str(options.prompt_cache_key)

    if options.style_type is not None:
        payload["styleType"] = str(options.style_type)

    if options.style_preset is not None:
        payload["stylePreset"] = str(options.style_preset)

    if options.strength is not None:
        payload["strength"] = float(options.strength)

    if options.colors:
        rgbs = [rgb for rgb in (_hex_to_rgb(color) for color in options.colors) if rgb is not None]
        if rgbs:
            payload["colors"] = rgbs

    if options.background_color is not None:
        background_rgb = _hex_to_rgb(options.background_color)
        if background_rgb is not None:
            payload["backgroundColor"] = background_rgb

    requested_max_tokens = int(options.max_tokens or settings.plain_chat_default_max_tokens)
    payload["maxTokens"] = min(max(requested_max_tokens, 10), int(settings.plain_chat_max_output_tokens))
    _apply_response_modalities(payload, provider=provider, model_id=model_id, model_entry=model_entry, messages=messages)
    return payload


def _apply_response_modalities(
    payload: dict[str, Any],
    *,
    provider: str,
    model_id: str,
    model_entry: dict[str, Any],
    messages: list[ChatMessage],
) -> None:
    if provider != "google-gemini":
        return
    if not _is_gemini_image_capable_model(model_id, model_entry):
        return
    payload["responseModalities"] = ["TEXT", "IMAGE"]


def _is_gemini_image_capable_model(model_id: str, model_entry: dict[str, Any]) -> bool:
    return "image" in model_id.lower() or model_entry.get("type") == "gemini-image"


def _validate_plain_chat_options(options: PlainChatOptions | None, model_name: str, model_entry: dict[str, Any]) -> None:
    if options is None:
        return

    provided_options = options.model_dump(by_alias=True, exclude_none=True)
    if not provided_options:
        return

    parameter_schema = settings.get_model_parameter_schema(model_name, model_entry)

    for option_key, option_value in provided_options.items():
        if option_key == "promptCacheKey":
            continue
        if option_key == "candidateCount":
            continue

        schema_key = MODEL_PARAMETER_OPTION_KEY_MAP.get(option_key)
        if not schema_key:
            raise ValueError(f"CHAT_BAD_PARAM:{option_key}:unsupported")

        schema_entry = parameter_schema.get(schema_key)
        if not isinstance(schema_entry, dict):
            raise ValueError(f"CHAT_BAD_PARAM:{option_key}:unsupported")

        if schema_entry.get("configurable") is False and "value" in schema_entry:
            if not _schema_value_matches(option_value, schema_entry.get("value")):
                raise ValueError(f"CHAT_BAD_PARAM:{option_key}:fixed")
            continue

        _validate_option_against_schema(option_key, option_value, schema_entry)


def _validate_option_against_schema(option_key: str, option_value: Any, schema_entry: dict[str, Any]) -> None:
    option_type = str(schema_entry.get("type") or "").strip().lower()

    if option_type == "enum":
        allowed_values = schema_entry.get("values")
        if not isinstance(allowed_values, list) or not allowed_values:
            raise ValueError(f"CHAT_BAD_PARAM:{option_key}:unsupported")
        if not any(_schema_value_matches(option_value, allowed) for allowed in allowed_values):
            raise ValueError(f"CHAT_BAD_PARAM:{option_key}:enum")
        return

    if option_type in {"float", "integer"}:
        if not isinstance(option_value, (int, float)) or isinstance(option_value, bool):
            raise ValueError(f"CHAT_BAD_PARAM:{option_key}:type")

        numeric_value = float(option_value)
        minimum = schema_entry.get("min")
        maximum = schema_entry.get("max")
        min_exclusive = schema_entry.get("minExclusive")
        max_exclusive = schema_entry.get("maxExclusive")

        if minimum is not None and numeric_value < float(minimum):
            raise ValueError(f"CHAT_BAD_PARAM:{option_key}:range")
        if maximum is not None and numeric_value > float(maximum):
            raise ValueError(f"CHAT_BAD_PARAM:{option_key}:range")
        if min_exclusive is not None and numeric_value <= float(min_exclusive):
            raise ValueError(f"CHAT_BAD_PARAM:{option_key}:range")
        if max_exclusive is not None and numeric_value >= float(max_exclusive):
            raise ValueError(f"CHAT_BAD_PARAM:{option_key}:range")
        return

    if option_type == "boolean":
        if not isinstance(option_value, bool):
            raise ValueError(f"CHAT_BAD_PARAM:{option_key}:type")
        return


def _schema_value_matches(actual: Any, expected: Any) -> bool:
    if isinstance(actual, str) and isinstance(expected, str):
        return actual.strip().upper() == expected.strip().upper()
    return actual == expected


def _sanitize_provider_message(message: Any) -> dict[str, Any]:
    if not isinstance(message, dict):
        raise ValueError("CHAT_INVALID_PROVIDER_RESPONSE")

    parts = list(message.get("parts") or [])
    sanitized_parts: list[dict[str, Any]] = []
    total_chars = 0

    for part in parts:
        if not isinstance(part, dict):
            continue
        part_type = str(part.get("type") or "")
        if part_type == "text":
            text = str(part.get("text") or "").strip()
            if not text:
                continue
            max_part_chars = int(settings.plain_chat_max_response_text_chars_per_part)
            if len(text) > max_part_chars:
                text = _truncate_with_ellipsis(text, max_part_chars)
            remaining_budget = int(settings.plain_chat_max_response_chars) - total_chars
            if remaining_budget <= 0:
                break
            if len(text) > remaining_budget:
                text = _truncate_with_ellipsis(text, remaining_budget)
            if not text:
                break
            sanitized_parts.append({"type": "text", "text": text})
            total_chars += len(text)
            continue

        if part_type != "image_url":
            continue

        image_url = str(part.get("url") or "").strip()
        if not image_url or len(image_url) > 2048:
            continue
        sanitized_parts.append({"type": "image_url", "url": image_url})

    if not sanitized_parts:
        raise ValueError("CHAT_EMPTY_PROVIDER_RESPONSE")

    return {"role": "assistant", "parts": sanitized_parts}


def _truncate_with_ellipsis(text: str, max_chars: int) -> str:
    if max_chars <= 0:
        return ""
    if len(text) <= max_chars:
        return text
    if max_chars <= 3:
        return text[:max_chars]
    return text[: max_chars - 3].rstrip() + "..."
