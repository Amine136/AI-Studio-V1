import base64
import json
import logging
import traceback
from typing import Dict, Any, List

from app.core.state import StudioState, ContentSpec, OutputType
from app.config import settings
from app.graph.plugins import PLUGIN_REGISTRY
from app.services.llm_client import generate_text, generate_text_payload
from app.services.image_client import generate_image_url, generate_image_and_text, generate_image_and_text_payload, generate_image_payload
from app.services.sanitizer import sanitize_user_text
from app.services.user_files import load_private_user_file, private_file_id_from_url
from app.core.schema import IntentAnalysis

# Configure logger
logger = logging.getLogger("studio.workflow")
logger.setLevel(logging.INFO)

GENERATE_PARAMETER_OPTION_KEY_MAP = {
    "temperature": "temperature",
    "topP": "topP",
    "maxOutputTokens": "maxTokens",
    "thinkingBudget": "thinkingBudget",
    "thinkingLevel": "thinkingLevel",
    "presencePenalty": "presencePenalty",
    "frequencyPenalty": "frequencyPenalty",
    "mediaResolution": "mediaResolution",
    "imageSize": "imageSize",
    "sampleImageSize": "sampleImageSize",
    "aspectRatio": "aspectRatio",
    "seed": "seed",
    "addWatermark": "addWatermark",
    "enhancePrompt": "enhancePrompt",
    "outputMimeType": "outputMimeType",
}


def _build_caption_fallback_image_input(image_url: str, owner_uid: str) -> Dict[str, str]:
    file_id = private_file_id_from_url(image_url)
    if not file_id:
        return {"url": image_url}

    file_record, filepath = load_private_user_file(file_id, owner_uid)
    return {
        "mime_type": str(file_record["mime_type"] or "image/png"),
        "data": base64.b64encode(filepath.read_bytes()).decode("ascii"),
    }

# ---------------------------------------------------------
# Helper: Merging Logic
# ---------------------------------------------------------

def compile_final_spec(state: StudioState) -> ContentSpec:
    spec = {}
    intent = state.get("extracted_intent", {})
    if "obligatory" in intent: spec.update(intent["obligatory"])
    if "ai_suggestion" in intent: spec.update(intent["ai_suggestion"])
    if state.get("user_corrections"):
        spec.update(state["user_corrections"])
    
    # Per-content prompts: user-edited > AI-generated > raw user text
    hidden = intent.get("hidden_params", {})
    corrections = state.get("user_corrections", {})
    fallback_text = state.get("user_text", "")
    
    # Image prompt
    spec["image_prompt"] = (
        corrections.get("image_prompt")
        or hidden.get("image_prompt")
        or fallback_text
    )
    # Caption prompt
    spec["caption_prompt"] = (
        corrections.get("caption_prompt")
        or hidden.get("caption_prompt")
        or fallback_text
    )
    # Keep user_text for backward compat
    spec["user_text"] = spec["caption_prompt"]
    
    # Inject language from hidden_params
    if hidden.get("language"):
        spec["language"] = hidden["language"]
    return spec

# ---------------------------------------------------------
# Nodes
# ---------------------------------------------------------

def ingest_input(state: StudioState) -> StudioState:
    logger.info("📥 [Step 1/6] INGEST: Processing user input...")
    
    user_text = state.get("user_text", "")
    if not user_text:
        logger.warning("   └─ ⚠️ No text provided")
        return {"final_response": {"status": "error", "message": "No text provided"}}
    
    # Sanitize user input against prompt injection
    user_text = sanitize_user_text(user_text)
    
    req_outputs = state.get("requested_outputs") or ["image", "caption"]
    user_prefs = state.get("user_preferences", {})
    input_images = state.get("input_images") or []
    model_parameters = state.get("model_parameters", {})
    
    # Status Logic
    current_status = state.get("status")
    next_status = "generating" if current_status == "generating" else "processing"
    
    logger.info(f"   └─ ✅ Text received ({len(user_text)} chars) | Outputs: {req_outputs}")
    
    return {
        "user_text": user_text,
        "requested_outputs": req_outputs,
        "input_images": input_images,
        "user_preferences": user_prefs,
        "model_parameters": model_parameters,
        "status": next_status
    }


