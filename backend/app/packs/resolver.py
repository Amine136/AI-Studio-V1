"""Capability -> concrete model resolver for Packs.

A pack declares a *capability* (photoreal / edit-from-reference / text-in-image /
vector-graphic / calligraphy). This module maps it to a live image model that
exists in the AKM-synced catalog (``settings.model_catalog``). Membership in that
catalog is the same "exists & usable" signal the /generate path itself relies on
(see ``_resolve_model_choice`` / ``_validate_selected_model_exists`` in main.py).

Packs never hardcode a model: they ask for a capability and get whatever the
catalog currently serves it with. If no candidate is present the pack is
considered unavailable and is hidden from the gallery.
"""
from __future__ import annotations

from typing import List, Optional

from app.config import settings
from app.services.model_visibility import visible_image_models

# Ordered preference per capability. First candidate present in the live image
# catalog wins. All ids below are real entries seen in model_catalog.live.json;
# the ordering is a curation choice, not a lock - drop/extend freely as the
# catalog evolves.
CAPABILITY_CANDIDATES: dict[str, List[str]] = {
    "photoreal": [
        "imagen-4.0-generate-001",
        "gpt-image-1.5",
        "gemini-3.1-flash-image-preview",
        "imagen-4.0-fast-generate-001",
    ],
    "edit-from-reference": [
        "gemini-3.1-flash-image-preview",
        "gpt-image-1.5",
        "grok-imagine-image-quality-editing",
        "recraftv3_vector",
    ],
    "text-in-image": [
        "ideogram-v3-generate",
        "gpt-image-1.5",
        "gemini-3.1-flash-image-preview",
    ],
    "vector-graphic": [
        "recraftv4_1_vector",
        "recraftv3_vector",
        "ideogram-v3-generate",
    ],
    "calligraphy": [
        "ideogram-v3-generate",
        "gpt-image-1.5",
        "gemini-3.1-flash-image-preview",
    ],
}

# When the user supplies a reference/design image (e.g. the studio "upload your
# design" slot), ANY pack routes to an image-input editing model regardless of its
# declared capability. Owner-chosen (gpt-image-1-mini + grok editing); the plain
# grok-imagine-image also accepts image input and is kept as a backstop.
IMAGE_EDIT_MODELS: List[str] = [
    "gpt-image-1-mini",
    "grok-imagine-image-quality-editing",
    "grok-imagine-image",
]

# Universal fallback: general image models usable for ANY capability when the
# curated per-capability models are not currently enabled in the AKM catalog.
# Owner directive: gpt-image-1-mini + grok must work for all packs. This keeps
# packs available even when imagen/ideogram/recraft/gemini are toggled off.
UNIVERSAL_FALLBACK: List[str] = [
    "gpt-image-1-mini",
    "grok-imagine-image-quality-editing",
    "grok-imagine-image",
    "gpt-image-1.5",
    "gemini-3.1-flash-image-preview",
    "imagen-4.0-generate-001",
]

# Preferred DISPLAY ORDER for user-selectable models. This is no longer an
# allowlist: every real image model live in the AKM catalog is offered (AKM is
# the single enable/disable control), with these shown first and any other
# enabled model after them. The capability layer (capabilities.py) + the agent
# recommend the task-appropriate model; the user may still pick any of them.
SELECTABLE_MODELS: List[str] = [
    "gpt-image-1-mini",
    "gpt-image-2",
    "gemini-3.1-flash-image-preview",
    "grok-imagine-image",
    "grok-imagine-image-quality-editing",
]

# Models shown in the confirm popup when a mockup/scene is active.
# These handle image-compositing well; the full catalog list is too broad
# for mockup workflows.
MOCKUP_SELECTABLE_MODELS: List[str] = [
    "gpt-image-1-mini",
    "gpt-image-1.5",
    "gpt-image-2",
    "grok-imagine-image",
    "grok-imagine-image-quality-editing",
    "gemini-2.5-flash-image",
    "gemini-3.1-flash-image-preview",
    "gemini-3-pro-image-preview",
]

# $0 static provider on staging, used to exercise the full flow without billing.
TEST_FAKE_IMAGE_MODEL = "fake-image-out"

