from __future__ import annotations

import base64
import re
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

from app.config import settings
from app.db.repositories.security import SecurityRepository
from app.db.session import session_scope

BASE_DIR = Path(__file__).resolve().parent.parent.parent
GENERATED_IMAGES_DIR = BASE_DIR / "generated_images"
UPLOADED_IMAGES_DIR = BASE_DIR / "uploaded_images"
APIKEYMANAGER_GENERATED_IMAGE_DIRS = (
    Path("/var/lib/apikeymanager/generated-images"),
    Path("/var/www/apikeymanager/backend/generated_images"),
    BASE_DIR.parent / "ApiKeyManager" / "generated_images",
    BASE_DIR.parent / "ApiKeyManager" / "backend" / "generated_images",
)

GENERATED_IMAGES_DIR.mkdir(exist_ok=True)
UPLOADED_IMAGES_DIR.mkdir(exist_ok=True)

SAFE_GENERATED_FILENAME = re.compile(r"^[a-f0-9\-]{36}\.(jpg|png|webp)$")
SAFE_UPLOADED_FILENAME = re.compile(r"^[a-f0-9]{32}\.(jpg|png|webp)$")
SAFE_FILE_ID = re.compile(r"^[0-9a-f\-]{36}$")

PRIVATE_FILE_KINDS = {"uploaded_input", "generated_output"}


def private_file_url_prefix() -> str:
    return f"{settings.public_backend_base_url}/api/files/"


def private_file_url(file_id: str) -> str:
    return f"{private_file_url_prefix()}{file_id}"


def generated_image_url_prefixes() -> list[str]:
    prefixes: list[str] = ["/images/", "/generated-images/"]
    if settings.public_backend_base_url:
        prefixes.append(f"{settings.public_backend_base_url}/images/")
        prefixes.append(f"{settings.public_backend_base_url}/generated-images/")
    if settings.apikeymanager_public_base_url:
        prefixes.append(f"{settings.apikeymanager_public_base_url}/generated-images/")
    return prefixes


def save_generated_output_for_owner(owner_uid: str, image_bytes: bytes) -> str:
    extension, mime_type = _detect_image_extension_and_mime(image_bytes)
    filename = f"{uuid.uuid4()}.{extension}"
    save_path = GENERATED_IMAGES_DIR / filename
    save_path.write_bytes(image_bytes)
    file_id = _create_user_file_record(
        owner_uid=owner_uid,
        storage_path=filename,
        kind="generated_output",
        mime_type=mime_type,
    )
    return private_file_url(file_id)


def save_generated_output_base64_for_owner(owner_uid: str, image_base64: str) -> str:
    try:
        image_bytes = base64.b64decode(image_base64)
    except Exception as exc:
        raise RuntimeError("Invalid base64 image returned by ApiKeyManager") from exc
    return save_generated_output_for_owner(owner_uid, image_bytes)


def privatize_generated_image_url(owner_uid: str, image_url: str) -> str:
    normalized_url = str(image_url or "").strip()
    if not normalized_url:
        raise RuntimeError("Generated image URL was empty")

    existing_file_id = private_file_id_from_url(normalized_url)
    if existing_file_id:
        load_private_user_file(existing_file_id, owner_uid)
        return normalized_url

    image_path = _resolve_generated_image_path(normalized_url)
    if image_path is not None and image_path.exists():
        return save_generated_output_for_owner(owner_uid, image_path.read_bytes())

    downloaded_bytes = _download_generated_image_bytes(normalized_url)
    if downloaded_bytes:
        return save_generated_output_for_owner(owner_uid, downloaded_bytes)

    raise RuntimeError("Generated image file was not found")


def private_file_id_from_url(image_url: str) -> str | None:
    if not str(image_url or "").startswith(private_file_url_prefix()):
        return None
    file_id = Path(urlparse(image_url).path).name
    if not SAFE_FILE_ID.match(file_id):
        return None
    return file_id