def assign_models(state: StudioState) -> StudioState:
    """Safely map user tasks to models."""
    logger.info("🎯 [Step 2/6] ASSIGN MODELS: Selecting AI models...")
    
    requested = state.get("requested_outputs", [])
    user_prefs = state.get("user_preferences", {})
    assignments = {}

    for task in requested:
        # 1. User Choice
        user_choice = user_prefs.get(f"{task}_model") or user_prefs.get(task)
        
        # 2. Get Valid Models (Safe Access)
        valid_models = settings.model_catalog.get(task, {})
        
        # 3. Assign
        if user_choice and user_choice in valid_models:
            assignments[task] = user_choice
        elif valid_models:
            assignments[task] = next(iter(valid_models))
        else:
            assignments[task] = settings.default_mock_model  # Fallback if catalog broken

    for task, model in assignments.items():
        logger.info(f"   ├─ {task}: {model}")
    logger.info("   └─ ✅ Models assigned")
    
    return {"assigned_models": assignments}


def analyze_intent(state: StudioState) -> StudioState:
    if state.get("status") == "generating":
        logger.info("🧠 [Step 3/6] ANALYZE INTENT: Skipped (already approved)")
        return {} 

    logger.info("🧠 [Step 3/6] ANALYZE INTENT: Understanding user request...")
    
    user_text = state["user_text"]
    input_images = state.get("input_images") or []
    system_llm_model = settings.system_llm_model 
    
    # We still pass the options so Gemini knows *what* values to pick
    vocab_str = json.dumps(settings.field_options, indent=2)
    
    # Load prompt
    raw_template = settings.prompts.get("analyze_intent", "")
    if raw_template:
        prompt = raw_template.format(user_text=user_text, vocab_options=vocab_str)
    else:
        prompt = f"Analyze: {user_text}. Options: {vocab_str}."
    
    logger.info(f"   ├─ Using model: {system_llm_model}")
    
    # CALL WITH SCHEMA ENFORCEMENT
    raw_response = generate_text(
        settings.system_llm_provider, 
        system_llm_model, 
        prompt, 
        response_schema=IntentAnalysis,
        input_images=input_images,
    )
    
    try:
        clean_json = raw_response.replace("```json", "").replace("```", "").strip()
        extracted_data = json.loads(clean_json)
        logger.info("   └─ ✅ Intent extracted successfully")
    except Exception as e:
        logger.warning(f"   └─ ⚠️ JSON Parse Error: {e}")
        extracted_data = {}

    return {"extracted_intent": extracted_data}


def prepare_ui_for_review(state: StudioState) -> StudioState:
    logger.info("📝 [Step 4/6] PREPARE UI: Building review schema...")
    
    current_spec = compile_final_spec(state)
    ui_schema = {}  # Now grouped by output type: {"caption": {...}, "image": {...}}
    
    requested = state.get("requested_outputs", [])
    
    for out in requested:
        if out not in PLUGIN_REGISTRY:
            continue
            
        plugin = PLUGIN_REGISTRY[out]
        output_fields = {}
        
        # Get options for this specific output type
        type_options = settings.field_options.get(out, {})
        
        # Build fields for this output type
        all_fields = plugin.required_fields + plugin.optional_fields
        for key in all_fields:
            options = type_options.get(key, [])
            category = "obligatory" if key in plugin.required_fields else "ai_suggestion"
            # Add "None" option to AI suggestion fields so users can deselect
            if category == "ai_suggestion" and "None" not in options:
                options = ["None"] + options
            output_fields[key] = {
                "label": key.replace("_", " ").title(),
                "value": current_spec.get(key),
                "options": options,
                "category": category
            }
        
        ui_schema[out] = output_fields
        logger.info(f"   ├─ {out}: {len(output_fields)} fields")
    
    # Extract per-content AI prompts to send to frontend
    intent = state.get("extracted_intent", {})
    hidden = intent.get("hidden_params", {})
    fallback = state.get("user_text", "")
    content_prompts = {
        "image_prompt": hidden.get("image_prompt", fallback),
        "caption_prompt": hidden.get("caption_prompt", fallback),
    }
    
    if state.get("status") == "generating":
        logger.info("   └─ ✅ Proceeding to generation")
        return {"ui_schema": ui_schema, "content_prompts": content_prompts}
    else:
        logger.info("   └─ ⏸️  Awaiting user review")
        return {"ui_schema": ui_schema, "content_prompts": content_prompts, "status": "awaiting_review"}


