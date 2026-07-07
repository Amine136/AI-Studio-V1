"""Pack service layer: localized views, slot validation + prompt rendering,
estimate, and the multi-tile generate runner. Keeps the HTTP handlers in main.py
thin. All generation routes through the shared core (app.packs.core), inheriting
moderation, the image-input guardrail, and server-side credit charging.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.packs import agent as packs_agent
from app.packs.catalog import Pack, pick
from app.packs.core import GenRequest, estimate as core_estimate, execute_one
from app.packs.resolver import (
    aspect_options,
    resolve_image_model,
    selectable_models as resolver_selectable_models,
    selectable_models_for_mockup as resolver_selectable_models_for_mockup,
)
from app.services.sanitizer import sanitize_user_text

# Sized under the quick-mode burst limit (10/60s) so a single multi-image
# request never self-throttles. Larger fan-out is the Phase 6 batch runner.
MAX_PACK_N = 8

# Flat platform fee (credits) added per image on top of the resolved model's base
# price. The user is reserved AND charged exactly base + fee (predictable), and the
# real provider cost becomes margin. Not applied to the $0 fake test provider.
PACKS_PLATFORM_FEE = 0.1

_PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")


def _apply_fee(est: Dict[str, Any], use_fake: bool) -> Dict[str, Any]:
    """Add the flat platform fee per image to a raw core estimate."""
    if not est.get("available") or use_fake:
        return est
    n = max(int(est.get("n") or 1), 1)
    unit = round(float(est.get("unit") or 0) + PACKS_PLATFORM_FEE, 4)
    est["unit"] = unit
    est["total"] = round(unit * n, 4)
    est["fee"] = PACKS_PLATFORM_FEE
    return est


class PackError(ValueError):
    """Validation error carrying a stable machine code (e.g. MISSING_SLOT:product)."""


# --------------------------- availability + views ---------------------------

def pack_available(pack: Pack, *, use_fake: bool = False) -> bool:
    return resolve_image_model(pack.capability, use_fake=use_fake) is not None


def card_view(pack: Pack, lang: str) -> Dict[str, Any]:
    return {
        "id": pack.id,
        "sector": pack.sector,
        "capability": pack.capability,
        "title": pick(pack.title_i18n, lang),
        "promise": pick(pack.description_i18n, lang),
        "thumbnail_url": pack.thumbnail_url,
        "requires_image_input": pack.requires_image_input,
        "kind": pack.kind,
        "tags": pack.tags,
    }


def detail_view(pack: Pack, lang: str) -> Dict[str, Any]:
    slots: List[Dict[str, Any]] = []
    for s in pack.slots:
        sv: Dict[str, Any] = {
            "key": s.key,
            "type": s.type,
            "label": pick(s.label_i18n, lang),
            "required": s.required,
            "multiline": s.multiline,
        }
        if s.type == "select":
            sv["options"] = [{"value": o.value, "label": pick(o.label_i18n, lang)} for o in s.options]
        if s.placeholder_i18n:
            sv["placeholder"] = pick(s.placeholder_i18n, lang)
        slots.append(sv)
    return {
        **card_view(pack, lang),
        "hero_example_url": pack.hero_example_url,
        "slots": slots,
        "aspect_ratios": pack.aspect_ratios,
        "default_n": pack.default_n,
        "models": resolver_selectable_models(),
        "mockup_models": resolver_selectable_models_for_mockup(),
        # Editable example that pre-fills the studio composer (pack-level default).
        "example": pick(pack.example_i18n, lang),
        "variants": [
            {
                "id": v.id,
                "title": pick(v.title_i18n, lang),
                "scene": v.scene,
                "thumbnail_url": v.thumbnail_url,
                "hero_example_url": v.hero_example_url,
                # Per-mockup editable example (overrides the pack default when set).
                "example": pick(v.example_i18n, lang),
            }
            for v in pack.variants
        ],
    }


# --------------------------- validation + render ---------------------------

def _clamp_n(pack: Pack, n: Optional[int]) -> int:
    value = pack.default_n if not n or n < 1 else int(n)
    return max(1, min(value, MAX_PACK_N))


def _resolve_aspect_ratio(pack: Pack, aspect_ratio: Optional[str], model: Optional[str] = None) -> Optional[str]:
    """Resolve the aspect/size value to send. Options are model-driven: each model
    accepts its own vocabulary (grok ratio strings vs gpt-image pixel sizes), so we
    validate against the *selected* model's options when one is known. When the
    model is unknown (resolver will auto-pick), the value is passed through and
    ``core._build_generate_request`` drops it if the resolved model can't take it."""
    opts = aspect_options(model) if model else []
    if aspect_ratio is None:
        if opts:
            return opts[0]
        return pack.aspect_ratios[0] if pack.aspect_ratios else None
    if opts:
        # Model known: accept only a value it actually offers, else its default.
        return aspect_ratio if aspect_ratio in opts else opts[0]
    # Model unknown: pass through; core validates against the resolved model.
    return aspect_ratio


