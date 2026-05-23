import pytest

from app.core.schema import ChatMessage, ChatMessagePart, PlainChatRequest
from app.services import chat_service


def test_plain_chat_validation_allows_long_assistant_history(monkeypatch):
    monkeypatch.setattr(chat_service.settings, "plain_chat_max_text_chars_per_part", 4000)
    monkeypatch.setattr(chat_service.settings, "plain_chat_max_message_chars", 12000)
    monkeypatch.setattr(chat_service.settings, "plain_chat_max_response_text_chars_per_part", 15000)
    monkeypatch.setattr(chat_service.settings, "plain_chat_max_response_chars", 15000)
    monkeypatch.setattr(chat_service.settings, "plain_chat_context_char_limit", 24000)

    payload = PlainChatRequest(
        model="nano-banana-2",
        messages=[
            ChatMessage(role="user", parts=[ChatMessagePart(type="text", text="hello")]),
            ChatMessage(role="assistant", parts=[ChatMessagePart(type="text", text="a" * 4789)]),
            ChatMessage(role="user", parts=[ChatMessagePart(type="text", text="continue")]),
        ],
    )

    chat_service._validate_plain_chat_request(payload, {"input_modalities": ["TEXT"]})


def test_plain_chat_validation_keeps_user_message_limit(monkeypatch):
    monkeypatch.setattr(chat_service.settings, "plain_chat_max_text_chars_per_part", 4000)
    monkeypatch.setattr(chat_service.settings, "plain_chat_max_message_chars", 12000)
    monkeypatch.setattr(chat_service.settings, "plain_chat_max_response_text_chars_per_part", 15000)
    monkeypatch.setattr(chat_service.settings, "plain_chat_max_response_chars", 15000)
    monkeypatch.setattr(chat_service.settings, "plain_chat_context_char_limit", 24000)

    payload = PlainChatRequest(
        model="nano-banana-2",
        messages=[
            ChatMessage(role="user", parts=[ChatMessagePart(type="text", text="a" * 4001)]),
        ],
    )

    with pytest.raises(ValueError, match="CHAT_TEXT_PART_TOO_LARGE"):
        chat_service._validate_plain_chat_request(payload, {"input_modalities": ["TEXT"]})


def test_plain_chat_validation_rejects_more_than_four_images(monkeypatch):
    monkeypatch.setattr(chat_service.settings, "plain_chat_max_text_chars_per_part", 4000)
    monkeypatch.setattr(chat_service.settings, "plain_chat_max_message_chars", 12000)
    monkeypatch.setattr(chat_service.settings, "plain_chat_context_char_limit", 24000)

    payload = PlainChatRequest(
        model="nano-banana-2",
        messages=[
            ChatMessage(
                role="user",
                parts=[
                    ChatMessagePart(type="image_url", url=f"/api/files/{index}")
                    for index in range(5)
                ],
            ),
        ],
    )

    with pytest.raises(ValueError, match="CHAT_TOO_MANY_IMAGES"):
        chat_service._validate_plain_chat_request(payload, {"input_modalities": ["TEXT", "IMAGE"]})

def test_plain_chat_model_list_and_resolution_include_non_text_outputs(monkeypatch):
    monkeypatch.setattr(chat_service.settings, "model_catalog", {
        "image": {
            "image-only-model": {
                "display_name": "Image Only Model",
                "provider": "google-gemini",
                "output_modalities": ["IMAGE"],
                "input_modalities": ["TEXT"],
            },
        },
    })
    monkeypatch.setattr(
        chat_service.settings,
        "get_model_parameter_schema",
        lambda model_name, model_entry: {},
    )

    models = chat_service.list_plain_chat_models()

    assert [model["id"] for model in models] == ["image-only-model"]
    assert chat_service.resolve_plain_chat_model("image-only-model")[0] == "image"

def test_plain_chat_image_only_model_uses_image_proxy(monkeypatch):
    monkeypatch.setattr(chat_service.settings, "model_catalog", {
        "image": {
            "imagen-test": {
                "model_id": "imagen-test",
                "provider": "google-imagen",
                "output_modalities": ["IMAGE"],
                "input_modalities": ["TEXT"],
            },
        },
    })
    monkeypatch.setattr(
        chat_service.settings,
        "get_model_parameter_schema",
        lambda model_name, model_entry: {},
    )

    calls = []

    def fake_generate_image(provider, model_id, prompt, *, owner_uid, options=None, **kwargs):
        calls.append({
            "provider": provider,
            "model_id": model_id,
            "prompt": prompt,
            "owner_uid": owner_uid,
            "options": options,
        })
        return {
            "image": "/api/files/generated-image",
            "text": "",
            "usage": {},
            "billingMode": "fixed",
            "resolvedCost": "0.04",
            "billing": {},
            "provider": provider,
            "model": model_id,
            "meta": {},
        }

    monkeypatch.setattr(chat_service, "generate_image_payload_via_proxy", fake_generate_image)
    monkeypatch.setattr(
        chat_service,
        "generate_chat_via_proxy",
        lambda *args, **kwargs: pytest.fail("image-only models should not use chat proxy"),
    )

    payload = PlainChatRequest(
        model="imagen-test",
        messages=[
            ChatMessage(role="user", parts=[ChatMessagePart(type="text", text="old prompt that must be ignored")]),
            ChatMessage(role="assistant", parts=[ChatMessagePart(type="image_url", url="/api/files/old-generated-image")]),
            ChatMessage(
                role="user",
                parts=[ChatMessagePart(type="text", text="generate an image of a futuristic city in the rain")],
            ),
        ],
    )

    result = chat_service.send_plain_chat(payload, user_uid="user-1")

    assert calls[0]["provider"] == "google-imagen"
    assert calls[0]["model_id"] == "imagen-test"
    assert calls[0]["prompt"] == "generate an image of a futuristic city in the rain"
    assert result["message"]["parts"] == [{"type": "image_url", "url": "/api/files/generated-image"}]