def build_generation_plan(state: StudioState) -> StudioState:
    logger.info("📋 [Step 5/6] BUILD PLAN: Creating generation requests...")
    
    final_spec = compile_final_spec(state)
    assignments = state.get("assigned_models", {})
    requests = []

    for out in state["requested_outputs"]:
        if out in PLUGIN_REGISTRY:
            plugin = PLUGIN_REGISTRY[out]
            try:
                plugin_reqs = plugin.build_requests(final_spec)
                
                model_id = assignments.get(out, "mock-default")
                for req in plugin_reqs:
                    req["model_name"] = model_id
                    requests.append(req)
                logger.info(f"   ├─ {out}: {len(plugin_reqs)} request(s)")
            except Exception as e:
                logger.error(f"   ├─ ❌ Plugin Build Error ({out}): {e}")

    logger.info(f"   └─ ✅ Plan ready: {len(requests)} total requests")
    
    return {
        "content_spec": final_spec,
        "model_requests": requests,
        "status": "generating"
    }


def execute_generation(state: StudioState) -> StudioState:
    """Node 6: The Dispatcher."""
    logger.info("🚀 [Step 6/6] EXECUTE: Running AI generation...")
    
    generated = {}
    failures: list[str] = []
    total_cost = 0.0
    billing_components: list[dict[str, Any]] = []
    total_requests = len(state.get("model_requests", []))
    input_images = state.get("input_images") or []
    requested_outputs = state.get("requested_outputs", [])
    assigned_models = state.get("assigned_models", {})
    content_spec = state.get("content_spec", {})
    model_parameters = state.get("model_parameters", {})
    owner_uid = str(state.get("owner_uid") or "")

    shared_multimodal_model = (
        input_images
        and "caption" in requested_outputs
        and "image" in requested_outputs
        and assigned_models.get("caption")
        and assigned_models.get("caption") == assigned_models.get("image")
    )

    if shared_multimodal_model:
        model_name = assigned_models["image"]
        model_config = settings.model_catalog.get("image", {}).get(model_name) or settings.model_catalog.get("caption", {}).get(model_name)
        if not model_config:
            return {
                "generated_assets": {
                    "caption": f"Error: Model {model_name} not found.",
                    "image": f"Error: Model {model_name} not found.",
                },
                "total_cost": 0,
                "status": "complete",
            }

        provider = model_config.get("provider", "mock")
        model_id = model_config.get("model_id", "default")
        multimodal_prompt = _build_shared_multimodal_prompt(content_spec)
        logger.info(f"   ├─ [1/1] multimodal bundle via {provider}...")

        try:
            image_params = _normalize_generation_model_parameters(
                "image",
                model_name,
                model_config,
                model_parameters.get("image"),
            )
            caption_params = _normalize_generation_model_parameters(
                "caption",
                model_name,
                model_config,
                model_parameters.get("caption"),
            )
            merged_options = {
                **image_params.get("options", {}),
                **caption_params.get("options", {}),
            }
            merged_image_config = {
                **image_params.get("image_config", {}),
                **caption_params.get("image_config", {}),
            }
            bundle = generate_image_and_text_payload(
                provider,
                model_id,
                multimodal_prompt,
                owner_uid=owner_uid,
                image_config={
                    "aspect_ratio": content_spec.get("aspect_ratio", "16:9"),
                    **merged_image_config,
                },
                input_images=input_images,
                options=merged_options,
            )
            generated["image"] = bundle.get("image", "")
            generated["caption"] = bundle.get("text", "")
            request_cost = _parse_resolved_cost(bundle.get("resolvedCost"))
            total_cost += request_cost
            billing_components.append(
                {
                    "task": "multimodal_bundle",
                    "provider": bundle.get("provider") or provider,
                    "model": bundle.get("model") or model_id,
                    "billingMode": bundle.get("billingMode"),
                    "resolvedCost": request_cost,
                    "usage": bundle.get("usage") or {},
                    "billing": bundle.get("billing") or {},
                }
            )
            if "caption" in requested_outputs and not str(generated.get("caption") or "").strip() and str(generated.get("image") or "").strip():
                logger.info("   │  ├─ Shared multimodal returned no text; requesting fallback caption from generated image...")
                base_fallback_prompt = str(content_spec.get("caption_prompt") or "").strip() or (
                    "Write a concise description of the generated image."
                )
                fallback_prompt = (
                    f"{base_fallback_prompt}\n\n"
                    "Base the caption on the generated image itself. "
                    "Return only the final caption text."
                )
                try:
                    fallback_caption = generate_text_payload(
                        provider,
                        model_id,
                        fallback_prompt,
                        input_images=[_build_caption_fallback_image_input(str(generated["image"]), owner_uid)],
                        options=caption_params.get("options") or {},
                    )
                    generated["caption"] = fallback_caption.get("text", "")
                    fallback_cost = _parse_resolved_cost(fallback_caption.get("resolvedCost"))
                    total_cost += fallback_cost
                    billing_components.append(
                        {
                            "task": "caption_fallback",
                            "provider": fallback_caption.get("provider") or provider,
                            "model": fallback_caption.get("model") or model_id,
                            "billingMode": fallback_caption.get("billingMode"),
                            "resolvedCost": fallback_cost,
                            "usage": fallback_caption.get("usage") or {},
                            "billing": fallback_caption.get("billing") or {},
                        }
                    )
                    logger.info("   │  └─ ✅ Fallback caption request succeeded")
                except Exception as fallback_error:
                    logger.warning(f"   │  ├─ ⚠️ Image-based fallback caption failed: {fallback_error}")
                    text_only_prompt = (
                        f"{base_fallback_prompt}\n\n"
                        "The generated image was delivered successfully, but you cannot inspect it in this fallback. "
                        "Write a concise caption based only on the creative brief. Return only the caption text."
                    )
                    try:
                        fallback_caption = generate_text_payload(
                            provider,
                            model_id,
                            text_only_prompt,
                            options=caption_params.get("options") or {},
                        )
                        generated["caption"] = fallback_caption.get("text", "")
                        fallback_cost = _parse_resolved_cost(fallback_caption.get("resolvedCost"))
                        total_cost += fallback_cost
                        billing_components.append(
                            {
                                "task": "caption_text_only_fallback",
                                "provider": fallback_caption.get("provider") or provider,
                                "model": fallback_caption.get("model") or model_id,
                                "billingMode": fallback_caption.get("billingMode"),
                                "resolvedCost": fallback_cost,
                                "usage": fallback_caption.get("usage") or {},
                                "billing": fallback_caption.get("billing") or {},
                            }
                        )
                        logger.info("   │  └─ ✅ Text-only fallback caption request succeeded")
                    except Exception as text_fallback_error:
                        logger.warning(f"   │  └─ ⚠️ Text-only fallback caption failed: {text_fallback_error}")
                        generated["caption"] = base_fallback_prompt
            logger.info("   │  └─ ✅ Shared multimodal request succeeded")
            return {
                "generated_assets": generated,
                "total_cost": total_cost,
                "billing_components": billing_components,
                "status": "complete",
            }
        except Exception as e:
            error_msg = str(e)
            failures.append(f"multimodal bundle failed: {error_msg}")
            logger.error(f"   │  └─ ❌ Generation failed: {error_msg}")
            traceback.print_exc()
            return {
                "generated_assets": {},
                "total_cost": 0,
                "status": "error",
                "error_message": "We couldn't deliver the generated result. No credits were charged.",
                "failure_reason": "; ".join(failures),
            }
    
    for idx, req in enumerate(state.get("model_requests", []), 1):
        task_type = req["output_key"]
        model_name = req["model_name"]
        prompt = req["prompt"]
        
        # --- ROBUST CONFIG LOOKUP ---
        task_config = settings.model_catalog.get(task_type, {})
        model_config = task_config.get(model_name)
        
        if not model_config:
            error_msg = f"Model config missing for {task_type}:{model_name}"
            logger.warning(f"   ├─ ⚠️ [{idx}/{total_requests}] {error_msg}")
            failures.append(error_msg)
            continue
            
        provider = model_config.get("provider", "mock")
        model_id = model_config.get("model_id", "default")
        
        logger.info(f"   ├─ [{idx}/{total_requests}] {task_type} via {provider}...")

        try:
            if task_type == "image":
                model_type = model_config.get("type", "")
                param_config = _normalize_generation_model_parameters(
                    task_type,
                    model_name,
                    model_config,
                    model_parameters.get(task_type),
                )
                image_config = {
                    **req.get("metadata", {}),
                    **param_config.get("image_config", {}),
                }
                result_payload = generate_image_payload(
                    provider,
                    model_id,
                    prompt,
                    owner_uid=owner_uid,
                    model_type=model_type,
                    image_config=image_config,
                    input_images=input_images,
                    options=param_config.get("options"),
                )
                result = result_payload.get("image", "")
            else:
                param_config = _normalize_generation_model_parameters(
                    task_type,
                    model_name,
                    model_config,
                    model_parameters.get(task_type),
                )
                result_payload = generate_text_payload(
                    provider,
                    model_id,
                    prompt,
                    input_images=input_images,
                    options=param_config.get("options"),
                )
                result = result_payload.get("text", "")
            
            generated[task_type] = result
            request_cost = _parse_resolved_cost(result_payload.get("resolvedCost"))
            total_cost += request_cost
            billing_components.append(
                {
                    "task": task_type,
                    "provider": result_payload.get("provider") or provider,
                    "model": result_payload.get("model") or model_id,
                    "billingMode": result_payload.get("billingMode"),
                    "resolvedCost": request_cost,
                    "usage": result_payload.get("usage") or {},
                    "billing": result_payload.get("billing") or {},
                }
            )
            logger.info(f"   │  └─ ✅ Success")
            
        except Exception as e:
            error_msg = str(e)
            failures.append(f"{task_type} generation failed: {error_msg}")
            logger.error(f"   │  └─ ❌ Generation failed: {error_msg}")
            traceback.print_exc()
            continue

    missing_outputs = [task for task in requested_outputs if not generated.get(task)]
    if failures or missing_outputs:
        if missing_outputs:
            failures.append(f"missing outputs: {', '.join(missing_outputs)}")
        logger.warning("   └─ ⚠️ Delivery failed before completion")
        return {
            "generated_assets": generated,
            "total_cost": 0,
            "status": "error",
            "error_message": "We couldn't deliver the generated result. No credits were charged.",
            "failure_reason": "; ".join(failures),
        }

    logger.info(f"   └─ 🎉 Generation complete: {len(generated)} assets | Total cost: {total_cost} credits")
    
    return {
        "generated_assets": generated,
        "total_cost": total_cost,
        "billing_components": billing_components,
        "status": "complete"
    }


