import re
from pathlib import Path
from typing import Any, Dict
from urllib.parse import urlparse

from app.config import settings
from app.core.schema import ChatMessage, ChatMessagePart, PlainChatOptions, PlainChatRequest
from app.services.apikeymanager_client import generate_chat_via_proxy

SAFE_UPLOADED_FILENAME = re.compile(r"^[a-f0-9]{32}\.(jpg|png|webp)$")


def list_plain_chat_models() -> list[dict[str, Any]]:
    models: dict[str, dict[str, Any]] = {}

    for task_models in (settings.model_catalog or {}).values():
        if not isinstance(task_models, dict):
            continue
        for model_name, model_entry in task_models.items():
            if not isinstance(model_entry, dict) or not _is_text_capable_model(model_entry):
                continue
            models[model_name] = {
                "id": model_name,
                "displayName": str(model_entry.get("display_name") or model_name),
                "description": str(model_entry.get("description") or ""),
                "provider": str(model_entry.get("provider") or ""),
                "cost": _effective_plain_chat_cost(model_entry),
                "supportsImageInput": _supports_image_input(model_entry),
            }

    return sorted(
        models.values(),
        key=lambda item: (str(item.get("provider") or ""), str(item.get("displayName") or "")),
    )


def estimate_plain_chat_cost(model_name: str) -> float:
    _, model_entry = resolve_plain_chat_model(model_name)
    return _effective_plain_chat_cost(model_entry)


def normalize_plain_chat_system(model_name: str, parts: list[ChatMessagePart]) -> list[dict[str, Any]]:
    _, model_entry = resolve_plain_chat_model(model_name)
    _validate_system_parts(parts, supports_image_input=_supports_image_input(model_entry))
    return _system_parts(parts)


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
        if isinstance(model_entry, dict) and _is_text_capable_model(model_entry):
            return task_name, model_entry

    raise ValueError("CHAT_MODEL_NOT_FOUND")


def send_plain_chat(payload: PlainChatRequest) -> dict[str, Any]:
    _, model_entry = resolve_plain_chat_model(payload.model)
    provider = str(model_entry.get("provider") or "").strip()
    model_id = str(model_entry.get("model_id") or payload.model).strip()

    if not provider:
        raise ValueError("CHAT_MODEL_PROVIDER_MISSING")
    if not model_id:
        raise ValueError("CHAT_MODEL_ID_MISSING")

    _validate_plain_chat_request(payload, model_entry)

    request_payload: dict[str, Any] = {
        "model": model_id,
        "provider": provider,
        "system": _system_parts(payload.system),
        "messages": [_serialize_message(message) for message in payload.messages],
    }

    request_payload["options"] = _normalized_options(payload.options)

    result = generate_chat_via_proxy(request_payload)
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


def _system_parts(parts: list[ChatMessagePart]) -> list[dict[str, Any]]:
    if parts:
        return [_serialize_part(part) for part in parts]
    if settings.plain_chat_default_system_prompt:
        return [{"type": "text", "text": settings.plain_chat_default_system_prompt}]
    return []


def _serialize_part(part: ChatMessagePart) -> dict[str, Any]:
    if part.type == "text":
        return {"type": "text", "text": (part.text or "").strip()}
    return {"type": "image_url", "url": str(part.url or "").strip()}


def _validate_plain_chat_request(payload: PlainChatRequest, model_entry: dict[str, Any]) -> None:
    if not payload.messages:
        raise ValueError("CHAT_MESSAGES_REQUIRED")
    if payload.messages[-1].role != "user":
        raise ValueError("CHAT_LAST_MESSAGE_MUST_BE_USER")

    supports_image_input = _supports_image_input(model_entry)

    for message in payload.messages:
        _validate_message_parts(message.parts, supports_image_input=supports_image_input)
    _validate_system_parts(payload.system, supports_image_input=supports_image_input)

    total_message_chars = sum(_message_char_count(_serialize_message(message)) for message in payload.messages)
    if total_message_chars > int(settings.plain_chat_context_char_limit):
        raise ValueError("CHAT_CONTEXT_TOO_LARGE")


