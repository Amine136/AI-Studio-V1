from __future__ import annotations

import json
import os
from threading import Lock
from typing import Any, Dict

from app.config import settings

_VISIBILITY_PATH = settings.DATA_DIR / "model_visibility.json"
_LOCK = Lock()


def _empty_config() -> dict[str, Any]:
    return {"disabled_models": [], "disabled_providers": []}


def _normalize_model_id(value: Any) -> str:
    return str(value or "").strip()


def _normalize_provider(value: Any) -> str:
    return str(value or "").strip().lower()


def _model_provider(model_entry: Any) -> str:
    if not isinstance(model_entry, dict):
        return ""
    return _normalize_provider(model_entry.get("provider"))


def _load_config_unlocked() -> dict[str, Any]:
    if not _VISIBILITY_PATH.exists():
        return _empty_config()
    try:
        with open(_VISIBILITY_PATH, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except Exception:
        return _empty_config()
    if not isinstance(payload, dict):
        return _empty_config()

    disabled_models = payload.get("disabled_models")
    if not isinstance(disabled_models, list):
        disabled_models = []

    disabled_providers = payload.get("disabled_providers")
    if not isinstance(disabled_providers, list):
        disabled_providers = []

    return {
        "disabled_models": sorted({
            _normalize_model_id(item)
            for item in disabled_models
            if _normalize_model_id(item)
        }),
        "disabled_providers": sorted({
            _normalize_provider(item)
            for item in disabled_providers
            if _normalize_provider(item)
        }),
    }


def _write_config_unlocked(payload: dict[str, Any]) -> None:
    _VISIBILITY_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = _VISIBILITY_PATH.with_suffix(_VISIBILITY_PATH.suffix + ".tmp")
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=True, indent=2, sort_keys=True)
        handle.write("\n")
    os.replace(tmp_path, _VISIBILITY_PATH)


def get_disabled_model_ids() -> set[str]:
    with _LOCK:
        return set(_load_config_unlocked()["disabled_models"])


def get_disabled_provider_ids() -> set[str]:
    with _LOCK:
        return set(_load_config_unlocked()["disabled_providers"])


def is_model_enabled(model_id: str, model_entry: dict[str, Any] | None = None) -> bool:
    normalized = _normalize_model_id(model_id)
    if not normalized:
        return False
    with _LOCK:
        config = _load_config_unlocked()
    if normalized in set(config["disabled_models"]):
        return False
    provider = _model_provider(model_entry)
    if provider and provider in set(config["disabled_providers"]):
        return False
    return True


def visible_model_catalog() -> Dict[str, Dict[str, Dict[str, Any]]]:
    """The live model catalog with admin-disabled models/providers removed. This is
    the catalog every model SELECTION and VALIDATION path must read, so a disabled
    model is both hidden from the UI and refused at generation time. The raw
    ``settings.model_catalog`` is only for pricing/parameter lookups of a model that
    has already been resolved through this view."""
    # Source the CANONICAL catalog (the same one /config serves), not
    # settings.model_catalog directly: the latter is set from a startup AKM fetch and
    # is only reconciled to the live catalog as a side effect of get_catalog(), so
    # reading it directly can be stale/ordering-dependent and would wrongly reject a
    # legitimately-available model at the /generate validators.
    from app.services.catalog_store import catalog_store
    return filter_catalog(catalog_store.get_catalog())


def visible_image_models() -> Dict[str, Dict[str, Any]]:
    """Convenience view: just the enabled image models."""
    return visible_model_catalog().get("image", {}) or {}


def filter_catalog(catalog: Dict[str, Dict[str, Dict[str, Any]]]) -> Dict[str, Dict[str, Dict[str, Any]]]:
    with _LOCK:
        config = _load_config_unlocked()
    disabled_models = set(config["disabled_models"])
    disabled_providers = set(config["disabled_providers"])
    filtered: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for task, models in (catalog or {}).items():
        if not isinstance(models, dict):
            continue
        filtered[task] = {
            model_id: model_entry
            for model_id, model_entry in models.items()
            if _normalize_model_id(model_id) not in disabled_models
            and _model_provider(model_entry) not in disabled_providers
        }
    return filtered


def list_model_visibility(catalog: Dict[str, Dict[str, Dict[str, Any]]]) -> dict[str, Any]:
    with _LOCK:
        config = _load_config_unlocked()
    disabled_models = set(config["disabled_models"])
    disabled_providers = set(config["disabled_providers"])
    tasks: list[dict[str, Any]] = []
    providers: dict[str, dict[str, Any]] = {}
    total = 0
    enabled = 0

    for task, models in sorted((catalog or {}).items()):
        if not isinstance(models, dict):
            continue
        task_models = []
        for model_id, model_entry in sorted(models.items()):
            entry = model_entry if isinstance(model_entry, dict) else {}
            provider = _model_provider(entry)
            provider_label = str(entry.get("provider") or "")
            model_disabled = _normalize_model_id(model_id) in disabled_models
            provider_disabled = bool(provider and provider in disabled_providers)
            is_enabled = not model_disabled and not provider_disabled
            total += 1
            enabled += 1 if is_enabled else 0

            if provider:
                provider_state = providers.setdefault(
                    provider,
                    {
                        "id": provider,
                        "displayName": provider_label or provider,
                        "total": 0,
                        "enabled": 0,
                        "disabled": 0,
                    },
                )
                provider_state["total"] += 1
                if is_enabled:
                    provider_state["enabled"] += 1
                else:
                    provider_state["disabled"] += 1

            task_models.append({
                "id": model_id,
                "displayName": str(entry.get("display_name") or model_id),
                "provider": provider_label,
                "description": str(entry.get("description") or ""),
                "inputModalities": list(entry.get("input_modalities") or []),
                "outputModalities": list(entry.get("output_modalities") or []),
                "enabled": is_enabled,
                "disabledByProvider": provider_disabled,
            })
        tasks.append({"task": task, "models": task_models})

    provider_items = []
    for provider in sorted(providers.values(), key=lambda item: str(item["displayName"]).lower()):
        provider_items.append({
            **provider,
            "enabled": provider["id"] not in disabled_providers,
        })

    return {
        "tasks": tasks,
        "providers": provider_items,
        "disabledModelIds": sorted(disabled_models),
        "disabledProviderIds": sorted(disabled_providers),
        "total": total,
        "enabled": enabled,
        "disabled": max(total - enabled, 0),
    }


def update_model_visibility(disabled_model_ids: list[Any], disabled_provider_ids: list[Any] | None = None) -> dict[str, Any]:
    disabled_models = sorted({
        _normalize_model_id(item)
        for item in disabled_model_ids
        if _normalize_model_id(item)
    })
    disabled_providers = sorted({
        _normalize_provider(item)
        for item in (disabled_provider_ids or [])
        if _normalize_provider(item)
    })
    payload = {
        "disabled_models": disabled_models,
        "disabled_providers": disabled_providers,
    }
    with _LOCK:
        _write_config_unlocked(payload)
    return payload
