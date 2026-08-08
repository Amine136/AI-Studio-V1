from __future__ import annotations

import base64
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.db.repositories import SecurityRepository
from app.db.session import session_scope
from app.main import _is_valid_generated_image_result, _prepare_input_image, _prepare_input_images
from app.services.user_files import (
    _normalize_apikeymanager_generated_image_url,
    load_private_user_file,
    save_generated_output_for_owner,
)


def test_local_akm_generated_image_url_uses_public_gateway(monkeypatch):
    monkeypatch.setattr(
        "app.services.user_files.settings.apikeymanager_public_base_url",
        "https://akm.example.test",
    )

    assert _normalize_apikeymanager_generated_image_url(
        "http://127.0.0.1:3000/generated-images/123e4567-e89b-12d3-a456-426614174000.png"
    ) == "https://akm.example.test/generated-images/123e4567-e89b-12d3-a456-426614174000.png"


def test_prepare_input_image_reads_private_uploaded_file(test_db, monkeypatch, tmp_path):
    upload_dir = tmp_path / "uploaded_images"
    upload_dir.mkdir()
    filename = "a" * 32 + ".png"
    image_bytes = b"\x89PNG\r\n\x1a\nprivate-image"
    (upload_dir / filename).write_bytes(image_bytes)
    monkeypatch.setattr("app.main.UPLOADED_IMAGES_DIR", upload_dir)
    monkeypatch.setattr("app.services.user_files.UPLOADED_IMAGES_DIR", upload_dir)

    with session_scope() as db:
        repo = SecurityRepository(db)
        repo.ensure_user("user-1", "user@example.com", "User One")
        file_entry = repo.create_user_file(
            owner_uid="user-1",
            storage_path=filename,
            kind="uploaded_input",
            mime_type="image/png",
            file_id="123e4567-e89b-12d3-a456-426614174000",
        )

    payload = SimpleNamespace(
        file_id=str(file_entry.id),
        url=f"https://testvibecraft.ouni.space/api/files/{file_entry.id}",
        mime_type="image/png",
    )
    resolved = _prepare_input_image(payload, "user-1")

    assert resolved == {
        "mime_type": "image/png",
        "data": base64.b64encode(image_bytes).decode("ascii"),
    }


def test_prepare_input_images_reads_multiple_private_uploaded_files(test_db, monkeypatch, tmp_path):
    upload_dir = tmp_path / "uploaded_images"
    upload_dir.mkdir()
    first_filename = "c" * 32 + ".png"
    second_filename = "d" * 32 + ".webp"
    first_bytes = b"\x89PNG\r\n\x1a\nfirst"
    second_bytes = b"RIFFxxxxWEBPsecond"
    (upload_dir / first_filename).write_bytes(first_bytes)
    (upload_dir / second_filename).write_bytes(second_bytes)
    monkeypatch.setattr("app.main.UPLOADED_IMAGES_DIR", upload_dir)
    monkeypatch.setattr("app.services.user_files.UPLOADED_IMAGES_DIR", upload_dir)

    with session_scope() as db:
        repo = SecurityRepository(db)
        repo.ensure_user("multi-user", "multi@example.com", "Multi User")
        first_entry = repo.create_user_file(
            owner_uid="multi-user",
            storage_path=first_filename,
            kind="uploaded_input",
            mime_type="image/png",
            file_id="323e4567-e89b-12d3-a456-426614174000",
        )
        second_entry = repo.create_user_file(
            owner_uid="multi-user",
            storage_path=second_filename,
            kind="uploaded_input",
            mime_type="image/webp",
            file_id="423e4567-e89b-12d3-a456-426614174000",
        )

    payloads = [
        SimpleNamespace(file_id=str(first_entry.id), url=None, mime_type="image/png"),
        SimpleNamespace(file_id=str(second_entry.id), url=None, mime_type="image/webp"),
    ]

    resolved = _prepare_input_images(payloads, "multi-user")

    assert resolved == [
        {"mime_type": "image/png", "data": base64.b64encode(first_bytes).decode("ascii")},
        {"mime_type": "image/webp", "data": base64.b64encode(second_bytes).decode("ascii")},
    ]


def test_private_uploaded_file_is_owner_scoped(test_db, monkeypatch, tmp_path):
    upload_dir = tmp_path / "uploaded_images"
    upload_dir.mkdir()
    filename = "b" * 32 + ".webp"
    (upload_dir / filename).write_bytes(b"RIFFxxxxWEBPprivate")
    monkeypatch.setattr("app.main.UPLOADED_IMAGES_DIR", upload_dir)
    monkeypatch.setattr("app.services.user_files.UPLOADED_IMAGES_DIR", upload_dir)

    with session_scope() as db:
        repo = SecurityRepository(db)
        repo.ensure_user("owner-1", "owner@example.com", "Owner")
        repo.ensure_user("other-1", "other@example.com", "Other")
        repo.create_user_file(
            owner_uid="owner-1",
            storage_path=filename,
            kind="uploaded_input",
            mime_type="image/webp",
            file_id="223e4567-e89b-12d3-a456-426614174000",
        )

    with pytest.raises(HTTPException) as exc_info:
        load_private_user_file("223e4567-e89b-12d3-a456-426614174000", "other-1")

    assert exc_info.value.status_code == 404


def test_generated_output_private_file_is_owner_scoped(test_db, monkeypatch, tmp_path):
    generated_dir = tmp_path / "generated_images"
    generated_dir.mkdir()
    monkeypatch.setattr("app.services.user_files.GENERATED_IMAGES_DIR", generated_dir)

    with session_scope() as db:
        repo = SecurityRepository(db)
        repo.ensure_user("owner-2", "owner2@example.com", "Owner Two")
        repo.ensure_user("other-2", "other2@example.com", "Other Two")

    private_url = save_generated_output_for_owner("owner-2", b"\x89PNG\r\n\x1a\nprivate-generated")
    assert _is_valid_generated_image_result(private_url) is True

    with pytest.raises(HTTPException) as exc_info:
        load_private_user_file(private_url.rsplit("/", 1)[-1], "other-2")

    assert exc_info.value.status_code == 404
