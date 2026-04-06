import base64
import os
import re
import uuid
from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.core.schema import GenerateRequest, GenerationResult, SystemConfig
from app.graph.workflow import studio_graph_app
from app.services.auth import verify_admin_user, verify_api_key, verify_firebase_user
from app.services.security_store import (
    add_history_entry,
    abandon_analyze_session,
    complete_analyze_session,
    consume_rate_limit,
    create_analyze_session,
    adjust_credits,
    create_credit_code,
    get_history,
    get_user,
    list_credit_codes,
    list_users,
    redeem_credit_code,
)

# Rate Limiter (keyed by client IP)
limiter = Limiter(key_func=get_remote_address)

IMAGES_DIR = Path("generated_images")
SAFE_FILENAME = re.compile(r'^[a-f0-9\-]{36}\.(jpg|png|webp)$')  # UUID filenames only

# OpenAPI Tags for endpoint grouping
tags_metadata = [
    {
        "name": "Health",
        "description": "Health check endpoints for monitoring service status.",
    },
    {
        "name": "Configuration",
        "description": "Endpoints for retrieving system configuration and available options.",
    },
    {
        "name": "Generation",
        "description": "Core AI content generation endpoints. Generate images, captions, and more.",
    },
]

app = FastAPI(
    title="Vibecraft",
    version="1.0.0",
    description="""
## Vibecraft Backend API

A powerful AI-driven content generation platform that creates images and captions 
for social media marketing.

### Features
- 🎨 **AI Image Generation** - Generate stunning visuals using state-of-the-art models
- ✍️ **Caption Generation** - Create engaging captions tailored to your platform
- ⚙️ **Customizable Settings** - Control style, lighting, platform, and more

### Workflow
1. Submit a generation request with your text prompt
2. Optionally review AI suggestions via the UI schema
3. Receive your generated content
    """,
    openapi_tags=tags_metadata,
    contact={
        "name": "Vibecraft Support",
    },
    license_info={
        "name": "MIT",
    },
)

# Attach rate limiter to app
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Ensure the images directory exists
IMAGES_DIR.mkdir(exist_ok=True)

allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https://.*\.ngrok-free\.app",
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-API-Key", "ngrok-skip-browser-warning"],
)

@app.get(
    "/health",
    tags=["Health"],
    summary="Health Check",
    description="Check if the API server is running and responsive.",
    response_description="Returns status 'ok' if the server is healthy."
)
def health_check():
    """Returns the health status of the API server."""
    return {"status": "ok"}


