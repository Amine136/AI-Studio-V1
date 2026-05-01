from __future__ import annotations

from pathlib import Path

from app.graph import nodes
from app.main import IMAGES_DIR, _validate_generation_results
from app.services.apikeymanager_client import ApiKeyManagerProxyError


def test_execute_generation_returns_error_when_provider_fails(monkeypatch):
    monkeypatch.setitem(nodes.settings.model_catalog, "image", {"test-model": {"provider": "mock", "model_id": "mock-image", "cost": 0.1}})
    monkeypatch.setattr(nodes, "generate_image_payload", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("Invalid base64 image returned by ApiKeyManager")))

    result = nodes.execute_generation(
        {
            "requested_outputs": ["image"],
            "content_spec": {"user_text": "test"},
            "model_requests": [
                {
                    "output_key": "image",
                    "model_name": "test-model",
                    "prompt": "test prompt",
                    "metadata": {},
                }
            ],
        }
    )

    assert result["status"] == "error"
    assert result["generated_assets"] == {}
    assert "No credits were charged" in result["error_message"]
    assert "Invalid base64 image returned by ApiKeyManager" in result["failure_reason"]


def test_validate_generation_results_rejects_missing_generated_image(tmp_path, monkeypatch):
    fake_backend = "https://vibecraft.ouni.space"
    monkeypatch.setattr("app.main.settings.public_backend_base_url", fake_backend)

    missing_image_url = f"{fake_backend}/images/123e4567-e89b-12d3-a456-426614174000.png"
    assert _validate_generation_results(["image"], {"image": missing_image_url}) == "generated_image_missing_or_invalid"


def test_validate_generation_results_accepts_existing_generated_image(tmp_path, monkeypatch):
    fake_backend = "https://vibecraft.ouni.space"
    monkeypatch.setattr("app.main.settings.public_backend_base_url", fake_backend)

    filename = "123e4567-e89b-12d3-a456-426614174000.png"
    image_path = IMAGES_DIR / filename
    image_path.write_bytes(b"\x89PNG\r\n\x1a\n")
    try:
        assert _validate_generation_results(
            ["image", "caption"],
            {
                "image": f"{fake_backend}/images/{filename}",
                "caption": "usable caption",
            },
        ) is None
    finally:
        if image_path.exists():
            image_path.unlink()


def test_execute_generation_returns_structured_provider_failure(monkeypatch):
    monkeypatch.setitem(nodes.settings.model_catalog, "image", {"test-model": {"provider": "mock", "model_id": "mock-image", "cost": 0.1}})

    def raise_timeout(*args, **kwargs):
        raise ApiKeyManagerProxyError(
            error_type="timeout",
            code="PROVIDER_TIMEOUT",
            message="Provider request timed out",
            retryable=True,
            provider="OpenAI",
        )

    monkeypatch.setattr(nodes, "generate_image_payload", raise_timeout)

    result = nodes.execute_generation(
        {
            "requested_outputs": ["image"],
            "content_spec": {"user_text": "test"},
            "model_requests": [
                {
                    "output_key": "image",
                    "model_name": "test-model",
                    "prompt": "test prompt",
                    "metadata": {},
                }
            ],
        }
    )

    assert result["status"] == "error"
    assert "Provider request timed out" in result["failure_reason"]
