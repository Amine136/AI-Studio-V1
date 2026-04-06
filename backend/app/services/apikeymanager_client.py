import base64
import json
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

import httpx

from app.config import settings

BASE_DIR = Path(__file__).resolve().parent.parent.parent
IMAGES_DIR = BASE_DIR / "generated_images"
IMAGES_DIR.mkdir(exist_ok=True)

IMAGEN_VALID_RATIOS = {"1:1", "3:4", "4:3", "9:16", "16:9"}


def _parse_aspect_ratio(raw: str) -> str:
    if not raw:
        return "1:1"
    clean = raw.split("(")[0].strip()
    return clean if ":" in clean else "1:1"


def _build_json_schema_prompt(prompt: str, response_schema: Any) -> str:
    schema_payload = response_schema.model_json_schema()
    schema_json = json.dumps(schema_payload, ensure_ascii=True, indent=2)
    return (
        f"{prompt}\n\n"
        "Return only valid JSON matching this schema exactly. "
        "Do not wrap the response in markdown fences.\n"
        f"{schema_json}"
    )


def _build_headers() -> Dict[str, str]:
    if not settings.apikeymanager_token:
        raise RuntimeError("APIKEYMANAGER_TOKEN is not configured")
    return {
        "Authorization": f"Bearer {settings.apikeymanager_token}",
        "Content-Type": "application/json",
    }


def _post_proxy(payload: Dict[str, Any]) -> Dict[str, Any]:
    url = f"{settings.apikeymanager_base_url}/api/v1/proxy"
    with httpx.Client(timeout=settings.apikeymanager_timeout) as client:
        response = client.post(url, json=payload, headers=_build_headers())
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = _extract_error_detail(exc.response)
            if exc.response.status_code == 413:
                raise ValueError(detail or "Uploaded image is too large for the current model request") from exc
            if exc.response.status_code == 403:
                raise ValueError(detail or "The selected model is not authorized on ApiKeyManager") from exc
            raise RuntimeError(detail or f"ApiKeyManager request failed with HTTP {exc.response.status_code}") from exc

    data = response.json()
    if data.get("status") != "success":
        raise RuntimeError(data.get("message") or data.get("error") or "ApiKeyManager request failed")
    return data


def fetch_model_catalog() -> Dict[str, Dict[str, Dict[str, Any]]]:
    url = f"{settings.apikeymanager_base_url}/api/v1/models/available"
    params = {"format": "catalog"}

    with httpx.Client(timeout=settings.apikeymanager_timeout) as client:
        response = client.get(url, params=params, headers=_build_headers())
        response.raise_for_status()

    data = response.json()
    if data.get("status") != "success":
        raise RuntimeError(data.get("message") or data.get("error") or "ApiKeyManager model catalog request failed")

    raw_catalog = data.get("data", {}).get("model_catalog")
    if not isinstance(raw_catalog, dict):
        raise RuntimeError("ApiKeyManager returned an invalid model catalog payload")

    return _normalize_model_catalog(raw_catalog)


def generate_text_via_proxy(
    provider: str,
    model_id: str,
    prompt: str,
    response_schema: Optional[Any] = None,
    input_image: Optional[Dict[str, str]] = None,
) -> str:
    prompt_text = _build_json_schema_prompt(prompt, response_schema) if response_schema else prompt
    payload = {
        "model": model_id,
        "provider": provider,
        "input": _build_input_parts(prompt_text, input_image),
    }
    data = _post_proxy(payload)
    outputs = data.get("data", {}).get("outputs") or {}
    return outputs.get("text") or data.get("data", {}).get("response") or ""


def generate_image_via_proxy(
    provider: str,
    model_id: str,
    prompt: str,
    image_config: Optional[Dict[str, Any]] = None,
    input_image: Optional[Dict[str, str]] = None,
) -> str:
    image_config = image_config or {}
    aspect_ratio = _parse_aspect_ratio(image_config.get("aspect_ratio", "1:1"))
    options: Dict[str, Any] = {}

    if provider == "google-imagen":
        if aspect_ratio not in IMAGEN_VALID_RATIOS:
            aspect_ratio = "1:1"
        options = {
            "aspectRatio": aspect_ratio,
            "sampleCount": 1,
            "outputMimeType": "image/jpeg",
        }
    elif provider == "google-gemini":
        options = {
            "responseModalities": ["TEXT", "IMAGE"],
            "aspectRatio": aspect_ratio,
            "imageSize": "1K",
        }

    payload = {
        "model": model_id,
        "provider": provider,
        "input": _build_input_parts(prompt, input_image),
        "options": options,
    }
    data = _post_proxy(payload)
    outputs = data.get("data", {}).get("outputs") or {}
    image_base64 = outputs.get("imageBase64") or data.get("data", {}).get("response")
    if not image_base64:
        raise RuntimeError("ApiKeyManager did not return image data")

    return _save_generated_image(image_base64)


