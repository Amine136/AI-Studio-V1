import base64
import json
from pathlib import Path
from typing import Any, Dict, Optional

import httpx

from app.config import settings
from app.services.user_files import privatize_generated_image_url, save_generated_output_base64_for_owner

BASE_DIR = Path(__file__).resolve().parent.parent.parent
IMAGES_DIR = BASE_DIR / "generated_images"
IMAGES_DIR.mkdir(exist_ok=True)

IMAGEN_VALID_RATIOS = {"1:1", "3:4", "4:3", "9:16", "16:9"}
RETRYABLE_APIKEYMANAGER_ERROR_TYPES = {"timeout", "network_error", "provider_internal_error"}


class ApiKeyManagerProxyError(RuntimeError):
    def __init__(
        self,
        *,
        error_type: str,
        code: str,
        message: str,
        retryable: bool,
        provider: str | None = None,
        upstream_status: int | None = None,
        http_status: int | None = None,
    ) -> None:
        super().__init__(message)
        self.error_type = error_type
        self.code = code
        self.message = message
        self.retryable = retryable
        self.provider = provider
        self.upstream_status = upstream_status
        self.http_status = http_status

    def to_metadata(self) -> dict[str, Any]:
        return {
            "error_type": self.error_type,
            "error_code": self.code,
            "retryable": self.retryable,
            "provider": self.provider,
            "upstream_status": self.upstream_status,
            "http_status": self.http_status,
            "message": self.message,
        }


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


def _post_apikeymanager(path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    url = f"{settings.apikeymanager_base_url}{path}"
    last_error: ApiKeyManagerProxyError | None = None

    for attempt in range(2):
        try:
            with httpx.Client(timeout=settings.apikeymanager_timeout) as client:
                response = client.post(url, json=payload, headers=_build_headers())
        except httpx.TimeoutException as exc:
            last_error = ApiKeyManagerProxyError(
                error_type="timeout",
                code="PROVIDER_TIMEOUT",
                message="Provider request timed out",
                retryable=True,
            )
            if attempt == 0:
                continue
            raise last_error from exc
        except httpx.RequestError as exc:
            last_error = ApiKeyManagerProxyError(
                error_type="network_error",
                code="PROVIDER_NETWORK_ERROR",
                message="Provider network request failed",
                retryable=True,
            )
            if attempt == 0:
                continue
            raise last_error from exc

        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            proxy_error = _build_proxy_error(exc.response)
            if attempt == 0 and proxy_error.retryable and proxy_error.error_type in RETRYABLE_APIKEYMANAGER_ERROR_TYPES:
                last_error = proxy_error
                continue
            raise proxy_error from exc

        data = response.json()
        if data.get("status") != "success":
            proxy_error = _build_proxy_error(response, payload=data)
            if attempt == 0 and proxy_error.retryable and proxy_error.error_type in RETRYABLE_APIKEYMANAGER_ERROR_TYPES:
                last_error = proxy_error
                continue
            raise proxy_error
        return data

    if last_error is not None:
        raise last_error
    raise ApiKeyManagerProxyError(
        error_type="provider_internal_error",
        code="PROVIDER_REQUEST_FAILED",
        message="ApiKeyManager request failed",
        retryable=False,
    )


def _post_proxy(payload: Dict[str, Any]) -> Dict[str, Any]:
    return _post_apikeymanager("/api/v1/proxy", payload)


def _post_chat(payload: Dict[str, Any]) -> Dict[str, Any]:
    return _post_apikeymanager("/api/v1/chat", payload)


def check_apikeymanager_ready() -> dict[str, Any]:
    url = f"{settings.apikeymanager_base_url}/health/ready"
    try:
        with httpx.Client(timeout=min(settings.apikeymanager_timeout, 10.0)) as client:
            response = client.get(url, headers=_build_headers())
            response.raise_for_status()
    except httpx.TimeoutException as exc:
        raise ApiKeyManagerProxyError(
            error_type="timeout",
            code="APIKEYMANAGER_READY_TIMEOUT",
            message="ApiKeyManager readiness check timed out",
            retryable=True,
        ) from exc
    except httpx.RequestError as exc:
        raise ApiKeyManagerProxyError(
            error_type="network_error",
            code="APIKEYMANAGER_READY_NETWORK_ERROR",
            message="ApiKeyManager readiness check failed",
            retryable=True,
        ) from exc
    except httpx.HTTPStatusError as exc:
        raise _build_proxy_error(exc.response) from exc

    payload = response.json()
    status = str(payload.get("status") or "").lower()
    if status not in {"ok", "ready", "success"}:
        raise _build_proxy_error(response, payload=payload)
    return payload


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
    input_images: Optional[list[Dict[str, str]]] = None,
    options: Optional[Dict[str, Any]] = None,
) -> str:
    prompt_text = _build_json_schema_prompt(prompt, response_schema) if response_schema else prompt
    payload = {
        "model": model_id,
        "provider": provider,
        "input": _build_input_parts(prompt_text, input_image=input_image, input_images=input_images),
    }
    if options:
        payload["options"] = options
    data = _post_proxy(payload)
    outputs = data.get("data", {}).get("outputs") or {}
    return outputs.get("text") or data.get("data", {}).get("response") or ""