def render_prompt(pack: Pack, slot_values: Optional[Dict[str, Any]]) -> str:
    """Validate slot values and render prompt_template. Sanitizes free text;
    moderation still runs downstream in the pipeline."""
    values = slot_values or {}
    rendered = pack.prompt_template

    for s in pack.slots:
        if s.type == "image_ref":
            continue
        raw = values.get(s.key)
        val = "" if raw is None else str(raw).strip()
        if s.required and not val:
            raise PackError(f"MISSING_SLOT:{s.key}")
        if s.type == "select" and val:
            allowed = {o.value for o in s.options}
            if val not in allowed:
                raise PackError(f"BAD_OPTION:{s.key}")
        if val:
            val = sanitize_user_text(val)
        rendered = rendered.replace("{{" + s.key + "}}", val)

    # Drop any leftover placeholders (optional slots left empty) and tidy.
    rendered = _PLACEHOLDER_RE.sub("", rendered)
    rendered = re.sub(r"\s+", " ", rendered)
    rendered = re.sub(r"\s+,", ",", rendered)
    rendered = re.sub(r",\s*,", ",", rendered).strip(" ,")
    if len(rendered) < 3:
        # Freeform packs with only an image (no prompt) fall back to a default
        # instruction; otherwise the prompt is genuinely empty.
        fallback = (pack.default_prompt or "").strip()
        if fallback:
            return sanitize_user_text(fallback)
        raise PackError("EMPTY_PROMPT")
    return rendered


# ------------------------------- estimate -------------------------------

def estimate_pack(
    pack: Pack,
    n: Optional[int],
    aspect_ratio: Optional[str] = None,
    *,
    has_image: bool = False,
    model: Optional[str] = None,
    quality: Optional[str] = None,
    use_fake: bool = False,
) -> Dict[str, Any]:
    """Pure read: n x unit price of the resolved model. No provider call.

    ``has_image`` reflects whether the user has attached a reference/design image,
    which routes to an editing model (different price) - so the studio cost line
    stays accurate as the upload is added/removed. ``quality`` selects a pricing
    tier (e.g. low/medium or 1k/2k), so the cost tracks the chosen quality.
    """
    count = _clamp_n(pack, n)
    ratio = _resolve_aspect_ratio(pack, aspect_ratio, model)
    req = GenRequest(
        capability=pack.capability,
        prompt=pack.prompt_template,  # text is irrelevant to cost
        n=count,
        aspect_ratio=ratio,
        # Placeholder ref so the resolver prices the editing model; not sent anywhere.
        image_refs=[{"url": "placeholder"}] if has_image else [],
        model=model,
        quality=quality,
        use_fake=use_fake,
    )
    return _apply_fee(core_estimate(req), use_fake)


# --------------------------------- plan ---------------------------------

def plan_pack(
    pack: Pack,
    *,
    user_text: str,
    image_refs: Optional[List[Dict[str, Any]]],
    lang: str = "ar",
    variant_id: Optional[str] = None,
    round_no: int = 1,
    mockup_first: bool = False,
    history: Optional[List[Dict[str, Any]]] = None,
    use_fake: bool = False,
    uid: str = "",
) -> Dict[str, Any]:
    """Run the planning agent (FREE) and, for an "ok" plan, attach a cost estimate
    for the recommended model so the confirm pop-up can show the price without a
    second round-trip. No credits are reserved or charged here.
    """
    result = packs_agent.build_plan(
        pack,
        user_text=user_text or "",
        image_refs=image_refs or [],
        lang=lang,
        variant_id=variant_id,
        round_no=round_no,
        mockup_first=mockup_first,
        history=history,
        uid=uid,
    )
    if result.get("status") != "ok":
        return result

    plan = result.get("plan") or {}
    if plan.get("model"):
        try:
            est = estimate_pack(
                pack,
                1,
                plan.get("aspect_ratio"),
                has_image=bool(image_refs),
                model=plan.get("model"),
                quality=plan.get("quality"),
                use_fake=use_fake,
            )
            result["estimate"] = est
        except PackError:
            # A pricing hiccup must not sink a valid plan; the pop-up can still
            # fetch the estimate via /packs/{id}/estimate.
            result["estimate"] = None
    return result


