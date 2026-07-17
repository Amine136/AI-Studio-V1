"""Generation-planning agent for Packs (Phase A).

A planning LLM sits between the studio (free text + 0..N images, NO param
controls) and the image model. It turns a non-expert request into a ready-to-run
plan, or asks ONE short clarifying question. The plan is the input to the confirm
pop-up (the only place params surface) and then to the existing generation
pipeline.

This step is FREE: it makes one cheap vision-text call through AKM and never bills
the user (the agent cost is absorbed into margin). It is NOT the safety system -
the real moderation gate still runs at generation time. Here we only decline
clearly-abusive requests with a brief, friendly message.

Design (all owner decisions locked):
- model = ``gemini-3.1-flash-lite-preview`` (live, vision; fallbacks below).
- proceed when the agent is >=60% sure of intent; ask ONLY below that or on a
  clear text/image mismatch; MAX 2 clarification rounds, then MUST return a plan.
- the agent recommends EVERYTHING (model id + aspect ratio + quality) freely from
  the live options we inject; the server validates the model id is live and falls
  back to the resolver otherwise.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.config import settings
from app.packs.catalog import Pack
from app.packs.capabilities import (
    registry as capability_registry,
    recommend_models,
    is_eligible,
    TASK_TYPES,
    TASK_REQUIREMENTS,
)
from app.packs.resolver import resolve_image_model, selectable_models as resolver_selectable_models
from app.services.apikeymanager_client import ApiKeyManagerProxyError
from app.services.llm_client import generate_text

logger = logging.getLogger(__name__)

# Locked agent model + fallbacks (text/vision, in the AKM "caption" section).
AGENT_PROVIDER = "google-gemini"
AGENT_MODELS = [
    "gemini-3.1-flash-lite-preview",
    "gemini-2.5-flash",
    "gemini-3-flash-preview",
]

# Max clarification rounds before the agent MUST return a best-effort plan.
MAX_CLARIFY_ROUNDS = 2

_LANG_NAMES = {"ar": "Arabic", "en": "English", "fr": "French"}


# --------------------------------------------------------------------------
# Task taxonomy. The agent FIRST classifies the request into ONE task_type;
# that choice drives the prompt strategy (how much to preserve), the model
# recommendation (matched by capability in capabilities.py) and the aspect
# advice. Names MUST stay in sync with capabilities.TASK_REQUIREMENTS. Ordered
# by owner-set priority (e-commerce core first).
# --------------------------------------------------------------------------
TASK_GUIDE: Dict[str, Dict[str, str]] = {
    "product_in_scene": {
        "use_when": "the user uploaded THEIR product and wants it shown in a scene/setting or a hero shot.",
        "recipe": "PRESERVE the product exactly (shape, label text, colors, proportions); describe the new environment, surface, camera and lighting AROUND it. Never redraw or 'improve' the product.",
    },
    "background_change": {
        "use_when": "keep the same subject/product but change or remove the background.",
        "recipe": "Keep the subject pixel-faithful; replace ONLY the background and re-derive contact shadows/reflections to match the new light. Change nothing on the subject.",
    },
    "edit_previous": {
        "use_when": "a follow-up tweak on the image generated in a previous turn ('make it bigger', 'more blue', 'remove that').",
        "recipe": "Apply ONLY the requested change to the prior image; keep everything else identical.",
    },
    "try_on": {
        "use_when": "put a garment/outfit onto a person (an uploaded model photo or the user's photo).",
        "recipe": "Preserve the person's face/body AND the garment's exact design; fit the garment naturally with correct drape, scale and lighting.",
    },
    "recolor": {
        "use_when": "same product, different color, material or pattern.",
        "recipe": "Keep geometry, label and logo; change ONLY the color/material as asked. Everything else identical.",
    },
    "combine": {
        "use_when": "two or more uploaded images must be merged into one (scene + product + logo, etc.).",
        "recipe": "Name each image by order (image 1, image 2, ...) and state exactly how they assemble, with placement and scale. Render EXACTLY ONE instance of the product - never duplicate the garment/item to fit several designs. Put every design on the SAME visible surface shown in the reference; you cannot show two sides (front and back) in one image, so if a design is meant for a non-visible side, DECISIVELY place it on the visible side instead - no see-through/back-showing tricks, no hedging.",
    },
    "mockup_placeholder": {
        "use_when": "image 1 is a product mockup template with a placeholder ('YOUR IMAGE HERE', dashed box) to fill with a logo/design.",
        "recipe": "Reproduce the mockup scene faithfully (same product, angle, fold, background, lighting); REMOVE the placeholder and place the user's design on the product following its folds/curvature/perspective/lighting. Honor any size/position the user gave. Render exactly ONE product instance on its single visible surface - never duplicate it; if a design is meant for a side not shown, place it on the visible side. Change nothing else.",
    },
    "restyle": {
        "use_when": "re-render an uploaded image in a different medium/style (watercolor, 3D, line art).",
        "recipe": "Keep the subject and composition; change only the medium/style as asked.",
    },
    "inpaint_remove": {
        "use_when": "remove an object, person, blemish or watermark from an uploaded image.",
        "recipe": "Remove ONLY the named element and plausibly fill behind it; keep everything else identical. (Best-effort: no region mask is available.)",
    },
    "reframe": {
        "use_when": "change the aspect/crop of an uploaded image (e.g. square -> portrait for a story).",
        "recipe": "Extend/recompose to the new aspect while keeping the existing subject; do not invent unrelated new objects to fill space.",
    },
    "add_text": {
        "use_when": "the image must contain specific text/typography (slogan, name, label).",
        "recipe": "State the exact text in quotes, its placement and style. Keep it short; only add text the user asked for.",
    },
    "logo_vector": {
        "use_when": "the user wants a logo, icon or flat graphic as crisp vector art.",
        "recipe": "Describe a clean, flat, scalable vector design; simple shapes, limited palette, no photographic detail.",
    },
    "transparent_cutout": {
        "use_when": "the output must have a transparent background (sticker, logo, cutout PNG).",
        "recipe": "Describe the subject only, isolated on a transparent background, clean edges, no scene.",
    },
    "generate": {
        "use_when": "no upload to preserve - create a fresh image from the text (and the mockup_scene if present).",
        "recipe": "Write a full descriptive prompt: subject -> composition -> setting -> lighting -> lens -> style -> palette.",
    },
}


def _task_guide_for_prompt() -> List[Dict[str, str]]:
    """The task taxonomy injected into the agent context (name + when + recipe)."""
    return [
        {"name": name, "use_when": g["use_when"], "recipe": g["recipe"]}
        for name, g in TASK_GUIDE.items()
        if name in TASK_REQUIREMENTS
    ]


# --------------------------------------------------------------------------
# Strict-JSON output schema (used to build the schema prompt + document intent;
# the response is parsed leniently below so a missing field never hard-fails).
# --------------------------------------------------------------------------
class AgentPlan(BaseModel):
    task_type: str = Field(description="The single task category this request fits, copied exactly from the task_types list (e.g. product_in_scene, background_change, combine, generate).")
    final_prompt: str = Field(description="A detailed ENGLISH image prompt fusing the mockup scene with the user's intent (subject, composition, lighting, style).")
    model: str = Field(description="The chosen model id, copied exactly from available_models. Prefer the model whose capabilities best fit the task_type.")
    aspect_ratio: str = Field(description="One of the allowed aspect ratios.")
    quality: Optional[str] = Field(description="One quality option valid for the chosen model, or null when the model has none.")
    image_usage: str = Field(description="Plain note on how each uploaded image is used (empty when no images were provided).")
    summary: str = Field(description="One friendly sentence in the user's language describing what will be generated.")


class AgentResponse(BaseModel):
    status: str = Field(description="Either 'ok' or 'needs_clarification'.")
    clarification: Optional[str] = Field(description="One friendly question in the user's language, only when status is 'needs_clarification'.")
    plan: Optional[AgentPlan] = Field(description="The generation plan, present when status is 'ok'.")


# --------------------------------------------------------------------------
# Live options injected into the agent
# --------------------------------------------------------------------------
def _image_catalog() -> Dict[str, Any]:
    return settings.model_catalog.get("image", {}) or {}


def _model_quality_options(entry: Dict[str, Any]) -> List[str]:
    prices = (((entry or {}).get("billing") or {}).get("image") or {}).get("imageSizePrices") or {}
    return list(prices.keys())


def _model_min_price(entry: Dict[str, Any]) -> Optional[float]:
    prices = (((entry or {}).get("billing") or {}).get("image") or {}).get("imageSizePrices") or {}
    vals: List[float] = []
    for v in prices.values():
        try:
            vals.append(float(v))
        except (TypeError, ValueError):
            continue
    return min(vals) if vals else None


def available_models() -> List[Dict[str, Any]]:
    """The live image models the agent may pick from (the user-selectable set),
    each annotated with CAPABILITIES so the agent matches the model to the task:
    image-input support, reference fidelity, text/typography strength, output kind
    (raster/vector/transparent), photorealism, multi-image support, quality tiers
    and a rough cost. Traits come from the capability registry (AKM catalog +
    curated model_traits.json); the user-selectable set defines who is offered."""
    catalog = _image_catalog()
    reg = capability_registry()
    out: List[Dict[str, Any]] = []
    for m in resolver_selectable_models():
        cap = reg.get(m["id"])
        if not cap:
            continue
        entry = catalog.get(m["id"], {}) or {}
        out.append({
            "id": cap["id"],
            "label": m.get("label") or cap["label"],
            "good_for": cap.get("notes") or (entry.get("description") or "").strip(),
            "accepts_image_input": cap["image_input"],
            "fidelity": cap.get("fidelity"),
            "text": cap.get("text"),
            "output": cap.get("output"),
            "photoreal": cap.get("photoreal"),
            "multi_image": cap.get("multi_image"),
            "quality_options": _model_quality_options(entry),
            "approx_cost": cap.get("cost"),
        })
    return out


def _selectable_ids() -> set[str]:
    return {m["id"] for m in resolver_selectable_models()}


def _all_quality_options(models: List[Dict[str, Any]]) -> List[str]:
    seen: List[str] = []
    for m in models:
        for q in m.get("quality_options") or []:
            if q not in seen:
                seen.append(q)
    return seen


# --------------------------------------------------------------------------
# Scene / prompt context for the pack
# --------------------------------------------------------------------------
def pack_scene(pack: Pack, variant_id: Optional[str]) -> str:
    """The mockup scene the agent must honor: the chosen variant's scene, else the
    pack's freeform default prompt, else empty (the agent leans on the user text)."""
    if variant_id:
        for v in pack.variants:
            if v.id == variant_id:
                return (v.scene or "").strip()
    return (pack.default_prompt or "").strip()