CAPABILITIES = tuple(CAPABILITY_CANDIDATES.keys())


def quality_tiers(model_id: str) -> List[str]:
    """The pricing/quality tiers a model exposes (e.g. ["low","medium"] or
    ["1k","2k"]), read from its billing.image.imageSizePrices. These tier names
    are the user-facing "quality" choices; ``quality_param_key`` maps them back to
    the model's actual parameter (``quality`` / ``resolution`` / ...)."""
    catalog = settings.model_catalog.get("image", {}) or {}
    prices = (((catalog.get(model_id) or {}).get("billing") or {}).get("image") or {}).get("imageSizePrices") or {}
    return list(prices.keys())


def quality_param_key(model_id: str) -> Optional[str]:
    """The model-parameter key whose enum values are the quality tiers, found by
    matching the pricing tier names against each enum in the model's parameter
    schema (gpt-image -> "quality", grok -> "resolution"). None when the model has
    no quality-like parameter."""
    catalog = settings.model_catalog.get("image", {}) or {}
    entry = catalog.get(model_id) or {}
    tiers = set(quality_tiers(model_id))
    if not tiers:
        return None
    schema = settings.get_model_parameter_schema(model_id, entry) or {}
    for key, spec in schema.items():
        if isinstance(spec, dict) and spec.get("type") == "enum":
            values = set(spec.get("values") or [])
            if tiers <= values:
                return key
    return None


# The size/aspect dimension is exposed under different parameter keys by
# different providers and with different vocabularies (grok -> "aspectRatio"
# with ratio strings like "3:2"; gpt-image -> "imageSize" with pixel sizes like
# "1024x1024"). They are surfaced to the user as ONE "aspect ratio" control whose
# options are whatever the *selected* model actually accepts. Priority order: the
# first of these enum keys present in a model's schema is the aspect parameter.
ASPECT_PARAM_KEYS = ("aspectRatio", "imageSize", "size")


def aspect_param_key(model_id: str) -> Optional[str]:
    """The model-parameter key that holds its aspect-ratio / size options
    (gpt-image -> "imageSize", grok -> "aspectRatio"). None when the model
    exposes no such enum (e.g. the fake provider)."""
    catalog = settings.model_catalog.get("image", {}) or {}
    entry = catalog.get(model_id) or {}
    schema = settings.get_model_parameter_schema(model_id, entry) or {}
    for key in ASPECT_PARAM_KEYS:
        spec = schema.get(key)
        if isinstance(spec, dict) and spec.get("type") == "enum":
            return key
    return None


def aspect_options(model_id: str) -> List[str]:
    """The aspect-ratio / size values the given model accepts (its enum values),
    or [] when it has no aspect parameter. These are the user-facing choices for
    the confirm pop-up and change with the selected model."""
    key = aspect_param_key(model_id)
    if not key:
        return []
    catalog = settings.model_catalog.get("image", {}) or {}
    entry = catalog.get(model_id) or {}
    schema = settings.get_model_parameter_schema(model_id, entry) or {}
    return list((schema.get(key) or {}).get("values") or [])


def _ratio_to_float(value: str) -> Optional[float]:
    """Parse a width/height value into a float, or None when it isn't a shape
    (e.g. "auto"). Handles both ratio strings ("4:5", "4x5") and pixel sizes
    ("1024x1536")."""
    v = (value or "").strip().lower()
    for sep in (":", "x"):
        if sep in v:
            parts = v.split(sep)
            if len(parts) == 2:
                try:
                    w, h = float(parts[0]), float(parts[1])
                    if w > 0 and h > 0:
                        return w / h
                except ValueError:
                    continue
    return None


