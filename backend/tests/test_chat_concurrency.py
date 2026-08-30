from __future__ import annotations

import threading
from unittest import mock

import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.main import app
from app.services import postgres_security_store as store

client = TestClient(app)

CONVERSATION_ROUTE = "/chat/conversations/{conversation_id}/messages"


@pytest.fixture()
def chat_user(test_db, monkeypatch):
    """An authenticated user with a conversation and enough credits to chat."""
    uid = "chat-gate-user"
    store.ensure_user(uid, "chat-gate@example.com", "Chat Gate")
    store.adjust_credits(uid, 10.0, "grant", allow_negative=False)
    conversation = store.create_chat_conversation(uid, "gemini-2.5-flash", [])

    # FastAPI inspects the override's signature to build its own dependencies, so
    # this must take no parameters or *args/**kwargs get treated as query params.
    async def fake_verify():
        return {
            "uid": uid,
            "email": "chat-gate@example.com",
            "display_name": "Chat Gate",
            "is_admin": False,
            "claims": {},
            "profile": store.get_user(uid),
        }

    app.dependency_overrides[main.verify_firebase_user] = fake_verify
    # The gate is the subject under test; the rate limiter is not.
    monkeypatch.setattr(main, "_enforce_plain_chat_limits", lambda *a, **kw: None)
    try:
        yield uid, conversation["id"]
    finally:
        app.dependency_overrides.clear()


def _post(conversation_id: str):
    return client.post(
        CONVERSATION_ROUTE.format(conversation_id=conversation_id),
        json={"parts": [{"type": "text", "text": "hello"}]},
    )


def test_chat_gate_is_separate_from_generation_gate():
    """A chat burst must not consume the generation budget, or vice versa."""
    assert main._CHAT_GATE is not main._GENERATION_GATE
    assert main.CHAT_MAX_CONCURRENCY >= 1


def test_chat_turn_releases_the_gate_on_success(chat_user):
    _uid, conversation_id = chat_user
    fake_result = {
        "message": {"parts": [{"type": "text", "text": "hi"}]},
        "resolvedCost": 0.0,
        "usage": {"promptTokens": 1, "completionTokens": 1},
    }

    with mock.patch.object(main, "send_plain_chat", return_value=fake_result):
        for _ in range(main.CHAT_MAX_CONCURRENCY + 3):
            response = _post(conversation_id)
            assert response.status_code == 200, response.text

    # Every permit is back: the gate can be fully drained again.
    acquired = [main._CHAT_GATE.acquire(blocking=False) for _ in range(main.CHAT_MAX_CONCURRENCY)]
    for _ in range(sum(1 for ok in acquired if ok)):
        main._CHAT_GATE.release()
    assert all(acquired), "gate leaked a permit on the success path"


def test_chat_turn_releases_the_gate_on_provider_error(chat_user):
    """A raising provider must not leak a permit — that is a slow resource leak."""
    _uid, conversation_id = chat_user

    with mock.patch.object(main, "send_plain_chat", side_effect=RuntimeError("boom")):
        for _ in range(main.CHAT_MAX_CONCURRENCY + 3):
            response = _post(conversation_id)
            assert response.status_code == 500, response.text

    acquired = [main._CHAT_GATE.acquire(blocking=False) for _ in range(main.CHAT_MAX_CONCURRENCY)]
    for _ in range(sum(1 for ok in acquired if ok)):
        main._CHAT_GATE.release()
    assert all(acquired), "gate leaked a permit on the error path"


def test_chat_turn_releases_the_gate_on_http_error(chat_user):
    """404 is raised inside the guarded block; the permit must still come back."""
    _uid, conversation_id = chat_user

    for _ in range(main.CHAT_MAX_CONCURRENCY + 3):
        response = _post("does-not-exist")
        assert response.status_code == 404, response.text

    acquired = [main._CHAT_GATE.acquire(blocking=False) for _ in range(main.CHAT_MAX_CONCURRENCY)]
    for _ in range(sum(1 for ok in acquired if ok)):
        main._CHAT_GATE.release()
    assert all(acquired), "gate leaked a permit on the HTTPException path"


def test_chat_turn_sheds_load_when_gate_is_full(chat_user):
    """With no permits left the route must 503 immediately, not queue."""
    _uid, conversation_id = chat_user

    held = 0
    try:
        while main._CHAT_GATE.acquire(blocking=False):
            held += 1
        assert held == main.CHAT_MAX_CONCURRENCY

        response = _post(conversation_id)
        assert response.status_code == 503, response.text
        assert response.headers.get("Retry-After") == "5"
        assert "busy" in response.json()["detail"].lower()
    finally:
        for _ in range(held):
            main._CHAT_GATE.release()


def test_rejected_request_does_not_over_release(chat_user):
    """A shed request must not run finally: BoundedSemaphore would raise."""
    _uid, conversation_id = chat_user

    held = 0
    try:
        while main._CHAT_GATE.acquire(blocking=False):
            held += 1
        assert _post(conversation_id).status_code == 503
    finally:
        for _ in range(held):
            main._CHAT_GATE.release()

    # If the shed path had released a permit it never held, the bounded semaphore
    # would already have raised ValueError above. Confirm capacity is exact.
    acquired = [main._CHAT_GATE.acquire(blocking=False) for _ in range(main.CHAT_MAX_CONCURRENCY)]
    extra = main._CHAT_GATE.acquire(blocking=False)
    for _ in range(sum(1 for ok in acquired if ok)):
        main._CHAT_GATE.release()
    if extra:
        main._CHAT_GATE.release()

    assert all(acquired)
    assert not extra, "gate capacity grew: a permit was released without being held"


def test_concurrent_burst_is_capped_at_gate_size(chat_user):
    """Verifies the point of the gate: in-flight turns never exceed the cap."""
    _uid, conversation_id = chat_user

    in_flight = 0
    peak = 0
    lock = threading.Lock()
    release = threading.Event()

    def slow_provider(*_args, **_kwargs):
        nonlocal in_flight, peak
        with lock:
            in_flight += 1
            peak = max(peak, in_flight)
        release.wait(timeout=5)
        with lock:
            in_flight -= 1
        return {
            "message": {"parts": [{"type": "text", "text": "hi"}]},
            "resolvedCost": 0.0,
            "usage": {},
        }

    total = main.CHAT_MAX_CONCURRENCY + 6
    statuses: list[int] = []
    status_lock = threading.Lock()

    def worker():
        response = _post(conversation_id)
        with status_lock:
            statuses.append(response.status_code)

    with mock.patch.object(main, "send_plain_chat", side_effect=slow_provider):
        threads = [threading.Thread(target=worker) for _ in range(total)]
        for t in threads:
            t.start()
        # Let the admitted requests pile up inside the provider call, then drain.
        threading.Event().wait(0.5)
        release.set()
        for t in threads:
            t.join(timeout=10)

    assert peak <= main.CHAT_MAX_CONCURRENCY, f"in-flight peaked at {peak}"
    assert statuses.count(503) > 0, "expected the excess requests to be shed"
    assert statuses.count(503) == total - statuses.count(200)