# --------------------------------------------------------------------------
# System prompt (v1, owner-reviewed)
# --------------------------------------------------------------------------
SYSTEM_PROMPT = """You are the Vibecraft generation planner. Your job is to turn a non-expert user's request into a single, ready-to-run image generation plan - or, only when truly necessary, to ask ONE short clarifying question.

You are given:
- task_types: the catalog of task categories. Each has a name, a "use_when" (when it applies) and a "recipe" (how to write the prompt for it). You MUST pick exactly ONE name as task_type - this is your FIRST and most important decision: it decides how you write the prompt and which model fits.
- mockup_scene: the base scene/style for this template. ALWAYS honor it; the user's request refines it, it does not replace it. May be empty.
- available_models: a list of models you may choose from. Each has an id, a label, what it is good_for, and CAPABILITY tags: accepts_image_input (can it edit/use an uploaded image), fidelity (how faithfully it preserves a reference: low..highest), text (typography strength), output (raster/vector/transparent), photoreal, multi_image (can it combine 2+ images), plus quality_options and approx_cost. Pick ONE model by copying its id EXACTLY.
- allowed_aspect_ratios: choose exactly one.
- quality_options: the quality tiers; pick one that is valid for your chosen model, or use null if that model lists none.
- user_language: write the clarification and the summary in this language.
- round and max_rounds: which clarification round this is.
- attached_images: a list describing the images attached, in order (image 1, image 2, ...), each with its original file name. You can SEE the images themselves; they are provided in the same order. The list is empty when none were attached.
- mockup_first: when true, the FIRST attached image is the chosen mockup TEMPLATE for this scene (it usually shows a "YOUR IMAGE HERE" placeholder / dashed box / icon on the product). The remaining images are the user's own design/content.
- recent_conversation: the last few turns in this chat (oldest first), each {role, text}. Use it for CONTINUITY: when the new request is a follow-up like "make it bigger", "change the background to blue", or "same but red", apply it as an edit on top of what was already planned/generated in those turns. The attached images for THIS request are the ones in attached_images (which may include a previously generated image the user chose to reuse).
- The user's free text (the newest request).

How to decide:
1. FIRST pick the task_type. Every request sits on a spectrum from GENERATE-everything-from-text to PRESERVE-the-upload-and-change-one-thing. Read the task_types "use_when" lines and choose the single best fit. Use recent_conversation: a follow-up tweak on a prior generation is "edit_previous".
2. If you are at least 60% confident you understand what the user wants, return status "ok" with a complete plan.
3. Only if you are below 60% confident, OR there is a clear mismatch between the text and the images (e.g. the text says "the t-shirt I uploaded" but the image is a car), return status "needs_clarification" with ONE friendly, specific question in user_language.
4. If round equals max_rounds you MUST return status "ok" with a best-effort plan using whatever the user provided. Do not ask another question.

Plan rules:
- task_type: exactly one name from task_types.
- final_prompt: a detailed ENGLISH image prompt. Apply the RECIPE of your chosen task_type (below) plus the general craft rules. NEVER invent text, logos, slogans or watermarks the user did not ask for.
- model: pick ONE id from available_models that BEST fits the request. IGNORE price entirely - the user sees the price and switches models himself; recommend purely on fit:
    * Hard rule first: if any image is attached the model MUST have accepts_image_input true; logo_vector -> output "vector"; transparent_cutout -> output "transparent".
    * Then choose among the strongest models by the NATURE of this request:
        - Heavy instruction-following / complex reasoning (intricate or multi-step edits, precise object removal, tricky composition) -> the strongest reasoning editor: gpt-image-2.
        - Mainly visual quality on a straightforward edit (recolor, restyle, simple background swap) -> the top quality model: grok quality (grok-imagine-image-quality-editing).
        - BOTH complex reasoning AND high quality (product_in_scene, try_on, combine, mockup_placeholder) -> the best all-rounder: Nano Banana 2 (gemini-3.1-flash-image-preview).
        - Any design that contains TEXT, especially Arabic or other non-Latin script -> Nano Banana 2 (best text rendering).
        - Pure text-to-image with no upload -> a strong photoreal model.
      If your first choice is not in available_models, fall back to the next strongest that fits.
- aspect_ratio: one value from allowed_aspect_ratios. For any task that preserves an uploaded image (editing/placement), choose the ratio CLOSEST to that image's own shape - do NOT pick a tall/wide ratio for a square source, or the model will invent extra content to fill the empty canvas.
- quality: one option valid for your chosen model (favor a middle option when several exist), or null.
- image_usage: a short note, per image and by order, on how each attached image is used (e.g. "image 1: the shirt to print on; image 2: the logo to place"); empty string when none were attached.
- summary: ONE friendly sentence in user_language telling the user what you will generate.

How to write final_prompt (general craft, on top of the task recipe):
- PRESERVE tasks: LEAD with what to keep -> "Keep <the product / the subject / image 1> exactly as in the reference - same shape, identity, label text, colors and lighting. Do not duplicate or reinvent it." Then describe ONLY the change, with concrete position and scale honoring the user's words.
- GENERATE tasks: lead with the SUBJECT, then layer: subject + attributes -> composition & framing (shot, angle, crop) -> setting/background -> lighting -> camera/lens & realism cues ("85mm, shallow depth of field, photorealistic") -> style/medium -> color palette & mood.
- COMPOSITE tasks (2+ images): name each image by order and state exactly how they assemble, with placement and scale.
- Be concrete and visual; specific nouns/adjectives over vague ones. No contradictions, no meta words ("generate", "create"), no negations the model can't act on.
- MOCKUP FIDELITY: when mockup_scene is non-empty (or mockup_first is true) it is GROUND TRUTH for the setting - reproduce its exact scene, surface/props, camera angle, framing and lighting; only insert/replace the user's subject within it. Restate the scene's concrete details. When mockup_first is true, image 1 is the template: completely REMOVE any "YOUR IMAGE HERE" placeholder/box/icon and place the user's design (the next image) there, following the product's folds, curvature, perspective and lighting; change nothing else.
- ONE PRODUCT, ONE SURFACE: render exactly ONE instance of the product as shown - never duplicate the garment/item (e.g. two shirts) to fit multiple designs or to show another side. A single front-facing mockup shows only ONE surface; place ALL designs on that visible surface. If the user names a side that isn't visible (e.g. "on the back" of a front-only shot), DECISIVELY relocate that design onto the visible front instead - do NOT show the back, do NOT use see-through/x-ray/"as if visible through the fabric" effects, do NOT hedge. Just place every design clearly on the one visible surface (e.g. logo on the left chest, the other graphic large and centered on the front).
- OUTPUT FORMAT: end final_prompt with this exact instruction so the image model never replies with just text: "Output exactly one image. Do not reply with text, questions, or multiple images - only the single generated image."

General rules:
- Honor the mockup_scene exactly; respect the user's intent over your own taste.
- Do NOT refuse normal requests. For a clearly abusive or disallowed request, return status "needs_clarification" with a brief, polite decline in user_language (a separate safety system does the real enforcement).
- SAFETY: never elaborate a request into nudity, sexual content, or other disallowed content in final_prompt. If the request implies this, keep final_prompt brief and non-explicit and let the safety system decide - do not add explicit visual detail the user did not ask for.

Output STRICT JSON ONLY, no markdown fences, exactly this shape:
{"status":"ok"|"needs_clarification","clarification":"<question in user_language, only when needed>","plan":{"task_type":"<one task_types name>","final_prompt":"<english>","model":"<id from available_models>","aspect_ratio":"<one allowed>","quality":"<one option or null>","image_usage":"<how each image is used>","summary":"<one line in user_language>"}}"""