def order_aspect_ratios(options: List[str], pack_aspect_ratios: Optional[List[str]]) -> List[str]:
    """Reorder a model's native aspect-ratio/size options so the one closest to
    the PACK's declared intent (e.g. ["4:5","1:1"]) comes first, instead of the
    model's raw catalog order.

    Why this exists: a pack's ``aspect_ratios`` rarely matches a model's exact
    vocabulary as a literal string (e.g. no photoreal model literally offers
    "4:5"), so without this the UI/backend fell back to the model's first native
    option regardless of the pack's intent - which for some models (e.g.
    gpt-image's "auto") means "inherit whatever shape the input image happens to
    be", producing unexpectedly tall/reel-shaped results for packs that only
    ever wanted square/near-square output. Shapeless options ("auto") are kept
    available but pushed to the end since they can't be scored against intent.
    """
    if not pack_aspect_ratios:
        return options
    targets = [t for t in (_ratio_to_float(r) for r in pack_aspect_ratios) if t is not None]
    if not targets:
        return options

    def distance(opt: str) -> float:
        f = _ratio_to_float(opt)
        if f is None:
            return float("inf")
        return min(abs(f - t) for t in targets)

    return sorted(options, key=distance)


def selectable_models(pack_aspect_ratios: Optional[List[str]] = None) -> List[dict]:
    """The image models a user may choose from, restricted to those live in the
    catalog. Each item: {"id", "label", "quality_options", "aspect_ratios"}
    (label = display_name; quality_options = the pricing/quality tiers;
    aspect_ratios = the model's own size/ratio options for the confirm pop-up,
    reordered toward ``pack_aspect_ratios`` when given - see
    ``order_aspect_ratios``)."""
    catalog = visible_image_models()
    # Every real image model live in the catalog (minus the $0 test provider),
    # ordered by SELECTABLE_MODELS first, then any other enabled model.
    live = [mid for mid in catalog if mid and mid != TEST_FAKE_IMAGE_MODEL]
    ordered = [mid for mid in SELECTABLE_MODELS if mid in catalog]
    ordered += sorted(mid for mid in live if mid not in ordered)
    out: List[dict] = []
    for mid in ordered:
        entry = catalog.get(mid) or {}
        out.append({
            "id": mid,
            "label": entry.get("display_name") or mid,
            "quality_options": quality_tiers(mid),
            "aspect_ratios": order_aspect_ratios(aspect_options(mid), pack_aspect_ratios),
        })
    return out


def selectable_models_for_mockup(pack_aspect_ratios: Optional[List[str]] = None) -> List[dict]:
    """Like selectable_models() but restricted to MOCKUP_SELECTABLE_MODELS —
    only models that handle image-compositing well, in preferred order,
    filtered to those currently live in the AKM catalog."""
    catalog = visible_image_models()
    out: List[dict] = []
    for mid in MOCKUP_SELECTABLE_MODELS:
        if mid not in catalog or mid == TEST_FAKE_IMAGE_MODEL:
            continue
        entry = catalog.get(mid) or {}
        out.append({
            "id": mid,
            "label": entry.get("display_name") or mid,
            "quality_options": quality_tiers(mid),
            "aspect_ratios": order_aspect_ratios(aspect_options(mid), pack_aspect_ratios),
        })
    return out


def resolve_image_model(
    capability: str,
    *,
    has_image: bool = False,
    use_fake: bool = False,
    model: Optional[str] = None,
) -> Optional[str]:
    """Return a live image model id, or None if unavailable.

    A valid user-selected ``model`` (live + in SELECTABLE_MODELS) wins. Otherwise:
    when ``has_image`` is set, prefer an image-input editing model so the upload
    is used; then the capability's curated models; then a universal fallback.
    ``use_fake`` forces the staging $0 fake provider when present - testing only.
    A disabled model/provider is excluded here too, so a client that posts a
    disabled model id cannot force it through a pack generation.
    """
    catalog = visible_image_models()
    if use_fake:
        # Test mode must NEVER fall back to a billable model: return the fake
        # provider only if it is actually live, else None (caller refuses).
        return TEST_FAKE_IMAGE_MODEL if TEST_FAKE_IMAGE_MODEL in catalog else None
    if model and model in catalog and any(model == m["id"] for m in selectable_models()):
        return model
    candidates: List[str] = []
    if has_image:
        candidates.extend(IMAGE_EDIT_MODELS)
    candidates.extend(CAPABILITY_CANDIDATES.get(capability, []))
    candidates.extend(UNIVERSAL_FALLBACK)
    for model_id in candidates:
        if model_id in catalog:
            return model_id
    return None


def capability_available(capability: str, *, has_image: bool = False, use_fake: bool = False) -> bool:
    return resolve_image_model(capability, has_image=has_image, use_fake=use_fake) is not None
