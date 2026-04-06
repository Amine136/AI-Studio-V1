import json
import logging
import traceback
from typing import Dict, Any, List

from app.core.state import StudioState, ContentSpec, OutputType
from app.config import settings
from app.graph.plugins import PLUGIN_REGISTRY
from app.services.llm_client import generate_text
from app.services.image_client import generate_image_url, generate_image_and_text
from app.services.sanitizer import sanitize_user_text
from app.core.schema import IntentAnalysis

# Configure logger
logger = logging.getLogger("studio.workflow")
logger.setLevel(logging.INFO)

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
    input_image = state.get("input_image")
    
    # Status Logic
    current_status = state.get("status")
    next_status = "generating" if current_status == "generating" else "processing"
    
    logger.info(f"   └─ ✅ Text received ({len(user_text)} chars) | Outputs: {req_outputs}")
    
    return {
        "user_text": user_text,
        "requested_outputs": req_outputs,
        "input_image": input_image,
        "user_preferences": user_prefs,
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
    input_image = state.get("input_image")
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
        input_image=input_image,
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
    total_cost = 0
    total_requests = len(state.get("model_requests", []))
    input_image = state.get("input_image")
    requested_outputs = state.get("requested_outputs", [])
    assigned_models = state.get("assigned_models", {})
    content_spec = state.get("content_spec", {})

    shared_multimodal_model = (
        input_image
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
        model_cost = model_config.get("cost", 0)
        multimodal_prompt = _build_shared_multimodal_prompt(content_spec)
        logger.info(f"   ├─ [1/1] multimodal bundle via {provider} (cost: {model_cost})...")

        try:
            bundle = generate_image_and_text(
                provider,
                model_id,
                multimodal_prompt,
                image_config={"aspect_ratio": content_spec.get("aspect_ratio", "16:9")},
                input_image=input_image,
            )
            generated["image"] = bundle.get("image", "")
            generated["caption"] = bundle.get("text", "")
            total_cost += model_cost
            logger.info("   │  └─ ✅ Shared multimodal request succeeded")
            return {
                "generated_assets": generated,
                "total_cost": total_cost,
                "status": "complete",
            }
        except Exception as e:
            error_msg = f"Generation Failed: {str(e)}"
            logger.error(f"   │  └─ ❌ {error_msg}")
            traceback.print_exc()
            return {
                "generated_assets": {"image": error_msg, "caption": error_msg},
                "total_cost": 0,
                "status": "complete",
            }
    
    for idx, req in enumerate(state.get("model_requests", []), 1):
        task_type = req["output_key"]
        model_name = req["model_name"]
        prompt = req["prompt"]
        
        # --- ROBUST CONFIG LOOKUP ---
        task_config = settings.model_catalog.get(task_type, {})
        model_config = task_config.get(model_name)
        
        if not model_config:
            logger.warning(f"   ├─ ⚠️ [{idx}/{total_requests}] {task_type}: Model config missing for {model_name}")
            generated[task_type] = f"Error: Model {model_name} not found."
            continue
            
        provider = model_config.get("provider", "mock")
        model_id = model_config.get("model_id", "default")
        model_cost = model_config.get("cost", 0)
        
        logger.info(f"   ├─ [{idx}/{total_requests}] {task_type} via {provider} (cost: {model_cost})...")

        try:
            if task_type == "image":
                model_type = model_config.get("type", "")
                image_config = req.get("metadata", {})
                result = generate_image_url(
                    provider,
                    model_id,
                    prompt,
                    model_type=model_type,
                    image_config=image_config,
                    input_image=input_image,
                )
            else:
                result = generate_text(provider, model_id, prompt, input_image=input_image)
            
            generated[task_type] = result
            total_cost += model_cost
            logger.info(f"   │  └─ ✅ Success")
            
        except Exception as e:
            error_msg = f"Generation Failed: {str(e)}"
            logger.error(f"   │  └─ ❌ {error_msg}")
            traceback.print_exc()
            generated[task_type] = error_msg

    logger.info(f"   └─ 🎉 Generation complete: {len(generated)} assets | Total cost: {total_cost} credits")
    
    return {
        "generated_assets": generated,
        "total_cost": total_cost,
        "status": "complete"
    }


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


def format_delivery(state: StudioState) -> StudioState:
    logger.info("📦 DELIVER: Formatting final response...")
    logger.info("   └─ ✅ Done!")
    
    return {
        "final_response": {
            "status": "success",
            "results": state.get("generated_assets"),
            "meta": {
                "settings_used": state.get("content_spec"),
                "total_cost": state.get("total_cost", 0)
            }
        }
    }