def _build_prompt(
    pack: Pack,
    *,
    scene: str,
    user_text: str,
    models: List[Dict[str, Any]],
    ratios: List[str],
    quality_options: List[str],
    lang: str,
    round_no: int,
    max_rounds: int,
    attached_images: List[Dict[str, Any]],
    mockup_first: bool = False,
    history: Optional[List[Dict[str, str]]] = None,
) -> str:
    context = {
        "task_types": _task_guide_for_prompt(),
        "mockup_scene": scene or "",
        "available_models": models,
        "allowed_aspect_ratios": ratios,
        "quality_options": quality_options,
        "user_language": _LANG_NAMES.get(lang, "English"),
        "round": round_no,
        "max_rounds": max_rounds,
        "attached_images": attached_images,
        "mockup_first": mockup_first,
        "recent_conversation": history or [],
        "user_text": (user_text or "").strip(),
    }
    return (
        f"{SYSTEM_PROMPT}\n\n"
        "Here is the request context as JSON:\n"
        f"{json.dumps(context, ensure_ascii=False, indent=2)}\n\n"
        "The attached images themselves (if any) are provided alongside this "
        "message, in the same order as the attached_images list."
    )


_HISTORY_LIMIT = 5


def _clean_history(history: Optional[List[Dict[str, Any]]]) -> List[Dict[str, str]]:
    """Keep the most recent turns (<= _HISTORY_LIMIT), normalized to {role, text}."""
    out: List[Dict[str, str]] = []
    for turn in (history or []):
        if not isinstance(turn, dict):
            continue
        role = "assistant" if str(turn.get("role")) == "assistant" else "user"
        text = str(turn.get("text") or "").strip()
        if text:
            out.append({"role": role, "text": text[:2000]})
    return out[-_HISTORY_LIMIT:]


