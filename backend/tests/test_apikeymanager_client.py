from __future__ import annotations

import httpx

from app.services import apikeymanager_client


class _FakeResponse:
    def __init__(self, *, status_code: int = 200, payload: dict | None = None, text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self) -> dict:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("POST", "http://test")
            response = httpx.Response(self.status_code, request=request, json=self._payload)
            raise httpx.HTTPStatusError("error", request=request, response=response)


class _FakeClient:
    def __init__(self, handler, timeout=None) -> None:
        self._handler = handler

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def post(self, url, json, headers):
        return self._handler("post", url, json, headers)

    def get(self, url, headers):
        return self._handler("get", url, None, headers)


def test_post_proxy_retries_once_for_timeout_then_succeeds(monkeypatch):
    attempts = {"count": 0}
    monkeypatch.setattr(apikeymanager_client.settings, "apikeymanager_token", "test-token")

    def handler(method, url, payload, headers):
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise httpx.TimeoutException("timed out")
        return _FakeResponse(
            payload={
                "status": "success",
                "data": {"outputs": {"text": "ok"}},
            }
        )

    monkeypatch.setattr(apikeymanager_client.httpx, "Client", lambda timeout=None: _FakeClient(handler, timeout=timeout))

    response = apikeymanager_client._post_proxy({"provider": "OpenAI", "model": "gpt-4.1"})

    assert response["status"] == "success"
    assert attempts["count"] == 2


def test_post_proxy_does_not_retry_invalid_output(monkeypatch):
    attempts = {"count": 0}
    monkeypatch.setattr(apikeymanager_client.settings, "apikeymanager_token", "test-token")

    def handler(method, url, payload, headers):
        attempts["count"] += 1
        return _FakeResponse(
            status_code=502,
            payload={
                "status": "error",
                "message": "OpenAI response did not contain text output",
                "error": {
                    "type": "invalid_output",
                    "code": "PROVIDER_INVALID_OUTPUT",
                    "message": "OpenAI response did not contain text output",
                    "retryable": False,
                    "provider": "OpenAI",
                    "upstreamStatus": 200,
                },
            },
        )

    monkeypatch.setattr(apikeymanager_client.httpx, "Client", lambda timeout=None: _FakeClient(handler, timeout=timeout))

    try:
        apikeymanager_client._post_proxy({"provider": "OpenAI", "model": "gpt-4.1"})
    except apikeymanager_client.ApiKeyManagerProxyError as exc:
        assert exc.error_type == "invalid_output"
        assert exc.retryable is False
    else:
        raise AssertionError("Expected ApiKeyManagerProxyError")

    assert attempts["count"] == 1


def test_check_apikeymanager_ready_uses_ready_endpoint(monkeypatch):
    seen = {"url": None}
    monkeypatch.setattr(apikeymanager_client.settings, "apikeymanager_token", "test-token")
    monkeypatch.setattr(apikeymanager_client.settings, "apikeymanager_base_url", "http://apikeymanager.local")

    def handler(method, url, payload, headers):
        seen["url"] = url
        return _FakeResponse(payload={"status": "ready"})

    monkeypatch.setattr(apikeymanager_client.httpx, "Client", lambda timeout=None: _FakeClient(handler, timeout=timeout))

    payload = apikeymanager_client.check_apikeymanager_ready()

    assert payload["status"] == "ready"
    assert seen["url"] == "http://apikeymanager.local/health/ready"


def test_build_input_parts_includes_multiple_images_before_text():
    parts = apikeymanager_client._build_input_parts(
        "describe these",
        input_images=[
            {"url": "https://example.test/one.png"},
            {"mime_type": "image/webp", "data": "abc123"},
        ],
    )

    assert parts == [
        {"type": "image_url", "url": "https://example.test/one.png"},
        {"type": "image", "mimeType": "image/webp", "data": "abc123"},
        {"type": "text", "text": "describe these"},
    ]