def _validate_message_parts(parts: list[ChatMessagePart], *, supports_image_input: bool) -> None:
    if not parts:
        raise ValueError("CHAT_MESSAGE_PARTS_REQUIRED")

    has_text = False
    total_chars = 0
    for part in parts:
        if part.type == "text":
            text = (part.text or "").strip()
            if not text:
                raise ValueError("CHAT_TEXT_PART_EMPTY")
            if len(text) > int(settings.plain_chat_max_text_chars_per_part):
                raise ValueError("CHAT_TEXT_PART_TOO_LARGE")
            has_text = True
            total_chars += len(text)
            continue

        image_url = str(part.url or "").strip()
        if not image_url:
            raise ValueError("CHAT_IMAGE_URL_REQUIRED")
        if not supports_image_input:
            raise ValueError("CHAT_MODEL_DOES_NOT_SUPPORT_IMAGE_INPUT")
        _validate_uploaded_image_url(image_url)
        total_chars += len(image_url)

    if not has_text and all(part.type != "image_url" for part in parts):
        raise ValueError("CHAT_MESSAGE_EMPTY")
    if total_chars > int(settings.plain_chat_max_message_chars):
        raise ValueError("CHAT_MESSAGE_TOO_LARGE")


def _validate_system_parts(parts: list[ChatMessagePart], *, supports_image_input: bool) -> None:
    if not parts:
        return
    _validate_message_parts(parts, supports_image_input=supports_image_input)
    total_chars = sum(len((part.text or "").strip()) if part.type == "text" else len(str(part.url or "").strip()) for part in parts)
    if total_chars > int(settings.plain_chat_max_system_chars):
        raise ValueError("CHAT_SYSTEM_TOO_LARGE")


def _validate_uploaded_image_url(image_url: str) -> None:
    prefix = f"{settings.public_backend_base_url}/images/"
    if not image_url.startswith(prefix):
        raise ValueError("CHAT_IMAGE_URL_INVALID")

    parsed = urlparse(image_url)
    filename = Path(parsed.path).name
    if not SAFE_UPLOADED_FILENAME.match(filename):
        raise ValueError("CHAT_IMAGE_URL_INVALID")


def _is_text_capable_model(model_entry: dict[str, Any]) -> bool:
    output_modalities = set(model_entry.get("output_modalities") or [])
    return not output_modalities or "TEXT" in output_modalities


def _supports_image_input(model_entry: dict[str, Any]) -> bool:
    input_modalities = set(model_entry.get("input_modalities") or [])
    return "IMAGE" in input_modalities or model_entry.get("type") == "gemini-image"


def _effective_plain_chat_cost(model_entry: dict[str, Any]) -> float:
    raw_cost = float(model_entry.get("cost", 0) or 0)
    return round(max(raw_cost, float(settings.minimum_text_generation_cost)), 2)


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


def _normalized_options(options: PlainChatOptions | None) -> dict[str, Any]:
    payload = options.model_dump(by_alias=True, exclude_none=True) if options else {}
    requested_max_tokens = int(payload.get("maxTokens") or settings.plain_chat_default_max_tokens)
    payload["maxTokens"] = min(max(requested_max_tokens, 1), int(settings.plain_chat_max_output_tokens))
    return payload


def _sanitize_provider_message(message: Any) -> dict[str, Any]:
    if not isinstance(message, dict):
        raise ValueError("CHAT_INVALID_PROVIDER_RESPONSE")

    parts = list(message.get("parts") or [])
    sanitized_parts: list[dict[str, Any]] = []
    total_chars = 0

    for part in parts:
        if not isinstance(part, dict):
            continue
        if str(part.get("type") or "") != "text":
            continue
        text = str(part.get("text") or "").strip()
        if not text:
            continue
        text = text[: int(settings.plain_chat_max_response_text_chars_per_part)]
        remaining_budget = int(settings.plain_chat_max_response_chars) - total_chars
        if remaining_budget <= 0:
            break
        if len(text) > remaining_budget:
            text = text[:remaining_budget]
        sanitized_parts.append({"type": "text", "text": text})
        total_chars += len(text)

    if not sanitized_parts:
        raise ValueError("CHAT_EMPTY_PROVIDER_RESPONSE")

    return {"role": "assistant", "parts": sanitized_parts}