def _describe_attached_images(image_refs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """An ordered, agent-facing description of the uploads so the model can map
    each visible image to a role (image 1 = ..., image 2 = ...)."""
    out: List[Dict[str, Any]] = []
    for i, ref in enumerate(image_refs):
        name = ""
        if isinstance(ref, dict):
            name = str(ref.get("name") or "").strip()
        out.append({"index": i + 1, "name": name or f"image {i + 1}"})
    return out


# --------------------------------------------------------------------------
# Response parsing + validation
# --------------------------------------------------------------------------
def _parse_response(raw: str) -> Optional[Dict[str, Any]]:
    if not raw:
        return None
    clean = raw.replace("```json", "").replace("```", "").strip()
    # Be forgiving of leading/trailing prose: grab the outermost JSON object.
    start, end = clean.find("{"), clean.rfind("}")
    if start != -1 and end != -1 and end > start:
        clean = clean[start:end + 1]
    try:
        data = json.loads(clean)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _coerce_str(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _validate_plan(
    pack: Pack,
    raw_plan: Dict[str, Any],
    *,
    scene: str,
    user_text: str,
    has_image: bool,
    models: List[Dict[str, Any]],
    n_images: int = 0,
) -> Dict[str, Any]:
    """Clamp the agent's plan to live, valid choices. The capability recommender
    is the safety net: an off-task or disabled model id is replaced by the
    best-fit RECOMMENDATION for the task (the user can still override later),
    and the resolver remains the final fallback so a pack never dead-ends."""
    selectable = _selectable_ids()
    catalog = _image_catalog()

    # Task type: honor a valid pick, else infer a safe default (an image-input
    # edit when there's an upload to use, otherwise plain generation).
    task_type = _coerce_str(raw_plan.get("task_type"))
    if task_type not in TASK_TYPES:
        task_type = "product_in_scene" if has_image else "generate"

    # Model: honor the agent's pick only when it is live, selectable AND eligible
    # for the task; otherwise take the top capability recommendation (restricted
    # to the pack's selectable set), then the resolver as a last resort.
    model = _coerce_str(raw_plan.get("model"))
    if not (model and model in selectable and model in catalog
            and is_eligible(model, task_type, n_images=n_images)):
        recs = [m["id"] for m in recommend_models(task_type, n_images=n_images)
                if m["id"] in selectable]
        model = (recs[0] if recs else resolve_image_model(pack.capability, has_image=has_image)) or ""

    # Hard technical guard: when images are attached the model MUST accept image
    # input, or the uploads are silently ignored. Re-pick the cheapest live
    # image-input model if needed.
    if has_image and model:
        cap = capability_registry().get(model) or {}
        if not cap.get("image_input"):
            img_models = sorted(
                (m for m in capability_registry().values()
                 if m["image_input"] and m["id"] in selectable),
                key=lambda m: m["cost"] if m.get("cost") is not None else 9e9,
            )
            if img_models:
                model = img_models[0]["id"]

    # Aspect ratio: must be one the pack allows.
    ratio = _coerce_str(raw_plan.get("aspect_ratio"))
    if ratio not in pack.aspect_ratios:
        ratio = pack.aspect_ratios[0] if pack.aspect_ratios else None

    # Quality: must be a tier the chosen model actually offers, else null.
    quality = _coerce_str(raw_plan.get("quality"))
    model_quality = _model_quality_options(catalog.get(model, {})) if model else []
    if quality not in model_quality:
        quality = None

    final_prompt = _coerce_str(raw_plan.get("final_prompt"))
    if len(final_prompt) < 3:
        final_prompt = " ".join(p for p in [scene, user_text] if p).strip() or scene or user_text

    return {
        "task_type": task_type,
        "final_prompt": final_prompt,
        "model": model or None,
        "aspect_ratio": ratio,
        "quality": quality,
        "image_usage": _coerce_str(raw_plan.get("image_usage")),
        "summary": _coerce_str(raw_plan.get("summary")),
    }


def _fallback_plan(
    pack: Pack,
    *,
    scene: str,
    user_text: str,
    has_image: bool,
) -> Dict[str, Any]:
    """Deterministic best-effort plan used when the agent is unreachable or
    returns unparseable output - the studio must never dead-end."""
    task_type = "product_in_scene" if has_image else "generate"
    # Default to the strongest recommended model for the task (price-free), not
    # the resolver's cheapest pick - the resolver is only the last resort.
    recs = [m["id"] for m in recommend_models(task_type) if m["id"] in _selectable_ids()]
    fb_model = (recs[0] if recs else resolve_image_model(pack.capability, has_image=has_image)) or None
    return {
        "task_type": task_type,
        "final_prompt": " ".join(p for p in [scene, user_text] if p).strip() or scene or user_text,
        "model": fb_model,
        "aspect_ratio": pack.aspect_ratios[0] if pack.aspect_ratios else None,
        "quality": None,
        "image_usage": "All attached images used as visual references, in order." if has_image else "",
        "summary": "",
    }


# --------------------------------------------------------------------------
# Public entry point
# --------------------------------------------------------------------------
def build_plan(
    pack: Pack,
    *,
    user_text: str,
    image_refs: Optional[List[Dict[str, Any]]],
    lang: str = "ar",
    variant_id: Optional[str] = None,
    round_no: int = 1,
    mockup_first: bool = False,
    history: Optional[List[Dict[str, Any]]] = None,
    uid: str = "",
) -> Dict[str, Any]:
    """Run the planning agent for one request.

    Returns either::

        {"status": "needs_clarification", "clarification": "...", "round": n, "max_rounds": 2}

    or::

        {"status": "ok", "plan": {...}, "round": n, "max_rounds": 2, "blocked": bool}

    FREE - no credits are reserved or charged here.
    """
    image_refs = image_refs or []
    has_image = bool(image_refs)
    max_rounds = MAX_CLARIFY_ROUNDS
    round_no = max(1, min(int(round_no or 1), max_rounds))

    scene = pack_scene(pack, variant_id)
    models = available_models()
    ratios = list(pack.aspect_ratios or [])
    quality_options = _all_quality_options(models)
    attached_images = _describe_attached_images(image_refs)
    mockup_first = bool(mockup_first and image_refs)
    recent_history = _clean_history(history)

    # Screen the RAW user text before it gets embedded in the planning prompt
    # below: a large template (persona + task taxonomy + catalog) can dilute
    # AKM's moderation score for a short explicit ask enough that it no longer
    # trips, even though the same raw phrase alone would be blocked. Cheap,
    # near-zero-token call purely to get the raw text in front of AKM's input
    # moderation; the existing content_blocked check below on the designed
    # prompt still runs unchanged.
    if user_text and user_text.strip():
        try:
            generate_text(AGENT_PROVIDER, AGENT_MODELS[0], user_text, options={"maxTokens": 10})
        except ApiKeyManagerProxyError as exc:
            if exc.error_type == "content_blocked":
                from app.services.security_backend import record_moderation_rejection
                ban_result = record_moderation_rejection(
                    uid,
                    f"packs_plan_raw:{pack.id}",
                    exc.code,
                    moderation=getattr(exc, "moderation", None),
                )
                return {
                    "status": "needs_clarification",
                    "clarification": _decline_message(lang),
                    "round": round_no,
                    "max_rounds": max_rounds,
                    "moderation_ban": ban_result,
                }
            if exc.error_type == "moderation_unavailable":
                # AKM's moderation backend itself is unreachable: we cannot know
                # whether the raw text is safe, so fail closed (not a user
                # violation - no strike) instead of silently proceeding to the
                # designed-prompt call, which would fail the exact same way.
                logger.error("Pack agent raw-prompt pre-check: moderation unavailable")
                return {
                    "status": "moderation_unavailable",
                    "round": round_no,
                    "max_rounds": max_rounds,
                }
            # Any other error (timeout, provider hiccup) on this cheap pre-check:
            # don't hard-fail planning over infra noise; the real generation-time
            # gate still enforces below regardless.
            logger.warning("Pack agent raw-prompt pre-check errored (non-moderation): %s", exc)

    prompt = _build_prompt(
        pack,
        scene=scene,
        user_text=user_text,
        models=models,
        ratios=ratios,
        quality_options=quality_options,
        lang=lang,
        round_no=round_no,
        max_rounds=max_rounds,
        attached_images=attached_images,
        mockup_first=mockup_first,
        history=recent_history,
    )

    # Only models live in the catalog's caption section can be called.
    caption_catalog = settings.model_catalog.get("caption", {}) or {}
    candidate_models = [m for m in AGENT_MODELS if m in caption_catalog] or AGENT_MODELS

    raw: Optional[str] = None
    blocked = False
    moderation_unavailable = False
    ban_result: Optional[Dict[str, Any]] = None
    for index, model_id in enumerate(candidate_models):
        try:
            raw = generate_text(
                AGENT_PROVIDER,
                model_id,
                prompt,
                response_schema=AgentResponse,
                input_images=image_refs or None,
            )
            if raw and raw.strip():
                break
        except ApiKeyManagerProxyError as exc:
            if exc.error_type == "content_blocked":
                # The agent is not the safety system; decline gently and let the
                # real moderation gate enforce at generation time. Do not retry.
                # Still counts as a strike toward the ban ladder, same as a
                # content_blocked rejection at actual /generate time.
                from app.services.security_backend import record_moderation_rejection
                ban_result = record_moderation_rejection(
                    uid,
                    f"packs_plan:{pack.id}:{model_id}",
                    exc.code,
                    moderation=getattr(exc, "moderation", None),
                )
                blocked = True
                break
            if exc.error_type == "moderation_unavailable":
                # Moderation is shared infrastructure, not a per-model concern:
                # if AKM's moderation backend is down, every other candidate
                # model will fail the exact same way. Stop immediately instead
                # of burning 2 more doomed calls; fail closed below rather
                # than silently serving an unscreened fallback plan.
                moderation_unavailable = True
                logger.warning("Pack agent model failed (%s): %s", model_id, exc)
                break
            logger.warning("Pack agent model failed (%s): %s", model_id, exc)
            continue
        except Exception as exc:  # noqa: BLE001 - never let planning hard-fail the studio
            logger.warning("Pack agent model errored (%s): %s", model_id, exc)
            continue

    if not blocked and not raw and moderation_unavailable:
        logger.error("Pack agent: moderation unavailable across all candidate models")
        return {
            "status": "moderation_unavailable",
            "round": round_no,
            "max_rounds": max_rounds,
        }

    if blocked:
        return {
            "status": "needs_clarification",
            "clarification": _decline_message(lang),
            "round": round_no,
            "max_rounds": max_rounds,
            "moderation_ban": ban_result,
        }

    parsed = _parse_response(raw or "")

    # Agent asked a question and we still have rounds left -> relay it.
    if (
        parsed
        and str(parsed.get("status")) == "needs_clarification"
        and round_no < max_rounds
    ):
        question = _coerce_str(parsed.get("clarification"))
        if question:
            return {
                "status": "needs_clarification",
                "clarification": question,
                "round": round_no,
                "max_rounds": max_rounds,
            }

    # Otherwise we must produce a plan (forced on the last round / on parse miss).
    raw_plan = parsed.get("plan") if (parsed and isinstance(parsed.get("plan"), dict)) else None
    if raw_plan:
        plan = _validate_plan(
            pack, raw_plan, scene=scene, user_text=user_text, has_image=has_image,
            models=models, n_images=len(image_refs),
        )
    else:
        plan = _fallback_plan(pack, scene=scene, user_text=user_text, has_image=has_image)

    return {
        "status": "ok",
        "plan": plan,
        "round": round_no,
        "max_rounds": max_rounds,
    }


_DECLINE = {
    "ar": "عذرًا، لا يمكنني تنفيذ هذا الطلب. جرّب فكرة أخرى من فضلك.",
    "fr": "Désolé, je ne peux pas traiter cette demande. Essayez une autre idée.",
    "en": "Sorry, I can't help with that request. Please try a different idea.",
}


def _decline_message(lang: str) -> str:
    return _DECLINE.get(lang, _DECLINE["en"])
