"""Capability-driven model registry + task-aware recommender for Packs.

The agent must work across the whole image-model roster (OpenAI, Grok, Gemini
"Nano Banana", Ideogram, Imagen, Recraft, ...) without hard-coding model names.
It reasons over *capabilities*, not ids, so a model newly enabled in AKM slots
in for free.

Two capability sources, merged here:
  - AUTO (live AKM catalog): image_input (from input_modalities), cost (from
    billing), provider. These are facts, never curated.
  - CURATED (model_traits.json): fidelity / text / output / photoreal /
    multi_image - the qualitative judgments AKM's blurbs don't encode.

recommend_models() is RECOMMENDATION ONLY. The user stays free to pick any
eligible model in the confirm pop-up. The single hard gate is technical: a task
that needs an image input drops models that cannot accept one (this is also the
place the owner's "exclude editing models that don't take images" rule lives).
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config import settings

logger = logging.getLogger(__name__)

_TRAITS_PATH = Path(__file__).with_name("model_traits.json")

# Safe defaults for a model with no curated entry (e.g. just enabled in AKM).
_DEFAULT_TRAITS: Dict[str, Any] = {
    "fidelity": None,
    "text": "ok",
    "output": "raster",
    "photoreal": "medium",
    "multi_image": False,
    "notes": "",
}

# Ordinal scales so "prefer fidelity:high" is satisfied by high OR highest.
_ORDINAL: Dict[str, Dict[Any, int]] = {
    "fidelity":  {None: 0, "low": 1, "medium": 2, "high": 3, "highest": 4},
    "photoreal": {None: 0, "low": 1, "medium": 2, "high": 3, "highest": 4},
    "text":      {None: 0, "weak": 1, "ok": 2, "strong": 3, "strongest": 4},
}


def _load_traits() -> Dict[str, Dict[str, Any]]:
    try:
        data = json.loads(_TRAITS_PATH.read_text(encoding="utf-8"))
        return {k: v for k, v in data.items() if not k.startswith("_") and isinstance(v, dict)}
    except Exception as exc:  # never let a bad/missing file break planning
        logger.warning("capabilities: model_traits.json unreadable (%s); using defaults", exc)
        return {}


def _image_catalog() -> Dict[str, Any]:
    return settings.model_catalog.get("image", {}) or {}


def accepts_image_input(entry: Dict[str, Any]) -> bool:
    return "IMAGE" in (entry.get("input_modalities") or [])


def model_min_cost(entry: Dict[str, Any]) -> Optional[float]:
    """Cheapest credit price for the model: per-size prices first, else a fixed
    price, else unknown (None)."""
    billing = (entry or {}).get("billing") or {}
    prices = ((billing.get("image") or {}).get("imageSizePrices")) or {}
    vals: List[float] = []
    for v in prices.values():
        try:
            vals.append(float(v))
        except (TypeError, ValueError):
            continue
    if not vals:
        fixed = (billing.get("fixed") or {}).get("amount")
        try:
            if fixed is not None:
                vals.append(float(fixed))
        except (TypeError, ValueError):
            pass
    return min(vals) if vals else None


def _is_test_model(mid: str, entry: Dict[str, Any]) -> bool:
    prov = str((entry.get("provider") or "")).lower()
    return mid.startswith("fake-") or "fake" in prov


def registry(include_test: bool = False) -> Dict[str, Dict[str, Any]]:
    """Every enabled image model, annotated with auto + curated capabilities."""
    traits = _load_traits()
    out: Dict[str, Dict[str, Any]] = {}
    for mid, entry in _image_catalog().items():
        if not include_test and _is_test_model(mid, entry):
            continue
        merged = {**_DEFAULT_TRAITS, **(traits.get(mid) or {})}
        out[mid] = {
            "id": mid,
            "label": entry.get("display_name") or entry.get("model_id") or mid,
            "image_input": accepts_image_input(entry),
            "cost": model_min_cost(entry),
            **merged,
        }
    return out


# --------------------------------------------------------------------------
# Task -> capability requirements.
#   require: hard gates (technical/output). A model must satisfy ALL to be
#            eligible. {"image_input": True} drops models that can't edit.
#   prefer:  soft, weighted scoring among eligible models (ordinal-aware).
# --------------------------------------------------------------------------
TASK_REQUIREMENTS: Dict[str, Dict[str, Dict[str, Any]]] = {
    # --- top priority: e-commerce core (preserve-heavy) ---
    "product_in_scene":   {"require": {"image_input": True}, "prefer": {"fidelity": "high"}},
    "background_change":   {"require": {"image_input": True}, "prefer": {"fidelity": "high"}},
    "edit_previous":       {"require": {"image_input": True}, "prefer": {"fidelity": "high"}},
    # --- secondary ---
    "try_on":              {"require": {"image_input": True}, "prefer": {"fidelity": "high", "multi_image": True}},
    "recolor":             {"require": {"image_input": True}, "prefer": {"fidelity": "high"}},
    "combine":             {"require": {"image_input": True, "multi_image": True}, "prefer": {"fidelity": "high"}},
    # --- tertiary / mockups & specialised outputs ---
    "mockup_placeholder":  {"require": {"image_input": True}, "prefer": {"fidelity": "high"}},
    "restyle":             {"require": {"image_input": True}, "prefer": {"fidelity": "high"}},
    "inpaint_remove":      {"require": {"image_input": True}, "prefer": {"fidelity": "high"}},
    "reframe":             {"require": {"image_input": True}, "prefer": {"fidelity": "high"}},
    "add_text":            {"require": {}, "prefer": {"text": "strong"}},
    "logo_vector":         {"require": {"output": "vector"}, "prefer": {"text": "strong"}},
    "transparent_cutout":  {"require": {"output": "transparent"}, "prefer": {"text": "strong"}},
    "generate":            {"require": {}, "prefer": {"photoreal": "high"}},
}

TASK_TYPES: List[str] = list(TASK_REQUIREMENTS.keys())


def _meets(model: Dict[str, Any], key: str, want: Any) -> bool:
    mv = model.get(key)
    if key in _ORDINAL:
        scale = _ORDINAL[key]
        return scale.get(mv, 0) >= scale.get(want, 0)
    return mv == want


def _score(model: Dict[str, Any], prefer: Dict[str, Any]) -> float:
    """Rank eligible models by capability fit. Ordinal preferences
    (fidelity/photoreal/text) are MAXIMIZED - a stronger trait scores higher -
    so the best model surfaces first. Boolean prefs add a flat point. Price is
    deliberately NOT a factor (the user sees the price and can switch)."""
    s = 0.0
    for k, v in prefer.items():
        if k in _ORDINAL:
            s += float(_ORDINAL[k].get(model.get(k), 0))
        else:
            s += 1.0 if _meets(model, k, v) else 0.0
    return s


# Preference order among equally-capable models. Price is intentionally NOT a
# factor here - the user sees the price and switches models himself. Best
# all-rounder first so a fallback default lands on the strongest general model.
MODEL_PRIORITY: List[str] = [
    "gemini-3.1-flash-image-preview",      # Nano Banana 2 - best all-rounder + text/Arabic
    "gemini-3-pro-image-preview",          # Nano Banana Pro
    "gpt-image-2",                         # strongest reasoning editor
    "grok-imagine-image-quality-editing",  # top quality edit
]


def _priority_index(model_id: str) -> int:
    return MODEL_PRIORITY.index(model_id) if model_id in MODEL_PRIORITY else len(MODEL_PRIORITY)


def recommend_models(
    task_type: str,
    *,
    n_images: int = 0,
    include_test: bool = False,
) -> List[Dict[str, Any]]:
    """Eligible image models for the task, best-fit first. Eligibility = passes
    every hard ``require``; ranking = most satisfied ``prefer`` then lowest cost
    (cost-sensitive tie-break). Returns the full eligible list (the agent picks
    one to recommend; the user may override to any of them)."""
    reqs = TASK_REQUIREMENTS.get(task_type) or {}
    require = dict(reqs.get("require") or {})
    prefer = dict(reqs.get("prefer") or {})

    # A combine task only truly needs multi_image when 2+ images are attached.
    if task_type == "combine" and n_images < 2:
        require.pop("multi_image", None)

    eligible: List[Dict[str, Any]] = []
    for m in registry(include_test=include_test).values():
        if all(_meets(m, k, v) for k, v in require.items()):
            eligible.append(m)

    eligible.sort(key=lambda m: (-_score(m, prefer), _priority_index(m["id"])))
    return eligible


def is_eligible(model_id: str, task_type: str, *, n_images: int = 0) -> bool:
    return any(m["id"] == model_id for m in recommend_models(task_type, n_images=n_images, include_test=True))