def _parse_resolved_cost(raw_cost: Any) -> float:
    try:
        return round(float(raw_cost or 0), 6)
    except (TypeError, ValueError):
        return 0.0


def _build_shared_multimodal_prompt(content_spec: ContentSpec) -> str:
    image_prompt = content_spec.get("image_prompt") or content_spec.get("user_text", "")
    caption_prompt = content_spec.get("caption_prompt") or content_spec.get("user_text", "")
    language = content_spec.get("language", "English")
    return (
        "Use the provided image and user instructions to produce both outputs in one pass.\n"
        "1. Generate an edited/new image that follows this visual direction:\n"
        f"{image_prompt}\n\n"
        "2. Generate a social-media-ready caption that follows this writing direction:\n"
        f"{caption_prompt}\n\n"
        f"Write the caption in {language}. Return both the image and the caption text."
    )


def _normalize_generation_model_parameters(
    task_name: str,
    model_name: str,
    model_entry: Dict[str, Any],
    raw_params: Dict[str, Any] | None,
) -> Dict[str, Dict[str, Any]]:
    parameter_schema = settings.get_model_parameter_schema(model_name, model_entry)
    params = raw_params if isinstance(raw_params, dict) else {}
    if task_name == "image":
        params = {
            **_default_image_size_parameters(parameter_schema),
            **params,
        }
    if not params:
        return {"options": {}, "image_config": {}}

    normalized_options: Dict[str, Any] = {}
    normalized_image_config: Dict[str, Any] = {}

    for schema_key, raw_value in params.items():
        if schema_key not in parameter_schema:
            continue
        option_key = GENERATE_PARAMETER_OPTION_KEY_MAP.get(schema_key)
        if not option_key:
            continue

        if option_key == "maxTokens":
            normalized_options[option_key] = int(raw_value)
        elif option_key in {"temperature", "topP", "presencePenalty", "frequencyPenalty"}:
            normalized_options[option_key] = float(raw_value)
        elif option_key in {"thinkingBudget", "seed"}:
            normalized_options[option_key] = int(raw_value)
        elif option_key in {"addWatermark", "enhancePrompt"}:
            normalized_options[option_key] = bool(raw_value)
        elif option_key == "thinkingLevel":
            normalized_options[option_key] = str(raw_value).strip().upper()
        elif option_key == "mediaResolution":
            normalized_options[option_key] = str(raw_value).strip().lower()
        else:
            normalized_options[option_key] = str(raw_value).strip()

    aspect_ratio = normalized_options.get("aspectRatio")
    if isinstance(aspect_ratio, str) and aspect_ratio:
        normalized_image_config["aspect_ratio"] = aspect_ratio

    return {"options": normalized_options, "image_config": normalized_image_config}