def load_private_user_file(
    file_id: str,
    owner_uid: str,
    *,
    allowed_kinds: set[str] | None = None,
) -> tuple[dict[str, Any], Path]:
    if not SAFE_FILE_ID.match(file_id):
        raise HTTPException(status_code=400, detail="Invalid file id")

    kinds = allowed_kinds or PRIVATE_FILE_KINDS
    with session_scope() as session:
        repo = SecurityRepository(session)
        entry = repo.get_user_file_for_owner(file_id, owner_uid)
        if entry is None or str(entry.kind) not in kinds:
            raise HTTPException(status_code=404, detail="File not found")
        filepath = _filepath_for_record(str(entry.kind), str(entry.storage_path))
        if not filepath.exists():
            repo.delete_user_file(entry)
            raise HTTPException(status_code=404, detail="File not found")
        return {
            "id": str(entry.id),
            "owner_uid": str(entry.owner_uid),
            "storage_path": str(entry.storage_path),
            "kind": str(entry.kind),
            "mime_type": str(entry.mime_type),
            "created_at": int(entry.created_at),
        }, filepath


def get_private_user_file_record(file_id: str) -> dict[str, Any] | None:
    if not SAFE_FILE_ID.match(file_id):
        return None
    with session_scope() as session:
        repo = SecurityRepository(session)
        entry = repo.get_user_file(file_id)
        if entry is None:
            return None
        return {
            "id": str(entry.id),
            "owner_uid": str(entry.owner_uid),
            "storage_path": str(entry.storage_path),
            "kind": str(entry.kind),
            "mime_type": str(entry.mime_type),
            "created_at": int(entry.created_at),
        }


def delete_private_user_file_by_id(file_id: str) -> None:
    if not SAFE_FILE_ID.match(file_id):
        return
    with session_scope() as session:
        repo = SecurityRepository(session)
        entry = repo.get_user_file(file_id)
        if entry is None:
            return
        filepath = _filepath_for_record(str(entry.kind), str(entry.storage_path))
        try:
            filepath.unlink(missing_ok=True)
        except OSError:
            pass
        repo.delete_user_file(entry)


def create_uploaded_user_file_record(owner_uid: str, filename: str, mime_type: str) -> str:
    return _create_user_file_record(
        owner_uid=owner_uid,
        storage_path=filename,
        kind="uploaded_input",
        mime_type=mime_type,
    )


def _create_user_file_record(*, owner_uid: str, storage_path: str, kind: str, mime_type: str) -> str:
    with session_scope() as session:
        repo = SecurityRepository(session)
        entry = repo.create_user_file(
            owner_uid=owner_uid,
            storage_path=storage_path,
            kind=kind,
            mime_type=mime_type,
        )
        return str(entry.id)


def _resolve_generated_image_path(image_url: str) -> Path | None:
    parsed = urlparse(image_url)
    filename = Path(parsed.path).name
    if not SAFE_GENERATED_FILENAME.match(filename):
        return None

    for prefix in generated_image_url_prefixes():
        if image_url.startswith(prefix):
            for directory in (GENERATED_IMAGES_DIR, *APIKEYMANAGER_GENERATED_IMAGE_DIRS):
                candidate = directory / filename
                if candidate.exists():
                    return candidate
    return None


def _download_generated_image_bytes(image_url: str) -> bytes | None:
    if not any(image_url.startswith(prefix) for prefix in generated_image_url_prefixes()):
        return None
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(image_url)
            response.raise_for_status()
            return response.content
    except Exception:
        return None


def _filepath_for_record(kind: str, storage_path: str) -> Path:
    if kind == "uploaded_input":
        return UPLOADED_IMAGES_DIR / storage_path
    if kind == "generated_output":
        return GENERATED_IMAGES_DIR / storage_path
    raise HTTPException(status_code=404, detail="File not found")


def _detect_image_extension_and_mime(image_bytes: bytes) -> tuple[str, str]:
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", "image/png"
    if image_bytes.startswith(b"\xff\xd8\xff"):
        return "jpg", "image/jpeg"
    if image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
        return "webp", "image/webp"
    return "png", "image/png"