# ------------------------------- generate -------------------------------

def _extract_image(results: Any) -> Optional[str]:
    if isinstance(results, dict):
        val = results.get("image")
        if isinstance(val, str):
            return val
    return None


def generate_pack(
    pack: Pack,
    slot_values: Optional[Dict[str, Any]],
    n: Optional[int],
    aspect_ratio: Optional[str],
    image_refs: Optional[List[Dict[str, Any]]],
    user: Dict[str, Any],
    request: Any,
    *,
    model: Optional[str] = None,
    quality: Optional[str] = None,
    prompt_override: Optional[str] = None,
    use_fake: bool = False,
    lang: str = "ar",
) -> Dict[str, Any]:
    """Render once, then run n independent single-image generations through the
    shared core. Each tile is charged only if delivered; failures are isolated.

    ``prompt_override`` (the planning agent's final prompt) is used verbatim when
    present, bypassing the pack template; ``quality`` selects the model's pricing/
    quality tier. Both come from the confirm pop-up.
    """
    if not pack_available(pack, use_fake=use_fake):
        raise PackError("CAPABILITY_UNAVAILABLE")
    if pack.requires_image_input and not image_refs:
        raise PackError("IMAGE_REQUIRED")

    count = _clamp_n(pack, n)
    ratio = _resolve_aspect_ratio(pack, aspect_ratio, model)
    override = (prompt_override or "").strip()
    prompt = sanitize_user_text(override) if override else render_prompt(pack, slot_values)

    # The model's ACTUAL provider cost is charged at capture (like the playground);
    # we only add this flat fee on top, so input images/tokens can never cause a
    # loss. $0 for the fake test provider.
    fee_amount = 0.0 if use_fake else PACKS_PLATFORM_FEE

    tiles: List[Dict[str, Any]] = []
    charged_total = 0.0
    balance: Any = None

    for i in range(count):
        req = GenRequest(
            capability=pack.capability,
            prompt=prompt,
            n=1,
            aspect_ratio=ratio,
            image_refs=image_refs or [],
            lang=lang,
            model=model,
            quality=quality,
            platform_fee=fee_amount,
            use_fake=use_fake,
        )
        try:
            res = execute_one(req, user, request)
        except HTTPException as exc:
            status = exc.status_code
            succeeded_any = any(t["status"] == "success" for t in tiles)
            # Block / insufficient / suspension: every tile shares one prompt, so
            # if none has succeeded the whole request is blocked -> propagate
            # (preserves CONTENT_BLOCKED / suspension semantics + ban ladder).
            if status in (402, 403):
                if not succeeded_any:
                    raise
                tiles.append({"index": i, "status": "blocked", "image": None, "charged_cost": 0.0})
                continue
            # Rate / concurrency limits: stop early, return what we have.
            if status in (429, 503):
                tiles.append({"index": i, "status": "skipped", "image": None, "charged_cost": 0.0, "reason": "rate_limited"})
                break
            tiles.append({"index": i, "status": "error", "image": None, "charged_cost": 0.0, "error": str(exc.detail)})
            continue

        meta = getattr(res, "meta", {}) or {}
        if getattr(res, "status", None) == "success":
            cost = 0.0
            try:
                cost = round(float(meta.get("charged_cost") or 0), 4)
            except (TypeError, ValueError):
                cost = 0.0
            charged_total += cost
            if meta.get("current_balance") is not None:
                balance = meta.get("current_balance")
            tiles.append({"index": i, "status": "success", "image": _extract_image(getattr(res, "results", None)), "charged_cost": cost})
        else:
            tiles.append({"index": i, "status": "error", "image": None, "charged_cost": 0.0, "error": meta.get("error_message")})

    succeeded = sum(1 for t in tiles if t["status"] == "success")
    return {
        "pack_id": pack.id,
        "requested": count,
        "tiles": tiles,
        "summary": {
            "succeeded": succeeded,
            "charged_total": round(charged_total, 4),
            "current_balance": balance,
        },
    }


# Stable code -> HTTP detail mapping for the route layer.
def pack_error_detail(exc: PackError) -> Dict[str, Any]:
    code = str(exc)
    base, _, arg = code.partition(":")
    return {"error": {"code": base, "field": arg or None}}