def generate_text_and_image_via_proxy(
    provider: str,
    model_id: str,
    prompt: str,
    image_config: Optional[Dict[str, Any]] = None,
    input_image: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    image_config = image_config or {}
    aspect_ratio = _parse_aspect_ratio(image_config.get("aspect_ratio", "1:1"))
    options: Dict[str, Any] = {}

    if provider == "google-gemini":
        options = {
            "responseModalities": ["TEXT", "IMAGE"],
            "aspectRatio": aspect_ratio,
            "imageSize": "1K",
        }

    payload = {
        "model": model_id,
        "provider": provider,
        "input": _build_input_parts(prompt, input_image),
        "options": options,
    }
    data = _post_proxy(payload)
    outputs = data.get("data", {}).get("outputs") or {}
    image_base64 = outputs.get("imageBase64") or data.get("data", {}).get("response")
    text_output = outputs.get("text") or ""
    if not image_base64:
        raise RuntimeError("ApiKeyManager did not return image data")

    return {
        "image": _save_generated_image(image_base64),
        "text": text_output,
    }


def _build_input_parts(prompt: str, input_image: Optional[Dict[str, str]] = None) -> list[Dict[str, str]]:
    parts: list[Dict[str, str]] = []
    if input_image:
        image_url = input_image.get("url")
        if image_url:
            parts.append({"type": "image_url", "url": image_url})
        elif input_image.get("mime_type") and input_image.get("data"):
            parts.append(
                {
                    "type": "image",
                    "mimeType": input_image["mime_type"],
                    "data": input_image["data"],
                }
            )
    parts.append({"type": "text", "text": prompt})
    return parts


def _save_generated_image(image_base64: str) -> str:
    try:
        image_bytes = base64.b64decode(image_base64)
    except Exception as exc:
        raise RuntimeError("Invalid base64 image returned by ApiKeyManager") from exc

    extension = _detect_image_extension(image_bytes)
    filename = f"{uuid.uuid4()}.{extension}"
    save_path = IMAGES_DIR / filename
    with open(save_path, "wb") as image_file:
        image_file.write(image_bytes)

    return f"{settings.public_backend_base_url}/images/{filename}"


def _detect_image_extension(image_bytes: bytes) -> str:
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if image_bytes.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
        return "webp"
    return "png"


def _normalize_model_catalog(raw_catalog: Dict[str, Any]) -> Dict[str, Dict[str, Dict[str, Any]]]:
    normalized = {
        "caption": {},
        "image": {},
    }

    for model_name, model_config in (raw_catalog.get("text") or {}).items():
        normalized["caption"][model_name] = _normalize_model_entry(model_config)

    for model_name, model_config in (raw_catalog.get("image") or {}).items():
        normalized["image"][model_name] = _normalize_model_entry(model_config)

    for model_name, model_config in (raw_catalog.get("multimodal") or {}).items():
        entry = _normalize_model_entry(model_config)
        output_modalities = set(entry.get("output_modalities") or [])
        if "TEXT" in output_modalities:
            normalized["caption"][model_name] = entry
        if "IMAGE" in output_modalities:
            normalized["image"][model_name] = entry

    return normalized


def _normalize_model_entry(model_config: Dict[str, Any]) -> Dict[str, Any]:
    provider = model_config.get("provider")
    output_modalities = model_config.get("output_modalities") or []

    return {
        "provider": provider,
        "model_id": model_config.get("model_id") or model_config.get("name"),
        "display_name": model_config.get("display_name") or model_config.get("displayName"),
        "cost": _parse_cost(model_config.get("cost", 0)),
        "description": model_config.get("description", ""),
        "input_modalities": model_config.get("input_modalities") or model_config.get("inputModalities") or [],
        "output_modalities": output_modalities,
        "type": _infer_model_type(provider, output_modalities),
    }


def _parse_cost(raw_cost: Any) -> float:
    try:
        return float(raw_cost)
    except (TypeError, ValueError):
        return 0.0


def _infer_model_type(provider: Optional[str], output_modalities: list[str]) -> str:
    if "IMAGE" not in set(output_modalities or []):
        return ""
    if provider == "google-imagen":
        return "imagen"
    if provider == "google-gemini":
        return "gemini-image"
    return ""


def _extract_error_detail(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except Exception:
        return response.text.strip()

    if isinstance(payload, dict):
        data = payload.get("data")
        return (
            payload.get("message")
            or payload.get("error")
            or (data.get("message") if isinstance(data, dict) else None)
            or (data.get("error") if isinstance(data, dict) else None)
            or ""
        )
    return ""
