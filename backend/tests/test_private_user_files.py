from __future__ import annotations

import base64
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.db.repositories import SecurityRepository
from app.db.session import session_scope
from app.main import _is_valid_generated_image_result, _prepare_input_image
from app.services.user_files import load_private_user_file, save_generated_output_for_owner


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