def _default_image_size_parameters(parameter_schema: Dict[str, Any]) -> Dict[str, Any]:
    defaults: Dict[str, Any] = {}
    for key in ("sampleImageSize", "imageSize"):
        entry = parameter_schema.get(key)
        if not isinstance(entry, dict):
            continue
        value = entry.get("recommendedDefault")
        if value is None:
            value = entry.get("default")
        if value is None:
            value = entry.get("value")
        values = entry.get("values")
        if value is None and isinstance(values, list) and any(str(item).strip().upper() == "1K" for item in values):
            value = "1K"
        if value is not None:
            defaults[key] = value
    return defaults


def format_delivery(state: StudioState) -> StudioState:
    logger.info("📦 DELIVER: Formatting final response...")
    logger.info("   └─ ✅ Done!")

    if state.get("status") == "error":
        return {
            "final_response": {
                "status": "error",
                "results": None,
                "meta": {
                    "error_message": state.get("error_message") or "We couldn't deliver the generated result. No credits were charged.",
                    "failure_reason": state.get("failure_reason"),
                },
            }
        }

    return {
            "final_response": {
                "status": "success",
                "results": state.get("generated_assets"),
                "meta": {
                    "settings_used": state.get("content_spec"),
                    "total_cost": state.get("total_cost", 0),
                    "billing_components": state.get("billing_components", []),
                }
            }
        }