@app.get(
    "/images/{filename}",
    tags=["Generation"],
    summary="Get Generated Image",
    description="Retrieve a generated image by filename. Only valid UUID filenames are accepted."
)
def get_image(filename: str):
    """Serves generated images with filename validation."""
    # Block anything that isn't a UUID filename
    if not SAFE_FILENAME.match(filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    
    filepath = IMAGES_DIR / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Image not found")
    
    return FileResponse(filepath)


@app.get(
    "/config",
    response_model=SystemConfig,
    tags=["Configuration"],
    summary="Get System Configuration",
    description="Retrieve the available field options and model catalog for Vibecraft."
)
@limiter.limit("30/minute")
def get_system_config(request: Request, _=Depends(verify_api_key)):
    """
    Fetch the current system configuration including:
    - **field_options**: Available options for platforms, styles, lighting, etc.
    - **model_catalog**: Available AI models for generation tasks
    """
    model_catalog = settings.refresh_model_catalog()
    return SystemConfig(
        field_options=settings.field_options,
        model_catalog=model_catalog
    )


@app.get("/me", tags=["Configuration"], summary="Get Current User Profile")
@limiter.limit("60/minute")
def get_current_user_profile(request: Request, user: Dict[str, Any] = Depends(verify_firebase_user)):
    profile = get_user(user["uid"])
    profile["isAdmin"] = user["is_admin"]
    return profile


@app.get("/history", tags=["Configuration"], summary="Get User History")
@limiter.limit("30/minute")
def get_user_history(request: Request, limit: int = 20, user: Dict[str, Any] = Depends(verify_firebase_user)):
    capped_limit = min(max(limit, 1), 100)
    return {"entries": get_history(user["uid"], capped_limit)}


@app.post("/history", tags=["Configuration"], summary="Add User History Entry")
@limiter.limit("20/minute")
def create_user_history_entry(request: Request, payload: Dict[str, Any], user: Dict[str, Any] = Depends(verify_firebase_user)):
    entry = add_history_entry(
        user["uid"],
        payload.get("imageUrl"),
        payload.get("caption"),
        payload.get("prompt", ""),
        payload.get("model", ""),
    )
    return entry


@app.post("/credits/redeem", tags=["Configuration"], summary="Redeem Credit Code")
@limiter.limit("10/minute")
def redeem_user_credit_code(request: Request, payload: Dict[str, Any], user: Dict[str, Any] = Depends(verify_firebase_user)):
    code = str(payload.get("code", "")).strip()
    if not code:
        raise HTTPException(status_code=400, detail="Code is required")
    rate_key = f"redeem:{user['uid']}:{get_remote_address(request)}"
    if not consume_rate_limit(rate_key, max_count=5, window_seconds=900):
        raise HTTPException(status_code=429, detail="Too many redemption attempts. Try again later.")
    return redeem_credit_code(code, user["uid"])


@app.post("/analyze-sessions/{session_id}/complete", tags=["Configuration"], summary="Complete Analyze Session")
def complete_pending_analyze_session(session_id: str, user: Dict[str, Any] = Depends(verify_firebase_user)):
    try:
        return complete_analyze_session(session_id, user["uid"])
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Analyze session not found") from exc


@app.post("/analyze-sessions/{session_id}/abandon", tags=["Configuration"], summary="Abandon Analyze Session")
@limiter.limit("20/minute")
def abandon_pending_analyze_session(request: Request, session_id: str, user: Dict[str, Any] = Depends(verify_firebase_user)):
    try:
        return abandon_analyze_session(session_id, user["uid"])
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Analyze session not found") from exc


@app.get("/admin/users", tags=["Configuration"], summary="List Users For Admin")
@limiter.limit("20/minute")
def admin_list_users(request: Request, _admin: Dict[str, Any] = Depends(verify_admin_user)):
    return {"users": list_users()}


@app.post("/admin/users/{uid}/credits", tags=["Configuration"], summary="Adjust Credits For Admin")
@limiter.limit("20/minute")
def admin_adjust_user_credits(request: Request, uid: str, payload: Dict[str, Any], admin: Dict[str, Any] = Depends(verify_admin_user)):
    delta = float(payload.get("delta", 0))
    if delta == 0:
        raise HTTPException(status_code=400, detail="Delta must be non-zero")
    reason = str(payload.get("reason", "admin_adjustment")).strip() or "admin_adjustment"
    try:
        profile = adjust_credits(
            uid,
            delta,
            reason,
            actor_uid=admin["uid"],
            metadata={"admin_email": admin.get("email", "")},
        )
    except ValueError as exc:
        if str(exc) == "INSUFFICIENT_CREDITS":
            raise HTTPException(status_code=400, detail="User has insufficient credits") from exc
        raise
    return profile


@app.get("/admin/codes", tags=["Configuration"], summary="List Credit Codes For Admin")
@limiter.limit("20/minute")
def admin_list_codes(request: Request, _admin: Dict[str, Any] = Depends(verify_admin_user)):
    return {"codes": list_credit_codes()}


@app.post("/admin/codes", tags=["Configuration"], summary="Create Credit Code For Admin")
@limiter.limit("10/minute")
def admin_create_code(request: Request, payload: Dict[str, Any], admin: Dict[str, Any] = Depends(verify_admin_user)):
    credits = float(payload.get("credits", 0))
    max_claims = int(payload.get("maxClaims", 0))
    try:
        code = create_credit_code(credits, max_claims, admin["uid"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return code


@app.post(
    "/generate",
    response_model=GenerationResult,
    tags=["Generation"],
    summary="Generate AI Content",
    description="Submit a content generation request to create images, captions, or both."
)
@limiter.limit("10/minute")
def generate_content(request: Request, payload: GenerateRequest, user: Dict[str, Any] = Depends(verify_firebase_user)):
    """
    Main generation endpoint that orchestrates the AI workflow.
    
    **Workflow:**
    1. Analyzes user intent and preferences
    2. Assigns appropriate AI models
    3. Generates requested content (images, captions)
    4. Returns results or requests user review
    
    **Response Statuses:**
    - `success`: Content generated successfully
    - `awaiting_review`: AI suggestions need user confirmation
    - `error`: An error occurred during generation
    """
    charged_cost = 0.0
    charged_applied = False
    try:
        settings.refresh_model_catalog()
        _validate_generate_request(payload)

        if payload.status != "generating":
            analyze_key = f"analyze:{user['uid']}"
            if not consume_rate_limit(analyze_key, max_count=20, window_seconds=3600):
                raise HTTPException(status_code=429, detail="Analyze limit reached. Try again later.")

        if payload.status == "generating":
            charged_cost = _estimate_generation_cost(payload)
            try:
                adjust_credits(
                    user["uid"],
                    -charged_cost,
                    "generation_charge",
                    actor_uid=user["uid"],
                    metadata={
                        "requested_outputs": payload.requested_outputs,
                        "image_model": (payload.user_preferences or {}).get("image_model"),
                        "caption_model": (payload.user_preferences or {}).get("caption_model"),
                    },
                )
                charged_applied = True
            except ValueError as exc:
                if str(exc) == "INSUFFICIENT_CREDITS":
                    raise HTTPException(status_code=402, detail="Insufficient credits") from exc
                raise

        input_image = _prepare_input_image(payload.input_image)

        initial_state = {
            "user_text": payload.user_text,
            "requested_outputs": payload.requested_outputs,
            "input_image": input_image,
            "user_preferences": payload.user_preferences or {},
            "status": payload.status or "processing"
        }
        if payload.user_corrections:
            initial_state["user_corrections"] = payload.user_corrections

        final_state = studio_graph_app.invoke(initial_state)

        if final_state.get("status") == "awaiting_review":
            analyze_session = create_analyze_session(
                user["uid"],
                payload.user_text,
                settings.analyze_abandon_fee,
            )
            return GenerationResult(
                status="awaiting_review",
                ui_schema=final_state.get("ui_schema"),
                content_prompts=final_state.get("content_prompts"),
                meta={
                    "analyze_session_id": analyze_session["id"],
                    "analyze_abandon_fee": analyze_session["fee"],
                },
            )
        elif final_state.get("status") == "complete":
            final_payload = final_state.get("final_response", {})
            current_profile = get_user(user["uid"])
            return GenerationResult(
                status="success",
                results=final_payload.get("results"),
                meta={
                    **(final_payload.get("meta") or {}),
                    "charged_cost": charged_cost,
                    "current_balance": current_profile.get("credits", 0),
                },
            )
        else:
            if charged_applied and charged_cost > 0:
                adjust_credits(
                    user["uid"],
                    charged_cost,
                    "generation_refund",
                    actor_uid=user["uid"],
                    metadata={"reason": "workflow_unexpected_status"},
                    allow_negative=True,
                )
            return GenerationResult(
                status="error",
                meta={"error_message": f"Workflow ended with unexpected status: {final_state.get('status')}"}
            )

    except ValueError as exc:
        if charged_applied and charged_cost > 0:
            try:
                adjust_credits(
                    user["uid"],
                    charged_cost,
                    "generation_refund",
                    actor_uid=user["uid"],
                    metadata={"reason": "validation_or_provider_rejection"},
                    allow_negative=True,
                )
            except Exception:
                pass
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as e:
        if charged_applied and charged_cost > 0:
            try:
                adjust_credits(
                    user["uid"],
                    charged_cost,
                    "generation_refund",
                    actor_uid=user["uid"],
                    metadata={"reason": "exception"},
                    allow_negative=True,
                )
            except Exception:
                pass
        print(f"Server Error: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal error occurred. Please try again later.")


def _estimate_generation_cost(payload: GenerateRequest) -> float:
    requested = payload.requested_outputs or []
    prefs = payload.user_preferences or {}
    total_cost = 0.0

    for task in requested:
        valid_models = settings.model_catalog.get(task, {})
        user_choice = prefs.get(f"{task}_model") or prefs.get(task)
        model_name = user_choice if user_choice in valid_models else next(iter(valid_models), None)
        if not model_name:
            continue
        total_cost += float(valid_models.get(model_name, {}).get("cost", 0))

    return round(total_cost, 2)


def _validate_generate_request(payload: GenerateRequest) -> None:
    requested = payload.requested_outputs or []
    if not requested:
        raise HTTPException(status_code=400, detail="At least one output must be selected")

    if payload.input_image:
        _validate_input_image(payload.input_image)

    prefs = payload.user_preferences or {}
    has_input_image = payload.input_image is not None
    wants_caption = "caption" in requested
    wants_image = "image" in requested

    if wants_caption:
        caption_model = _resolve_model_choice("caption", prefs)
        if caption_model:
            caption_entry = settings.model_catalog.get("caption", {}).get(caption_model, {})
            if wants_image:
                if has_input_image:
                    if not _is_gemini_image_model(caption_entry):
                        raise HTTPException(
                            status_code=400,
                            detail="For image-plus-text output with an uploaded image, the shared model must be a Nano Banana model.",
                        )
                elif not _is_gemini_text_model(caption_entry):
                    raise HTTPException(
                        status_code=400,
                        detail="For text output, the selected text model must support Gemini text generation.",
                    )
            else:
                if not _is_gemini_text_only_model(caption_entry):
                    raise HTTPException(
                        status_code=400,
                        detail="For text-only output, the selected text model must be a Gemini text model without image output.",
                    )

    if wants_image:
        image_model = _resolve_model_choice("image", prefs)
        if image_model and has_input_image:
            image_entry = settings.model_catalog.get("image", {}).get(image_model, {})
            if not _is_gemini_image_model(image_entry):
                raise HTTPException(
                    status_code=400,
                    detail="When an input image is uploaded, the image model must be a Gemini image model.",
                )
        elif image_model:
            image_entry = settings.model_catalog.get("image", {}).get(image_model, {})
            if not _is_image_capable_model(image_entry):
                raise HTTPException(
                    status_code=400,
                    detail="For image output, the selected image model must support image generation.",
                )

    if has_input_image and wants_caption and wants_image:
        caption_model = _resolve_model_choice("caption", prefs)
        image_model = _resolve_model_choice("image", prefs)
        if not caption_model or not image_model or caption_model != image_model:
            raise HTTPException(
                status_code=400,
                detail="For image-plus-text output with an uploaded image, caption and image must use the same Nano Banana model.",
            )


def _resolve_model_choice(task: str, prefs: Dict[str, str]) -> str | None:
    valid_models = settings.model_catalog.get(task, {})
    user_choice = prefs.get(f"{task}_model") or prefs.get(task)
    if user_choice and user_choice in valid_models:
        return user_choice
    return next(iter(valid_models), None)


def _validate_input_image(input_image) -> None:
    if input_image.url:
        if not input_image.url.startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="Uploaded image URL must be absolute")
        return

    if not input_image.mime_type or not input_image.data:
        raise HTTPException(status_code=400, detail="Uploaded image is missing mime type or data")

    _validate_uploaded_image(input_image.mime_type, input_image.data)


def _validate_uploaded_image(mime_type: str, base64_data: str) -> None:
    allowed = {"image/png", "image/jpeg", "image/webp"}
    if mime_type not in allowed:
        raise HTTPException(status_code=400, detail="Only PNG, JPEG, and WEBP uploads are supported")

    try:
        decoded_size = len(base64.b64decode(base64_data, validate=True))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Uploaded image is not valid base64 data") from exc

    if decoded_size > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Uploaded image exceeds the 10 MB limit")


def _is_gemini_text_model(model_entry: Dict[str, Any]) -> bool:
    provider = model_entry.get("provider")
    output_modalities = set(model_entry.get("output_modalities") or [])
    return provider == "google-gemini" and "TEXT" in output_modalities


def _is_gemini_text_only_model(model_entry: Dict[str, Any]) -> bool:
    output_modalities = set(model_entry.get("output_modalities") or [])
    return _is_gemini_text_model(model_entry) and "IMAGE" not in output_modalities


def _is_gemini_image_model(model_entry: Dict[str, Any]) -> bool:
    return model_entry.get("provider") == "google-gemini" and model_entry.get("type") == "gemini-image"


def _is_image_capable_model(model_entry: Dict[str, Any]) -> bool:
    output_modalities = set(model_entry.get("output_modalities") or [])
    return "IMAGE" in output_modalities


def _prepare_input_image(input_image) -> Dict[str, str] | None:
    if not input_image:
        return None

    if input_image.url:
        return {"url": input_image.url, "mime_type": input_image.mime_type or ""}

    if not input_image.mime_type or not input_image.data:
        return None

    filename = _save_uploaded_input_image(input_image.mime_type, input_image.data)
    return {
        "url": f"{settings.public_backend_base_url}/images/{filename}",
        "mime_type": input_image.mime_type,
    }


def _save_uploaded_input_image(mime_type: str, base64_data: str) -> str:
    image_bytes = base64.b64decode(base64_data, validate=True)
    extension = _extension_for_mime_type(mime_type)
    filename = f"{uuid.uuid4()}.{extension}"
    save_path = IMAGES_DIR / filename
    with open(save_path, "wb") as image_file:
        image_file.write(image_bytes)
    return filename


def _extension_for_mime_type(mime_type: str) -> str:
    if mime_type == "image/png":
        return "png"
    if mime_type == "image/webp":
        return "webp"
    return "jpg"
