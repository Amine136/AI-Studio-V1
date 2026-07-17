"""Shared core for Packs.

A Pack is a recipe that builds a normalized generation request and feeds it to
the *existing* generation pipeline, inheriting moderation, the image-input
guardrail, and server-side credit charging for free. This module is the
deterministic sibling of the smart pipeline:

    GenRequest                -> normalized {capability, prompt, n, aspect_ratio, image_refs, lang}
    estimate(GenRequest)      -> credits from the pricing table (NO provider call)
    execute_one(GenRequest)   -> one image through the existing /generate core

``n`` images == ``n`` independent ``execute_one`` calls. The platform rejects
``sampleCount`` (one /generate == one image), and per-tile independence is what
the design wants anyway: each tile is charged only if delivered, and one
moderation block / failure never sinks the others.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from app.core.schema import GenerateRequest, GenerationResult
from app.packs.resolver import (
    ASPECT_PARAM_KEYS,
    quality_param_key,
    quality_tiers,
    resolve_image_model,
)


@dataclass
class GenRequest:
    """A normalized, model-agnostic generation request produced by a pack."""

    capability: str
    prompt: str
    n: int = 1
    aspect_ratio: Optional[str] = None
    # Each ref is a dict shaped like core.schema.InputImage
    # ({fileId|file_id, name, mime_type, url}).
    image_refs: List[Dict[str, Any]] = field(default_factory=list)
    lang: str = "ar"
    # Optional user-selected image model (validated against the selectable set).
    model: Optional[str] = None
    # Flat platform fee (credits) added on top of the model's ACTUAL provider
    # cost at capture - mirrors the playground (which charges meta.total_cost),
    # so input images/tokens can never cause a loss. 0 for the $0 fake provider.
    platform_fee: Optional[float] = None
    # Optional quality/resolution tier (e.g. "low"/"medium" or "1k"/"2k"); mapped
    # to the chosen model's quality-like parameter when it supports one.
    quality: Optional[str] = None
    # Staging-only: force the $0 fake provider. Never set from user input.
    use_fake: bool = False


def _build_generate_request(req: GenRequest, model_id: str) -> GenerateRequest:
    """Translate a GenRequest into a quick-mode GenerateRequest (one image).

    aspect_ratio is only attached when the resolved model actually supports it:
    capabilities can resolve to models with different parameter sets, and they
    name the size dimension differently (grok -> "aspectRatio" with ratio strings,
    gpt-image -> "imageSize" with pixel sizes). We attach the value under the
    model's own aspect key, and only when the value is one the model offers, so
    the /generate validator never rejects it. Unsupported ratios are dropped,
    not forced.
    """
    from app.config import settings

    model_entry = settings.model_catalog.get("image", {}).get(model_id, {})
    schema = settings.get_model_parameter_schema(model_id, model_entry) or {}
    image_params: Dict[str, Any] = {}
    if req.aspect_ratio:
        for akey in ASPECT_PARAM_KEYS:
            spec = schema.get(akey)
            if isinstance(spec, dict) and spec.get("type") == "enum":
                if req.aspect_ratio in (spec.get("values") or []):
                    image_params[akey] = req.aspect_ratio
                break
    # Quality maps to whichever parameter holds the model's tier values (e.g.
    # "quality" for gpt-image, "resolution" for grok). Only attach a tier the
    # model actually offers, so the /generate validator never rejects it.
    if req.quality:
        qkey = quality_param_key(model_id)
        if qkey and req.quality in quality_tiers(model_id):
            image_params[qkey] = req.quality
    model_parameters: Dict[str, Dict[str, Any]] = {"image": image_params} if image_params else {}

    return GenerateRequest(
        user_text=req.prompt,
        requested_outputs=["image"],
        mode="quick",
        status="generating",
        user_preferences={"image_model": model_id},
        model_parameters=model_parameters,
        input_images=(req.image_refs or None),
    )


def estimate(req: GenRequest) -> Dict[str, Any]:
    """Per-image and total credit estimate. Pure read - no provider call."""
    # Imported lazily to avoid a circular import (main.py imports the pack
    # endpoints, which import this module).
    from app.main import _expected_required_credits_for_generate

    model_id = resolve_image_model(req.capability, has_image=bool(req.image_refs), use_fake=req.use_fake, model=req.model)
    if not model_id:
        return {"available": False, "model": None, "unit": 0.0, "n": req.n, "total": 0.0}

    gen_req = _build_generate_request(req, model_id)

    # Some models (e.g. Gemini image) have imageSizePrices billing tiers but no
    # explicit quality/resolution parameter in their schema, so _build_generate_request
    # can't attach the tier to model_parameters. Inject it as "imageSize" here so
    # _expected_model_cost_for_generate picks the right tier price. Estimate-only —
    # does not affect the actual generation call.
    if req.quality and req.quality in quality_tiers(model_id) and not quality_param_key(model_id):
        mp = dict(gen_req.model_parameters or {})
        img_mp = dict(mp.get("image") or {})
        img_mp["imageSize"] = req.quality
        mp["image"] = img_mp
        gen_req = gen_req.model_copy(update={"model_parameters": mp})

    breakdown = _expected_required_credits_for_generate(gen_req)
    unit = round(float(breakdown.get("image_expected") or 0), 4)
    n = max(int(req.n or 1), 1)
    return {
        "available": True,
        "model": model_id,
        "unit": unit,
        "n": n,
        "total": round(unit * n, 4),
    }


def execute_one(req: GenRequest, user: Dict[str, Any], request: Any) -> GenerationResult:
    """Run ONE image through the existing generation core (moderation + guardrail
    + reserve/capture all inherited). Raises ValueError if the capability has no
    live model.
    """
    from app.main import _generate_content_impl

    model_id = resolve_image_model(req.capability, has_image=bool(req.image_refs), use_fake=req.use_fake, model=req.model)
    if not model_id:
        raise ValueError("CAPABILITY_UNAVAILABLE")

    gen_req = _build_generate_request(req, model_id)
    return _generate_content_impl(request, gen_req, user, platform_fee=req.platform_fee)
