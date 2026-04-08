from __future__ import annotations

from app.services import postgres_security_store as store


def test_credit_code_redeem_is_applied_once(test_db):
    store.ensure_user("user-1", "user@example.com", "User One")
    created = store.create_credit_code(credits=3, max_claims=1, created_by="user-1")

    first = store.redeem_credit_code(created["code"], "user-1")
    second = store.redeem_credit_code(created["code"], "user-1")
    profile = store.get_user("user-1")

    assert first["success"] is True
    assert first["balance"] == 3.0
    assert second["success"] is False
    assert "already used" in second["message"].lower()
    assert profile["credits"] == 3.0


def test_generation_reserve_then_capture_moves_credits_without_refund(test_db):
    store.ensure_user("user-2", "user2@example.com", "User Two")
    store.adjust_credits("user-2", 10.0, "seed", actor_uid="system", allow_negative=True)

    reservation = store.reserve_generation_credits(
        "user-2",
        "prompt",
        ["image"],
        {"image_model": "x"},
        estimated_cost=2.5,
    )
    profile_after_reserve = reservation["balance"]
    job_id = reservation["job"]["id"]

    captured = store.capture_generation_credits(job_id)
    profile_after_capture = captured["balance"]

    assert profile_after_reserve["credits"] == 7.5
    assert profile_after_reserve["reservedCredits"] == 2.5
    assert captured["job"]["status"] == "completed"
    assert captured["job"]["capturedCost"] == 2.5
    assert profile_after_capture["credits"] == 7.5
    assert profile_after_capture["reservedCredits"] == 0.0


def test_generation_release_returns_reserved_credits(test_db):
    store.ensure_user("user-3", "user3@example.com", "User Three")
    store.adjust_credits("user-3", 8.0, "seed", actor_uid="system", allow_negative=True)

    reservation = store.reserve_generation_credits(
        "user-3",
        "prompt",
        ["caption"],
        {"caption_model": "x"},
        estimated_cost=1.75,
    )
    job_id = reservation["job"]["id"]

    released = store.release_generation_credits(job_id, "provider_failed")
    profile = released["balance"]

    assert released["job"]["status"] == "failed"
    assert released["job"]["refundedCost"] == 1.75
    assert profile["credits"] == 8.0
    assert profile["reservedCredits"] == 0.0


def test_consume_rate_limit_blocks_after_max_count(test_db):
    key = "user:test-rate-limit"
    assert store.consume_rate_limit(key, max_count=2, window_seconds=60) is True
    assert store.consume_rate_limit(key, max_count=2, window_seconds=60) is True
    assert store.consume_rate_limit(key, max_count=2, window_seconds=60) is False
