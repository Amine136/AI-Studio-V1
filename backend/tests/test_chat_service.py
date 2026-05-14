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