def generate_text_payload_via_proxy(
    provider: str,
    model_id: str,
    prompt: str,
    response_schema: Optional[Any] = None,
    input_image: Optional[Dict[str, str]] = None,
    input_images: Optional[list[Dict[str, str]]] = None,
    options: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    prompt_text = _build_json_schema_prompt(prompt, response_schema) if response_schema else prompt
    payload = {
        "model": model_id,
        "provider": provider,
        "input": _build_input_parts(prompt_text, input_image=input_image, input_images=input_images),
    }
    if options:
        payload["options"] = options
    data = _post_proxy(payload)
    response_data = data.get("data", {}) or {}
    outputs = response_data.get("outputs") or {}
    return {
        "text": outputs.get("text") or response_data.get("response") or "",
        "usage": response_data.get("usage") or {},
        "billingMode": response_data.get("billingMode"),
        "resolvedCost": response_data.get("resolvedCost"),
        "billing": response_data.get("billing") or {},
        "provider": response_data.get("provider"),
        "model": response_data.get("model"),
        "meta": data.get("meta") or {},
    }


def generate_chat_via_proxy(payload: Dict[str, Any], *, owner_uid: str) -> Dict[str, Any]:
    data = _post_chat(payload)
    response_data = data.get("data", {}) or {}
    message = response_data.get("message")
    if isinstance(message, dict):
        parts = message.get("parts")
        if isinstance(parts, list):
            normalized_parts: list[dict[str, Any]] = []
            for part in parts:
                if not isinstance(part, dict):
                    continue
                if str(part.get("type") or "") == "image_url":
                    image_url = str(part.get("url") or "").strip()
                    normalized_parts.append({
                        **part,
                        "url": privatize_generated_image_url(owner_uid, image_url) if image_url else image_url,
                    })
                    continue
                normalized_parts.append(part)
            response_data["message"] = {
                **message,
                "parts": normalized_parts,
            }
    return response_data


def generate_image_via_proxy(
    provider: str,
    model_id: str,
    prompt: str,
    *,
    owner_uid: str,
    image_config: Optional[Dict[str, Any]] = None,
    input_image: Optional[Dict[str, str]] = None,
    input_images: Optional[list[Dict[str, str]]] = None,
    options: Optional[Dict[str, Any]] = None,
) -> str:
    image_config = image_config or {}
    aspect_ratio = _parse_aspect_ratio(image_config.get("aspect_ratio", "1:1"))
    resolved_options: Dict[str, Any] = {}

    if provider == "google-imagen":
        if aspect_ratio not in IMAGEN_VALID_RATIOS:
            aspect_ratio = "1:1"
        resolved_options = {
            "aspectRatio": aspect_ratio,
            "sampleCount": 1,
            "outputMimeType": "image/jpeg",
        }
    elif provider == "google-gemini":
        resolved_options = {
            "responseModalities": ["IMAGE"],
            "aspectRatio": aspect_ratio,
            "imageSize": "1K",
        }
    elif provider == "openai":
        resolved_options = {
            "responseModalities": ["IMAGE"],
        }
    if options:
        resolved_options.update(options)

    payload = {
        "model": model_id,
        "provider": provider,
        "input": _build_input_parts(prompt, input_image=input_image, input_images=input_images),
        "options": resolved_options,
    }
    data = _post_proxy(payload)
    response_data = data.get("data", {}) or {}
    outputs = response_data.get("outputs") or {}
    image_url = outputs.get("imageUrl")
    if isinstance(image_url, str) and image_url.strip():
        return privatize_generated_image_url(owner_uid, image_url)

    image_base64 = outputs.get("imageBase64") or response_data.get("response")
    if not image_base64:
        raise RuntimeError("ApiKeyManager did not return image data")

    return save_generated_output_base64_for_owner(owner_uid, image_base64)


def generate_image_payload_via_proxy(
    provider: str,
    model_id: str,
    prompt: str,
    *,
    owner_uid: str,
    image_config: Optional[Dict[str, Any]] = None,
    input_image: Optional[Dict[str, str]] = None,
    input_images: Optional[list[Dict[str, str]]] = None,
    options: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    image_config = image_config or {}
    aspect_ratio = _parse_aspect_ratio(image_config.get("aspect_ratio", "1:1"))
    resolved_options: Dict[str, Any] = {}

    if provider == "google-imagen":
        if aspect_ratio not in IMAGEN_VALID_RATIOS:
            aspect_ratio = "1:1"
        resolved_options = {
            "aspectRatio": aspect_ratio,
            "sampleCount": 1,
            "outputMimeType": "image/jpeg",
        }
    elif provider == "google-gemini":
        resolved_options = {
            "responseModalities": ["IMAGE"],
            "aspectRatio": aspect_ratio,
            "imageSize": "1K",
        }
    elif provider == "openai":
        resolved_options = {
            "responseModalities": ["IMAGE"],
        }
    if options:
        resolved_options.update(options)

    payload = {
        "model": model_id,
        "provider": provider,
        "input": _build_input_parts(prompt, input_image=input_image, input_images=input_images),
        "options": resolved_options,
    }
    data = _post_proxy(payload)
    response_data = data.get("data", {}) or {}
    outputs = response_data.get("outputs") or {}
    image_url = outputs.get("imageUrl")
    if isinstance(image_url, str) and image_url.strip():
        resolved_image = privatize_generated_image_url(owner_uid, image_url)
    else:
        image_base64 = outputs.get("imageBase64") or response_data.get("response")
        if not image_base64:
            raise RuntimeError("ApiKeyManager did not return image data")
        resolved_image = save_generated_output_base64_for_owner(owner_uid, image_base64)

    return {
        "image": resolved_image,
        "text": outputs.get("text") or "",
        "usage": response_data.get("usage") or {},
        "billingMode": response_data.get("billingMode"),
        "resolvedCost": response_data.get("resolvedCost"),
        "billing": response_data.get("billing") or {},
        "provider": response_data.get("provider"),
        "model": response_data.get("model"),
        "meta": data.get("meta") or {},
    }


def generate_text_and_image_via_proxy(
    provider: str,
    model_id: str,
    prompt: str,
    *,
    owner_uid: str,
    image_config: Optional[Dict[str, Any]] = None,
    input_image: Optional[Dict[str, str]] = None,
    input_images: Optional[list[Dict[str, str]]] = None,
    options: Optional[Dict[str, Any]] = None,
) -> Dict[str, str]:
    image_config = image_config or {}
    aspect_ratio = _parse_aspect_ratio(image_config.get("aspect_ratio", "1:1"))
    resolved_options: Dict[str, Any] = {}

    if provider == "google-gemini":
        resolved_options = {
            "responseModalities": ["TEXT", "IMAGE"],
            "aspectRatio": aspect_ratio,
            "imageSize": "1K",
        }
    if options:
        resolved_options.update(options)

    payload = {
        "model": model_id,
        "provider": provider,
        "input": _build_input_parts(prompt, input_image=input_image, input_images=input_images),
        "options": resolved_options,
    }
    data = _post_proxy(payload)
    response_data = data.get("data", {}) or {}
    outputs = response_data.get("outputs") or {}
    image_url = outputs.get("imageUrl")
    if isinstance(image_url, str) and image_url.strip():
        resolved_image = privatize_generated_image_url(owner_uid, image_url)
    else:
        image_base64 = outputs.get("imageBase64") or response_data.get("response")
        if not image_base64:
            raise RuntimeError("ApiKeyManager did not return image data")
        resolved_image = save_generated_output_base64_for_owner(owner_uid, image_base64)
    text_output = outputs.get("text") or ""

    return {
        "image": resolved_image,
        "text": text_output,
    }


def generate_text_and_image_payload_via_proxy(
    provider: str,
    model_id: str,
    prompt: str,
    *,
    owner_uid: str,
    image_config: Optional[Dict[str, Any]] = None,
    input_image: Optional[Dict[str, str]] = None,
    input_images: Optional[list[Dict[str, str]]] = None,
    options: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    image_config = image_config or {}
    aspect_ratio = _parse_aspect_ratio(image_config.get("aspect_ratio", "1:1"))
    resolved_options: Dict[str, Any] = {}

    if provider == "google-gemini":
        resolved_options = {
            "responseModalities": ["TEXT", "IMAGE"],
            "aspectRatio": aspect_ratio,
            "imageSize": "1K",
        }
    if options:
        resolved_options.update(options)

    payload = {
        "model": model_id,
        "provider": provider,
        "input": _build_input_parts(prompt, input_image=input_image, input_images=input_images),
        "options": resolved_options,
    }
    data = _post_proxy(payload)
    response_data = data.get("data", {}) or {}
    outputs = response_data.get("outputs") or {}
    image_url = outputs.get("imageUrl")
    if isinstance(image_url, str) and image_url.strip():
        resolved_image = privatize_generated_image_url(owner_uid, image_url)
    else:
        image_base64 = outputs.get("imageBase64") or response_data.get("response")
        if not image_base64:
            raise RuntimeError("ApiKeyManager did not return image data")
        resolved_image = save_generated_output_base64_for_owner(owner_uid, image_base64)

    return {
        "image": resolved_image,
        "text": outputs.get("text") or "",
        "usage": response_data.get("usage") or {},
        "billingMode": response_data.get("billingMode"),
        "resolvedCost": response_data.get("resolvedCost"),
        "billing": response_data.get("billing") or {},
        "provider": response_data.get("provider"),
        "model": response_data.get("model"),
        "meta": data.get("meta") or {},
    }


def _build_input_parts(
    prompt: str,
    input_image: Optional[Dict[str, str]] = None,
    input_images: Optional[list[Dict[str, str]]] = None,
) -> list[Dict[str, str]]:
    parts: list[Dict[str, str]] = []
    for image in (input_images if input_images is not None else ([input_image] if input_image else [])):
        image_url = image.get("url")
        if image_url:
            parts.append({"type": "image_url", "url": image_url})
        elif image.get("data"):
            parts.append(
                {
                    "type": "image",
                    "mimeType": image.get("mime_type") or "image/jpeg",
                    "data": image["data"],
                }
            )
    parts.append({"type": "text", "text": prompt})
    return parts

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
        "billing": model_config.get("billing") if isinstance(model_config.get("billing"), dict) else None,
        "description": model_config.get("description", ""),
        "input_modalities": model_config.get("input_modalities") or model_config.get("inputModalities") or [],
        "output_modalities": output_modalities,
        "type": _infer_model_type(provider, output_modalities),
    }


def _infer_model_type(provider: Optional[str], output_modalities: list[str]) -> str:
    if "IMAGE" not in set(output_modalities or []):
        return ""
    if provider == "google-imagen":
        return "imagen"
    if provider == "google-gemini":
        return "gemini-image"
    if provider == "ideogram":
        return "ideogram"
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


def _build_proxy_error(response: httpx.Response, payload: dict[str, Any] | None = None) -> ApiKeyManagerProxyError:
    payload = payload or _safe_json(response)
    error_payload = payload.get("error") if isinstance(payload, dict) else {}
    error_payload = error_payload if isinstance(error_payload, dict) else {}

    message = (
        error_payload.get("message")
        or (payload.get("message") if isinstance(payload, dict) else None)
        or _extract_error_detail(response)
        or f"ApiKeyManager request failed with HTTP {response.status_code}"
    )
    error_type = str(error_payload.get("type") or _fallback_error_type_for_status(response.status_code))
    code = str(error_payload.get("code") or _fallback_error_code_for_type(error_type))
    retryable = bool(error_payload.get("retryable")) if "retryable" in error_payload else error_type in RETRYABLE_APIKEYMANAGER_ERROR_TYPES
    provider = error_payload.get("provider")
    upstream_status = error_payload.get("upstreamStatus")
    try:
        upstream_status = int(upstream_status) if upstream_status is not None else None
    except (TypeError, ValueError):
        upstream_status = None

    return ApiKeyManagerProxyError(
        error_type=error_type,
        code=code,
        message=str(message),
        retryable=retryable,
        provider=str(provider) if provider else None,
        upstream_status=upstream_status,
        http_status=int(response.status_code),
    )


def _safe_json(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _fallback_error_type_for_status(status_code: int) -> str:
    if status_code == 400:
        return "bad_request"
    if status_code in {401, 403}:
        return "auth_error"
    if status_code == 408:
        return "timeout"
    if status_code == 429:
        return "rate_limit"
    if 500 <= status_code <= 599:
        return "provider_internal_error"
    return "provider_internal_error"


def _fallback_error_code_for_type(error_type: str) -> str:
    mapping = {
        "timeout": "PROVIDER_TIMEOUT",
        "network_error": "PROVIDER_NETWORK_ERROR",
        "provider_internal_error": "PROVIDER_INTERNAL_ERROR",
        "invalid_output": "PROVIDER_INVALID_OUTPUT",
        "rate_limit": "PROVIDER_RATE_LIMIT",
        "auth_error": "PROVIDER_AUTH_ERROR",
        "bad_request": "PROVIDER_BAD_REQUEST",
    }
    return mapping.get(error_type, "PROVIDER_REQUEST_FAILED")
