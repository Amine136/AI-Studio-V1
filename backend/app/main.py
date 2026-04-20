import os
import re
import secrets
import json
import base64
import time
import struct
from pathlib import Path
from typing import Any, Dict
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request, Depends, UploadFile, File, Header, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text

from app.config import settings
from app.core.schema import AdminAuditLogListResponse, AdminAuthFailureSummaryResponse, AdminCreditCodeBatchListResponse, AdminCreditCodeListResponse, AdminGenerationJobItem, AdminGenerationJobListResponse, AdminLoginRequest, AdminReasonRequest, AdminSessionResponse, AdminUserDetailResponse, AdminUserListResponse, CatalogUpdateNotification, GenerateRequest, GenerationResult, PlainChatConversationCreateRequest, PlainChatConversationItem, PlainChatConversationListResponse, PlainChatConversationMessageCreateRequest, PlainChatConversationMessagesResponse, PlainChatConversationTurnResponse, PlainChatModelListResponse, SystemConfig
from app.db.session import session_scope
from app.graph.workflow import studio_graph_app
from app.services.admin_auth import AdminAuthRateLimitError, authenticate_admin, list_admin_auth_failure_summaries, revoke_admin_session
from app.services.apikeymanager_client import ApiKeyManagerProxyError, check_apikeymanager_ready
from app.services.auth import verify_admin_csrf, verify_admin_session, verify_api_key, verify_firebase_user
from app.services.catalog_store import catalog_store
from app.services.chat_service import assemble_plain_chat_context, estimate_plain_chat_cost, list_plain_chat_models, normalize_plain_chat_system, prepare_plain_chat_conversation_request, preview_plain_chat_prompt, send_plain_chat, serialize_plain_chat_parts
from app.services.security_backend import (
    add_history_entry,
    add_chat_turn,
    abandon_analyze_session,
    add_admin_audit_log,
    capture_generation_credits,
    complete_analyze_session,
    consume_rate_limit,
    create_chat_conversation,
    create_analyze_session,
    create_analyze_session_with_charge,
    adjust_credits,
    create_credit_code,
    create_credit_code_batch,
    create_credit_code_batch_with_title,
    create_generation_job,
    disable_credit_code_batch,
    disable_credit_code,
    enable_credit_code,
    enable_credit_code_batch,
    get_admin_generation_job,
    get_admin_user_detail,
    get_chat_conversation,
    get_chat_messages,
    get_history,
    get_user,
    hash_credit_code,
    list_admin_audit_logs,
    list_admin_generation_jobs,
    list_chat_conversations,
    list_credit_code_batches,
    list_credit_code_batch_status_summaries,
    list_credit_codes,
    list_gift_code_status_summaries,
    list_users,
    search_users,
    mark_generation_job_awaiting_review,
    preload_security_store,
    redeem_credit_code,
    release_generation_credits,
    reserve_generation_credits,
    suspend_user,
    unsuspend_user,
)

SYSTEM_AUDIT_EMAIL = "system@vibecraft.local"

def _decode_bearer_uid(request: Request) -> str | None:
    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        return None

    token = auth_header.split(" ", 1)[1].strip()
    if not token:
        return None

    parts = token.split(".")
    if len(parts) != 3:
        return None

    payload = parts[1]
    padding = "=" * (-len(payload) % 4)
    try:
        decoded = base64.urlsafe_b64decode(payload + padding)
        claims = json.loads(decoded.decode("utf-8"))
    except Exception:
        return None

    uid = claims.get("uid") or claims.get("user_id") or claims.get("sub")
    if not uid:
        return None
    return str(uid)


def rate_limit_key(request: Request) -> str:
    uid = _decode_bearer_uid(request)
    if uid:
        return f"user:{uid}"
    return f"ip:{get_remote_address(request)}"


def _enforce_mode_specific_generate_limits(request: Request, payload: GenerateRequest, user: Dict[str, Any], *, direct_generation: bool) -> None:
    uid = str(user["uid"])
    ip = get_remote_address(request)

    if payload.mode == "quick":
        user_key = f"generate:quick:user:{uid}"
        ip_key = f"generate:quick:ip:{ip}"
        burst_user_key = f"generate:quick:burst:user:{uid}"
        burst_ip_key = f"generate:quick:burst:ip:{ip}"

        quick_burst_message = (
            f"You reached the current early-stage Quick Generate limit of "
            f"{settings.quick_generate_burst_user_limit} messages per "
            f"{_format_wait_window(settings.quick_generate_burst_window_seconds)}. "
            "We are still in test mode and will make these limits more flexible later."
        )
        quick_window_message = (
            f"You reached the current early-stage Quick Generate limit of "
            f"{settings.quick_generate_user_limit} messages per "
            f"{_format_wait_window(settings.quick_generate_window_seconds)}. "
            "We are still in test mode and will make these limits more flexible later."
        )

        if not consume_rate_limit(
            burst_user_key,
            max_count=settings.quick_generate_burst_user_limit,
            window_seconds=settings.quick_generate_burst_window_seconds,
        ):
            _record_usage_limit_audit_event(
                uid=uid,
                ip=ip,
                mode="quick",
                phase="generate",
                window_seconds=settings.quick_generate_burst_window_seconds,
                source="user",
            )
            raise HTTPException(status_code=429, detail=quick_burst_message)
        if not consume_rate_limit(
            burst_ip_key,
            max_count=settings.quick_generate_burst_ip_limit,
            window_seconds=settings.quick_generate_burst_window_seconds,
        ):
            _record_usage_limit_audit_event(
                uid=uid,
                ip=ip,
                mode="quick",
                phase="generate",
                window_seconds=settings.quick_generate_burst_window_seconds,
                source="ip",
            )
            raise HTTPException(status_code=429, detail=quick_burst_message)
        if not consume_rate_limit(
            user_key,
            max_count=settings.quick_generate_user_limit,
            window_seconds=settings.quick_generate_window_seconds,
        ):
            _record_usage_limit_audit_event(
                uid=uid,
                ip=ip,
                mode="quick",
                phase="generate",
                window_seconds=settings.quick_generate_window_seconds,
                source="user",
            )
            raise HTTPException(status_code=429, detail=quick_window_message)
        if not consume_rate_limit(
            ip_key,
            max_count=settings.quick_generate_ip_limit,
            window_seconds=settings.quick_generate_window_seconds,
        ):
            _record_usage_limit_audit_event(
                uid=uid,
                ip=ip,
                mode="quick",
                phase="generate",
                window_seconds=settings.quick_generate_window_seconds,
                source="ip",
            )
            raise HTTPException(status_code=429, detail=quick_window_message)
        return

    phase = "generate" if direct_generation else "analyze"
    user_key = f"generate:smart:{phase}:user:{uid}"
    ip_key = f"generate:smart:{phase}:ip:{ip}"
    if not consume_rate_limit(
        user_key,
        max_count=settings.smart_generate_user_limit,
        window_seconds=settings.smart_generate_window_seconds,
    ):
        _record_usage_limit_audit_event(
            uid=uid,
            ip=ip,
            mode="smart",
            phase=phase,
            window_seconds=settings.smart_generate_window_seconds,
            source="user",
        )
        raise HTTPException(
            status_code=429,
            detail=f"You hit the rate limit. Please wait about {_format_wait_window(settings.smart_generate_window_seconds)} and try again.",
        )
    if not consume_rate_limit(
        ip_key,
        max_count=settings.smart_generate_ip_limit,
        window_seconds=settings.smart_generate_window_seconds,
    ):
        _record_usage_limit_audit_event(
            uid=uid,
            ip=ip,
            mode="smart",
            phase=phase,
            window_seconds=settings.smart_generate_window_seconds,
            source="ip",
        )
        raise HTTPException(
            status_code=429,
            detail=f"You hit the rate limit. Please wait about {_format_wait_window(settings.smart_generate_window_seconds)} and try again.",
        )


def _enforce_plain_chat_limits(request: Request, user: Dict[str, Any]) -> None:
    uid = str(user["uid"])
    ip = get_remote_address(request)
    user_key = f"chat:plain:user:{uid}"
    ip_key = f"chat:plain:ip:{ip}"
    burst_user_key = f"chat:plain:burst:user:{uid}"
    burst_ip_key = f"chat:plain:burst:ip:{ip}"

    burst_message = (
        f"You reached the current early-stage Plain Chat limit of "
        f"{settings.plain_chat_burst_user_limit} messages per "
        f"{_format_wait_window(settings.plain_chat_burst_window_seconds)}. "
        "We are still in test mode and will make these limits more flexible later."
    )
    window_message = (
        f"You reached the current early-stage Plain Chat limit of "
        f"{settings.plain_chat_user_limit} messages per "
        f"{_format_wait_window(settings.plain_chat_window_seconds)}. "
        "We are still in test mode and will make these limits more flexible later."
    )

    if not consume_rate_limit(
        burst_user_key,
        max_count=settings.plain_chat_burst_user_limit,
        window_seconds=settings.plain_chat_burst_window_seconds,
    ):
        _record_usage_limit_audit_event(
            uid=uid,
            ip=ip,
            mode="plain_chat",
            phase="chat",
            window_seconds=settings.plain_chat_burst_window_seconds,
            source="user",
        )
        raise HTTPException(status_code=429, detail=burst_message)
    if not consume_rate_limit(
        burst_ip_key,
        max_count=settings.plain_chat_burst_ip_limit,
        window_seconds=settings.plain_chat_burst_window_seconds,
    ):
        _record_usage_limit_audit_event(
            uid=uid,
            ip=ip,
            mode="plain_chat",
            phase="chat",
            window_seconds=settings.plain_chat_burst_window_seconds,
            source="ip",
        )
        raise HTTPException(status_code=429, detail=burst_message)
    if not consume_rate_limit(
        user_key,
        max_count=settings.plain_chat_user_limit,
        window_seconds=settings.plain_chat_window_seconds,
    ):
        _record_usage_limit_audit_event(
            uid=uid,
            ip=ip,
            mode="plain_chat",
            phase="chat",
            window_seconds=settings.plain_chat_window_seconds,
            source="user",
        )
        raise HTTPException(status_code=429, detail=window_message)
    if not consume_rate_limit(
        ip_key,
        max_count=settings.plain_chat_ip_limit,
        window_seconds=settings.plain_chat_window_seconds,
    ):
        _record_usage_limit_audit_event(
            uid=uid,
            ip=ip,
            mode="plain_chat",
            phase="chat",
            window_seconds=settings.plain_chat_window_seconds,
            source="ip",
        )
        raise HTTPException(status_code=429, detail=window_message)


def _format_wait_window(window_seconds: int) -> str:
    if window_seconds <= 60:
        return "1 minute"
    minutes = max(1, round(window_seconds / 60))
    if minutes == 1:
        return "1 minute"
    return f"{minutes} minutes"


def _enforce_admin_login_min_latency(started_at: float) -> None:
    minimum_latency = max(0.0, float(settings.admin_login_min_latency_seconds))
    if minimum_latency <= 0:
        return
    elapsed = time.monotonic() - started_at
    remaining = minimum_latency - elapsed
    if remaining > 0:
        time.sleep(remaining)


def _record_usage_limit_audit_event(*, uid: str, ip: str, mode: str, phase: str, window_seconds: int, source: str) -> None:
    audit_key = f"audit:usage_limit:{mode}:{phase}:{source}:{uid}:{ip}"
    if not consume_rate_limit(audit_key, max_count=1, window_seconds=window_seconds):
        return
    add_admin_audit_log(
        admin_uid=None,
        admin_email=SYSTEM_AUDIT_EMAIL,
        action="usage_rate_limit_hit",
        target_type="user",
        target_id=uid,
        reason=f"Usage burst detected for {mode} {phase}. Rate limit was triggered.",
        metadata={
            "uid": uid,
            "ip": ip,
            "mode": mode,
            "phase": phase,
            "source": source,
            "window_seconds": window_seconds,
        },
    )


# Rate Limiter (keyed by authenticated user when possible, else client IP)
limiter = Limiter(key_func=rate_limit_key)

BASE_DIR = Path(__file__).resolve().parent.parent
IMAGES_DIR = BASE_DIR / "generated_images"
UPLOADED_IMAGES_DIR = BASE_DIR / "uploaded_images"
SAFE_GENERATED_FILENAME = re.compile(r'^[a-f0-9\-]{36}\.(jpg|png|webp)$')
SAFE_UPLOADED_FILENAME = re.compile(r'^[a-f0-9]{32}\.(jpg|png|webp)$')
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_UPLOAD_PIXELS = 16_000_000
MAX_UPLOAD_DIMENSION = 8192
UPLOAD_RETENTION_SECONDS = 30 * 24 * 60 * 60

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
    {
        "name": "Chat",
        "description": "Dedicated plain-chat endpoints separated from the smart generation workflow.",
    },
    {
        "name": "Admin Authentication",
        "description": "Dedicated username/password authentication for the separate admin portal.",
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
UPLOADED_IMAGES_DIR.mkdir(exist_ok=True)

allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https://.*\.ngrok-free\.app",
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-API-Key", "X-CSRF-Token", "ngrok-skip-browser-warning"],
)


def _set_admin_csrf_cookie(response: Response, token: str | None = None) -> str:
    csrf_token = (token or secrets.token_urlsafe(32)).strip()
    response.set_cookie(
        key=settings.admin_csrf_cookie_name,
        value=csrf_token,
        httponly=False,
        secure=settings.admin_cookie_secure,
        samesite="lax",
        max_age=settings.admin_session_ttl_seconds,
        path="/",
    )
    return csrf_token

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
    "/health/dependencies",
    tags=["Health"],
    summary="Dependency Health Check",
    description="Check database and ApiKeyManager readiness.",
)
def dependency_health_check():
    database_status = {"status": "ok"}
    apikeymanager_status = {"status": "ok"}
    overall_status = "ok"

    try:
        with session_scope() as session:
            session.execute(text("SELECT 1"))
    except Exception as exc:
        overall_status = "degraded"
        database_status = {
            "status": "error",
            "message": str(exc),
        }

    try:
        ready_payload = check_apikeymanager_ready()
        apikeymanager_status = {
            "status": "ok",
            "payload": ready_payload,
        }
    except ApiKeyManagerProxyError as exc:
        overall_status = "degraded"
        apikeymanager_status = {
            "status": "error",
            **exc.to_metadata(),
        }
    except Exception as exc:
        overall_status = "degraded"
        apikeymanager_status = {
            "status": "error",
            "message": str(exc),
        }

    return {
        "status": overall_status,
        "dependencies": {
            "database": database_status,
            "apikeymanager": apikeymanager_status,
        },
    }


@app.on_event("startup")
def cleanup_uploaded_images_on_startup():
    _cleanup_expired_uploaded_images()
    catalog_store.initialize()
    preload_security_store()


@app.get(
    "/images/{filename}",
    tags=["Generation"],
    summary="Get Generated Image",
    description="Retrieve a generated image by filename. Only valid UUID filenames are accepted."
)
def get_image(filename: str):
    """Serves generated images with filename validation."""
    is_generated = SAFE_GENERATED_FILENAME.match(filename)
    is_uploaded = SAFE_UPLOADED_FILENAME.match(filename)
    if not is_generated and not is_uploaded:
        raise HTTPException(status_code=400, detail="Invalid filename")

    filepath = (IMAGES_DIR / filename) if is_generated else (UPLOADED_IMAGES_DIR / filename)
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Image not found")
    
    return FileResponse(filepath)


@app.post("/uploads/image", tags=["Generation"], summary="Upload Input Image")
@limiter.limit("20/minute")
async def upload_input_image(
    request: Request,
    image: UploadFile = File(...),
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    if image.content_type not in {"image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(status_code=400, detail="Only PNG, JPEG, and WEBP images are supported")

    _enforce_upload_limits(request, str(user["uid"]))

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded image is empty")
    if len(image_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="Uploaded image exceeds the 10 MB limit")

    detected_mime_type, width, height = _inspect_uploaded_image_bytes(image_bytes)
    if detected_mime_type != image.content_type:
        raise HTTPException(status_code=400, detail="Uploaded file content does not match the declared image type")
    if width <= 0 or height <= 0:
        raise HTTPException(status_code=400, detail="Could not determine uploaded image dimensions")
    if width > MAX_UPLOAD_DIMENSION or height > MAX_UPLOAD_DIMENSION:
        raise HTTPException(status_code=400, detail="Uploaded image dimensions are too large")
    if width * height > MAX_UPLOAD_PIXELS:
        raise HTTPException(status_code=400, detail="Uploaded image resolution is too large")

    _cleanup_expired_uploaded_images()
    _verify_uploaded_image_cleanup_health()

    filename = _save_uploaded_input_image_bytes(image.content_type, image_bytes)
    return {
        "name": image.filename or filename,
        "mime_type": image.content_type,
        "url": _uploaded_image_url_for_filename(filename),
        "size": len(image_bytes),
    }


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
    model_catalog = catalog_store.get_catalog()
    catalog_warnings = _collect_catalog_cost_warnings(model_catalog)
    return SystemConfig(
        field_options=settings.field_options,
        model_catalog=_catalog_with_effective_costs(model_catalog),
        smart_analysis_fee=settings.smart_analysis_fee,
        minimum_text_generation_cost=settings.minimum_text_generation_cost,
        minimum_image_generation_cost=settings.minimum_image_generation_cost,
        catalog_warnings=catalog_warnings,
    )


@app.get(
    "/chat/models",
    response_model=PlainChatModelListResponse,
    tags=["Chat"],
    summary="List Plain Chat Models",
    description="Return chat-capable text models for the dedicated plain-chat flow.",
)
@limiter.limit("30/minute")
def list_plain_chat_model_options(request: Request, user: Dict[str, Any] = Depends(verify_firebase_user)):
    del request
    del user
    catalog_store.get_catalog()
    return PlainChatModelListResponse(models=list_plain_chat_models())


@app.get(
    "/chat/conversations",
    response_model=PlainChatConversationListResponse,
    tags=["Chat"],
    summary="List Plain Chat Conversations",
    description="Return stored plain-chat conversations for the current user.",
)
@limiter.limit("30/minute")
def list_plain_chat_conversation_items(
    request: Request,
    limit: int = 20,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    del request
    bounded_limit = min(max(int(limit), 1), 100)
    conversations = list_chat_conversations(user["uid"], bounded_limit)
    return PlainChatConversationListResponse(
        conversations=[PlainChatConversationItem.model_validate(conversation) for conversation in conversations]
    )


@app.post(
    "/chat/conversations",
    response_model=PlainChatConversationItem,
    tags=["Chat"],
    summary="Create Plain Chat Conversation",
    description="Create a new persisted plain-chat conversation with a locked model.",
)
@limiter.limit("20/minute")
def create_plain_chat_conversation(
    request: Request,
    payload: PlainChatConversationCreateRequest,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    _enforce_plain_chat_request_size(request)
    catalog_store.get_catalog()
    normalized_system = normalize_plain_chat_system(payload.model, payload.system)
    conversation = create_chat_conversation(
        user["uid"],
        payload.model,
        normalized_system,
    )
    return PlainChatConversationItem.model_validate(conversation)


@app.get(
    "/chat/conversations/{conversation_id}/messages",
    response_model=PlainChatConversationMessagesResponse,
    tags=["Chat"],
    summary="Get Plain Chat Messages",
    description="Return the stored messages for one plain-chat conversation.",
)
@limiter.limit("30/minute")
def get_plain_chat_conversation_messages(
    request: Request,
    conversation_id: str,
    limit: int = 100,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    del request
    bounded_limit = min(max(int(limit), 1), 200)
    conversation = get_chat_conversation(user["uid"], conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Chat conversation not found")

    messages = get_chat_messages(user["uid"], conversation_id, bounded_limit)
    return PlainChatConversationMessagesResponse(
        conversation=PlainChatConversationItem.model_validate(conversation),
        messages=messages,
    )


@app.post(
    "/chat/conversations/{conversation_id}/messages",
    response_model=PlainChatConversationTurnResponse,
    tags=["Chat"],
    summary="Send Persisted Plain Chat Message",
    description="Append a user turn to a stored conversation, call ApiKeyManager, and persist the assistant reply.",
)
@limiter.limit("20/minute")
def create_plain_chat_conversation_message(
    request: Request,
    conversation_id: str,
    payload: PlainChatConversationMessageCreateRequest,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    charged_cost = 0.0
    charged_applied = False
    generation_job_id: str | None = None

    try:
        catalog_store.get_catalog()
        _enforce_plain_chat_request_size(request)
        _enforce_plain_chat_limits(request, user)

        conversation = get_chat_conversation(user["uid"], conversation_id)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Chat conversation not found")

        existing_messages = get_chat_messages(user["uid"], conversation_id, 200)
        user_parts = serialize_plain_chat_parts(payload.parts)
        assembled_messages = assemble_plain_chat_context(
            existing_messages=existing_messages,
            next_user_parts=user_parts,
        )
        request_payload = prepare_plain_chat_conversation_request(
            model_name=str(conversation.get("model") or ""),
            system_parts=list(conversation.get("system") or []),
            messages=assembled_messages,
            options=payload.options,
        )

        charged_cost = estimate_plain_chat_cost(str(conversation.get("model") or ""))
        reservation = reserve_generation_credits(
            user["uid"],
            preview_plain_chat_prompt(request_payload),
            ["chat"],
            {
                "route": "plain_chat_conversation",
                "conversation_id": conversation_id,
                "model": conversation.get("model"),
                "message_count": len(assembled_messages),
                "stored_message_count": len(existing_messages) + 1,
                "options": payload.options.model_dump(by_alias=True, exclude_none=True) if payload.options else {},
            },
            charged_cost,
        )
        generation_job_id = str((reservation.get("job") or {}).get("id") or "")
        charged_applied = charged_cost > 0

        result = send_plain_chat(request_payload)
        assistant_message = result.get("message")
        if not isinstance(assistant_message, dict):
            raise ValueError("CHAT_INVALID_PROVIDER_RESPONSE")

        persisted_turn = add_chat_turn(
            user["uid"],
            conversation_id,
            user_parts=user_parts,
            assistant_parts=list(assistant_message.get("parts") or []),
            prompt_tokens=int((result.get("usage") or {}).get("promptTokens") or 0),
            completion_tokens=int((result.get("usage") or {}).get("completionTokens") or 0),
        )
        persisted_user_message = persisted_turn["user"]
        persisted_assistant_message = persisted_turn["assistant"]

        if charged_applied and charged_cost > 0 and generation_job_id:
            capture_generation_credits(generation_job_id)

        current_profile = get_user(user["uid"])
        refreshed_conversation = get_chat_conversation(user["uid"], conversation_id) or conversation
        return PlainChatConversationTurnResponse(
            status="success",
            conversation=PlainChatConversationItem.model_validate(refreshed_conversation),
            userMessage=persisted_user_message,
            assistantMessage=persisted_assistant_message,
            usage=result.get("usage") or {},
            meta={
                "provider": result.get("provider"),
                "model": result.get("model"),
                "latencyMs": (result.get("meta") or {}).get("latencyMs") if isinstance(result.get("meta"), dict) else None,
                "charged_cost": charged_cost,
                "current_balance": (current_profile or {}).get("credits", 0),
            },
        )
    except HTTPException:
        raise
    except ValueError as exc:
        if charged_applied and charged_cost > 0 and generation_job_id:
            try:
                release_generation_credits(generation_job_id, "plain_chat_conversation_validation_or_provider_rejection")
            except Exception:
                pass
        detail = _plain_chat_error_message(str(exc))
        status_code = 402 if str(exc) == "INSUFFICIENT_CREDITS" else 400
        if str(exc) in {"CHAT_REQUEST_TOO_LARGE"}:
            status_code = 413
        if status_code == 402:
            raise HTTPException(status_code=402, detail=detail) from exc
        if status_code == 413:
            raise HTTPException(status_code=413, detail=detail) from exc
        return PlainChatConversationTurnResponse(status="error", meta={"error_message": detail})
    except ApiKeyManagerProxyError as exc:
        if charged_applied and charged_cost > 0 and generation_job_id:
            try:
                release_generation_credits(generation_job_id, f"plain_chat_conversation_provider_{exc.error_type}")
            except Exception:
                pass
        current_profile = get_user(user["uid"])
        return PlainChatConversationTurnResponse(
            status="error",
            meta={
                "error_message": _provider_error_message(exc),
                "failure_reason": f"plain_chat_conversation_provider_{exc.error_type}",
                "provider_error": exc.to_metadata(),
                "current_balance": (current_profile or {}).get("credits", 0),
            },
        )
    except Exception:
        if charged_applied and charged_cost > 0 and generation_job_id:
            try:
                release_generation_credits(generation_job_id, "plain_chat_conversation_exception")
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="An internal error occurred. Please try again later.")


def _enforce_plain_chat_request_size(request: Request) -> None:
    content_length = request.headers.get("content-length")
    if not content_length:
        return
    try:
        request_bytes = int(content_length)
    except (TypeError, ValueError):
        return
    if request_bytes > int(settings.plain_chat_max_request_bytes):
        raise ValueError("CHAT_REQUEST_TOO_LARGE")


@app.post(
    "/internal/catalog-updated",
    tags=["Configuration"],
    summary="Catalog Update Webhook",
    description="Internal webhook used by ApiKeyManager to notify Vibecraft that a new model catalog version is available.",
)
def catalog_updated_webhook(
    payload: CatalogUpdateNotification,
    x_catalog_webhook_secret: str | None = Header(default=None),
):
    expected_secret = settings.catalog_webhook_secret
    if not expected_secret:
        raise HTTPException(status_code=503, detail="Catalog webhook secret is not configured")
    if not x_catalog_webhook_secret or not secrets.compare_digest(x_catalog_webhook_secret, expected_secret):
        raise HTTPException(status_code=403, detail="Invalid catalog webhook secret")

    if not catalog_store.should_refresh(payload.version):
        metadata = catalog_store.get_metadata()
        return {
            "status": "noop",
            "version": metadata["version"],
            "updated_at": metadata["updated_at"],
        }

    try:
        result = catalog_store.refresh_from_source(payload.version)
    except Exception as exc:
        print(f"Catalog webhook refresh failed for version {payload.version}: {exc}")
        raise HTTPException(status_code=502, detail="Failed to refresh catalog from ApiKeyManager") from exc

    return {
        "status": "updated" if result["updated"] else "noop",
        "version": result["version"],
        "updated_at": result["updated_at"],
    }


@app.post("/admin-auth/login", response_model=AdminSessionResponse, tags=["Admin Authentication"], summary="Login To Admin Portal")
@limiter.limit("30/minute")
def admin_login(request: Request, payload: AdminLoginRequest, response: Response):
    started_at = time.monotonic()
    try:
        token, session = authenticate_admin(
            payload.username,
            payload.password,
            ip_address=get_remote_address(request),
        )
    except AdminAuthRateLimitError as exc:
        _enforce_admin_login_min_latency(started_at)
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except ValueError as exc:
        _enforce_admin_login_min_latency(started_at)
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except RuntimeError as exc:
        _enforce_admin_login_min_latency(started_at)
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    _enforce_admin_login_min_latency(started_at)
    response.set_cookie(
        key=settings.admin_session_cookie_name,
        value=token,
        httponly=True,
        secure=settings.admin_cookie_secure,
        samesite="lax",
        max_age=settings.admin_session_ttl_seconds,
        path="/",
    )
    _set_admin_csrf_cookie(response)
    return session


@app.post("/admin-auth/logout", tags=["Admin Authentication"], summary="Logout From Admin Portal")
def admin_logout(request: Request, response: Response, _csrf: None = Depends(verify_admin_csrf)):
    token = request.cookies.get(settings.admin_session_cookie_name, "").strip()
    if token:
        try:
            revoke_admin_session(token)
        except RuntimeError:
            pass
    response.delete_cookie(
        key=settings.admin_session_cookie_name,
        path="/",
        secure=settings.admin_cookie_secure,
        samesite="lax",
    )
    response.delete_cookie(
        key=settings.admin_csrf_cookie_name,
        path="/",
        secure=settings.admin_cookie_secure,
        samesite="lax",
    )
    return {"success": True}


@app.get("/admin-auth/me", response_model=AdminSessionResponse, tags=["Admin Authentication"], summary="Get Current Admin Session")
def admin_current_session(request: Request, response: Response, admin: Dict[str, Any] = Depends(verify_admin_session)):
    if not request.cookies.get(settings.admin_csrf_cookie_name, "").strip():
        _set_admin_csrf_cookie(response)
    return admin["session"]


@app.get("/me", tags=["Configuration"], summary="Get Current User Profile")
@limiter.limit("30/minute")
def get_current_user_profile(request: Request, user: Dict[str, Any] = Depends(verify_firebase_user)):
    return get_user(user["uid"])


@app.get("/history", tags=["Configuration"], summary="Get User History")
@limiter.limit("30/minute")
def get_user_history(request: Request, limit: int = 20, user: Dict[str, Any] = Depends(verify_firebase_user)):
    capped_limit = min(max(limit, 1), 100)
    return {"entries": get_history(user["uid"], capped_limit)}


@app.post("/history", tags=["Configuration"], summary="Add User History Entry")
@limiter.limit("30/minute")
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
@limiter.limit("20/minute")
def redeem_user_credit_code(request: Request, payload: Dict[str, Any], user: Dict[str, Any] = Depends(verify_firebase_user)):
    code = str(payload.get("code", "")).strip()
    if not code:
        raise HTTPException(status_code=400, detail="Code is required")
    code_hash = hash_credit_code(code)
    per_code_key = f"redeem_code:{code_hash}"
    if not consume_rate_limit(per_code_key, max_count=20, window_seconds=900):
        raise HTTPException(status_code=429, detail="Too many attempts for this code. Try again later.")
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


@app.get(
    "/admin/users",
    response_model=AdminUserListResponse,
    tags=["Configuration"],
    summary="List Users For Admin",
)
@limiter.limit("20/minute")
def admin_list_users(
    request: Request,
    q: str = "",
    limit: int = 100,
    _admin: Dict[str, Any] = Depends(verify_admin_session),
):
    del request
    users = search_users(q, limit)
    return {
        "users": users,
        "total": len(users),
        "search": q.strip(),
    }


@app.get(
    "/admin/users/{uid}",
    response_model=AdminUserDetailResponse,
    tags=["Configuration"],
    summary="Get User Detail For Admin",
)
@limiter.limit("30/minute")
def admin_get_user_detail(
    request: Request,
    uid: str,
    _admin: Dict[str, Any] = Depends(verify_admin_session),
):
    del request
    user = get_admin_user_detail(uid)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@app.post("/admin/users/{uid}/credits", tags=["Configuration"], summary="Adjust Credits For Admin")
@limiter.limit("20/minute")
def admin_adjust_user_credits(request: Request, uid: str, payload: Dict[str, Any], admin: Dict[str, Any] = Depends(verify_admin_session), _csrf: None = Depends(verify_admin_csrf)):
    del request, uid, payload, admin
    raise HTTPException(
        status_code=403,
        detail="Manual credit adjustments are disabled. Account balances can only change through credit code redemption and system usage.",
    )


@app.post(
    "/admin/users/{uid}/suspend",
    response_model=AdminUserDetailResponse,
    tags=["Configuration"],
    summary="Suspend User For Admin",
)
@limiter.limit("20/minute")
def admin_suspend_user(
    request: Request,
    uid: str,
    payload: AdminReasonRequest,
    admin: Dict[str, Any] = Depends(verify_admin_session),
    _csrf: None = Depends(verify_admin_csrf),
):
    del request
    try:
        return suspend_user(
            uid,
            reason=payload.reason,
            admin_uid=admin["uid"],
            admin_email=admin["email"],
        )
    except ValueError as exc:
        if str(exc) == "USER_NOT_FOUND":
            raise HTTPException(status_code=404, detail="User not found") from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post(
    "/admin/users/{uid}/unsuspend",
    response_model=AdminUserDetailResponse,
    tags=["Configuration"],
    summary="Unsuspend User For Admin",
)
@limiter.limit("20/minute")
def admin_unsuspend_user(
    request: Request,
    uid: str,
    payload: AdminReasonRequest,
    admin: Dict[str, Any] = Depends(verify_admin_session),
    _csrf: None = Depends(verify_admin_csrf),
):
    del request
    try:
        return unsuspend_user(
            uid,
            reason=payload.reason,
            admin_uid=admin["uid"],
            admin_email=admin["email"],
        )
    except ValueError as exc:
        if str(exc) == "USER_NOT_FOUND":
            raise HTTPException(status_code=404, detail="User not found") from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get(
    "/admin/codes",
    response_model=AdminCreditCodeListResponse,
    tags=["Configuration"],
    summary="List Credit Codes For Admin",
)
@limiter.limit("20/minute")
def admin_list_codes(request: Request, _admin: Dict[str, Any] = Depends(verify_admin_session)):
    del request
    codes = list_credit_codes()
    summaries = list_gift_code_status_summaries()
    return {"codes": codes, "total": len(codes), "summaries": summaries}


@app.get(
    "/admin/code-batches",
    response_model=AdminCreditCodeBatchListResponse,
    tags=["Configuration"],
    summary="List Credit Code Batches For Admin",
)
@limiter.limit("20/minute")
def admin_list_code_batches(request: Request, _admin: Dict[str, Any] = Depends(verify_admin_session)):
    del request
    batches = list_credit_code_batches()
    summaries = list_credit_code_batch_status_summaries()
    return {"batches": batches, "total": len(batches), "summaries": summaries}


@app.post("/admin/codes", tags=["Configuration"], summary="Create Credit Code For Admin")
@limiter.limit("10/minute")
def admin_create_code(request: Request, payload: Dict[str, Any], admin: Dict[str, Any] = Depends(verify_admin_session), _csrf: None = Depends(verify_admin_csrf)):
    del request
    credits = float(payload.get("credits", 0))
    max_claims = int(payload.get("maxClaims", 0))
    try:
        code = create_credit_code(credits, max_claims, admin["uid"])
        add_admin_audit_log(
            admin_uid=admin["uid"],
            admin_email=admin["email"],
            action="credit_code_create",
            target_type="credit_code",
            target_id=str(code.get("codePreview") or "generated"),
            reason=f"Generated gift code worth {credits} credits for up to {max_claims} claims.",
            metadata={
                "code_preview": code.get("codePreview"),
                "credits": code.get("credits"),
                "max_claims": code.get("maxClaims"),
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return code


@app.post("/admin/codes/batch", tags=["Configuration"], summary="Create Batch Credit Codes For Admin")
@limiter.limit("5/minute")
def admin_create_code_batch(request: Request, payload: Dict[str, Any], admin: Dict[str, Any] = Depends(verify_admin_session), _csrf: None = Depends(verify_admin_csrf)):
    del request
    quantity = int(payload.get("quantity", 0))
    credits = float(payload.get("credits", 0))
    title = str(payload.get("title", "")).strip()
    try:
        codes = create_credit_code_batch_with_title(quantity, credits, admin["uid"], title)
        first_code = codes[0] if codes else {}
        add_admin_audit_log(
            admin_uid=admin["uid"],
            admin_email=admin["email"],
            action="credit_code_batch_create",
            target_type="credit_code_batch",
            target_id=str(first_code.get("batchId") or title or "generated-batch"),
            reason=f"Generated {len(codes)} one-time codes titled '{title or 'Untitled batch'}' worth {credits} credits each.",
            metadata={
                "batch_id": first_code.get("batchId"),
                "batch_title": title,
                "quantity": len(codes),
                "credits": credits,
                "sample_preview": first_code.get("codePreview"),
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"codes": codes, "total": len(codes)}


@app.post("/admin/codes/{code_hash}/disable", tags=["Configuration"], summary="Disable Credit Code For Admin")
@limiter.limit("20/minute")
def admin_disable_code(
    request: Request,
    code_hash: str,
    payload: AdminReasonRequest,
    admin: Dict[str, Any] = Depends(verify_admin_session),
    _csrf: None = Depends(verify_admin_csrf),
):
    del request
    try:
        return disable_credit_code(
            code_hash,
            reason=payload.reason,
            admin_uid=admin["uid"],
            admin_email=admin["email"],
        )
    except ValueError as exc:
        if str(exc) == "CODE_NOT_FOUND":
            raise HTTPException(status_code=404, detail="Code not found") from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/admin/codes/{code_hash}/enable", tags=["Configuration"], summary="Enable Credit Code For Admin")
@limiter.limit("20/minute")
def admin_enable_code(
    request: Request,
    code_hash: str,
    payload: AdminReasonRequest,
    admin: Dict[str, Any] = Depends(verify_admin_session),
    _csrf: None = Depends(verify_admin_csrf),
):
    del request
    try:
        return enable_credit_code(
            code_hash,
            reason=payload.reason,
            admin_uid=admin["uid"],
            admin_email=admin["email"],
        )
    except ValueError as exc:
        if str(exc) == "CODE_NOT_FOUND":
            raise HTTPException(status_code=404, detail="Code not found") from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/admin/code-batches/{batch_id}/disable", tags=["Configuration"], summary="Disable Credit Code Batch For Admin")
@limiter.limit("20/minute")
def admin_disable_code_batch(
    request: Request,
    batch_id: str,
    payload: AdminReasonRequest,
    admin: Dict[str, Any] = Depends(verify_admin_session),
    _csrf: None = Depends(verify_admin_csrf),
):
    del request
    try:
        return disable_credit_code_batch(
            batch_id,
            reason=payload.reason,
            admin_uid=admin["uid"],
            admin_email=admin["email"],
        )
    except ValueError as exc:
        if str(exc) == "BATCH_NOT_FOUND":
            raise HTTPException(status_code=404, detail="Batch not found") from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/admin/code-batches/{batch_id}/enable", tags=["Configuration"], summary="Enable Credit Code Batch For Admin")
@limiter.limit("20/minute")
def admin_enable_code_batch(
    request: Request,
    batch_id: str,
    payload: AdminReasonRequest,
    admin: Dict[str, Any] = Depends(verify_admin_session),
    _csrf: None = Depends(verify_admin_csrf),
):
    del request
    try:
        return enable_credit_code_batch(
            batch_id,
            reason=payload.reason,
            admin_uid=admin["uid"],
            admin_email=admin["email"],
        )
    except ValueError as exc:
        if str(exc) == "BATCH_NOT_FOUND":
            raise HTTPException(status_code=404, detail="Batch not found") from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get(
    "/admin/jobs",
    response_model=AdminGenerationJobListResponse,
    tags=["Configuration"],
    summary="List Generation Jobs For Admin",
)
@limiter.limit("20/minute")
def admin_list_generation_jobs(
    request: Request,
    status: str = "",
    limit: int = 100,
    _admin: Dict[str, Any] = Depends(verify_admin_session),
):
    del request
    jobs = list_admin_generation_jobs(status, limit)
    return {
        "jobs": jobs,
        "total": len(jobs),
        "status": status.strip().lower(),
    }


@app.get(
    "/admin/jobs/{job_id}",
    response_model=AdminGenerationJobItem,
    tags=["Configuration"],
    summary="Get Generation Job For Admin",
)
@limiter.limit("30/minute")
def admin_get_generation_job(
    request: Request,
    job_id: str,
    _admin: Dict[str, Any] = Depends(verify_admin_session),
):
    del request
    job = get_admin_generation_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Generation job not found")
    return job


@app.get(
    "/admin/logs",
    response_model=AdminAuditLogListResponse,
    tags=["Configuration"],
    summary="List Admin Audit Logs",
)
@limiter.limit("20/minute")
def admin_list_audit_logs(
    request: Request,
    limit: int = 100,
    admin_uid: str = "",
    action: str = "",
    target_type: str = "",
    target_id: str = "",
    _admin: Dict[str, Any] = Depends(verify_admin_session),
):
    del request
    logs = list_admin_audit_logs(
        limit=limit,
        admin_uid=admin_uid,
        action=action,
        target_type=target_type,
        target_id=target_id,
    )
    return {
        "logs": logs,
        "total": len(logs),
        "adminUid": admin_uid.strip(),
        "action": action.strip(),
        "targetType": target_type.strip(),
        "targetId": target_id.strip(),
    }


@app.get(
    "/admin/auth-failures",
    response_model=AdminAuthFailureSummaryResponse,
    tags=["Configuration"],
    summary="List Admin Auth Failure Summaries",
)
@limiter.limit("20/minute")
def admin_list_auth_failure_summaries(
    request: Request,
    _admin: Dict[str, Any] = Depends(verify_admin_session),
):
    del request
    summaries = list_admin_auth_failure_summaries()
    return {
        "summaries": summaries,
        "total": len(summaries),
    }


@app.post(
    "/generate",
    response_model=GenerationResult,
    tags=["Generation"],
    summary="Generate AI Content",
    description="Submit a content generation request to create images, captions, or both."
)
@limiter.limit("5/minute")
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
    generation_job_id: str | None = None
    try:
        catalog_store.get_catalog()
        _validate_generate_request(payload)
        effective_status = _resolve_generation_status(payload)
        direct_generation = effective_status == "generating"
        _enforce_mode_specific_generate_limits(request, payload, user, direct_generation=direct_generation)

        if not direct_generation:
            analyze_key = f"analyze:{user['uid']}"
            if not consume_rate_limit(analyze_key, max_count=20, window_seconds=3600):
                raise HTTPException(status_code=429, detail="Analyze limit reached. Try again later.")

        if direct_generation:
            charged_cost = _estimate_generation_cost(payload)
            charge_metadata = {
                "mode": payload.mode,
                "requested_outputs": payload.requested_outputs,
                "image_model": (payload.user_preferences or {}).get("image_model"),
                "caption_model": (payload.user_preferences or {}).get("caption_model"),
            }
            try:
                reservation = reserve_generation_credits(
                    user["uid"],
                    payload.user_text,
                    payload.requested_outputs,
                    {
                        "user_preferences": payload.user_preferences or {},
                        "status": effective_status,
                        "mode": payload.mode,
                        "user_corrections": payload.user_corrections or {},
                        "input_image": payload.input_image.model_dump() if payload.input_image else None,
                        **charge_metadata,
                    },
                    charged_cost,
                )
                generation_job_id = str((reservation.get("job") or {}).get("id") or "")
                charged_applied = charged_cost > 0
            except ValueError as exc:
                if str(exc) == "INSUFFICIENT_CREDITS":
                    raise HTTPException(status_code=402, detail="Insufficient credits") from exc
                raise
        else:
            job = create_generation_job(
                user["uid"],
                payload.user_text,
                payload.requested_outputs,
                {
                    "user_preferences": payload.user_preferences or {},
                    "status": effective_status,
                    "mode": payload.mode,
                    "user_corrections": payload.user_corrections or {},
                    "input_image": payload.input_image.model_dump() if payload.input_image else None,
                },
                status="processing",
            )
            generation_job_id = str(job.get("id") or "")

        input_image = _prepare_input_image(payload.input_image)

        initial_state = {
            "user_text": payload.user_text,
            "requested_outputs": payload.requested_outputs,
            "input_image": input_image,
            "user_preferences": payload.user_preferences or {},
            "status": effective_status,
        }
        if payload.user_corrections:
            initial_state["user_corrections"] = payload.user_corrections

        final_state = studio_graph_app.invoke(initial_state)

        if final_state.get("status") == "awaiting_review":
            if payload.mode == "quick":
                if charged_applied and charged_cost > 0 and generation_job_id:
                    release_generation_credits(generation_job_id, "quick_mode_unexpected_review")
                return GenerationResult(
                    status="error",
                    meta={
                        "mode": payload.mode,
                        "error_message": "Quick mode cannot enter the review step.",
                    },
                )
            if generation_job_id:
                mark_generation_job_awaiting_review(generation_job_id)
            if payload.mode == "smart":
                analyze_session = create_analyze_session_with_charge(
                    user["uid"],
                    payload.user_text,
                    settings.analyze_abandon_fee,
                    settings.smart_analysis_fee,
                )
            else:
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
                    "mode": payload.mode,
                    "smart_analysis_fee": analyze_session.get("analysisFee", 0),
                    "analyze_session_id": analyze_session["id"],
                    "analyze_abandon_fee": analyze_session["fee"],
                    "current_balance": analyze_session.get("balance"),
                },
            )
        elif final_state.get("status") == "complete":
            final_payload = final_state.get("final_response", {})
            delivery_error = _validate_generation_results(payload.requested_outputs, final_payload.get("results"))
            if delivery_error:
                if charged_applied and charged_cost > 0 and generation_job_id:
                    release_generation_credits(generation_job_id, delivery_error)
                current_profile = get_user(user["uid"])
                return GenerationResult(
                    status="error",
                    meta={
                        "mode": payload.mode,
                        "error_message": "We couldn't deliver the generated result. No credits were charged.",
                        "current_balance": current_profile.get("credits", 0),
                    },
                )
            if generation_job_id:
                capture_generation_credits(generation_job_id)
            current_profile = get_user(user["uid"])
            return GenerationResult(
                status="success",
                results=final_payload.get("results"),
                meta={
                    "mode": payload.mode,
                    **(final_payload.get("meta") or {}),
                    "charged_cost": charged_cost,
                    "current_balance": current_profile.get("credits", 0),
                },
            )
        elif final_state.get("status") == "error":
            failure_reason = str(
                (final_state.get("final_response", {}).get("meta") or {}).get("failure_reason")
                or final_state.get("failure_reason")
                or "generation_delivery_failed"
            )
            if charged_applied and charged_cost > 0 and generation_job_id:
                release_generation_credits(generation_job_id, failure_reason)
            current_profile = get_user(user["uid"])
            error_message = str(
                (final_state.get("final_response", {}).get("meta") or {}).get("error_message")
                or final_state.get("error_message")
                or "We couldn't deliver the generated result. No credits were charged."
            )
            return GenerationResult(
                status="error",
                meta={
                    "mode": payload.mode,
                    "error_message": error_message,
                    "current_balance": current_profile.get("credits", 0),
                },
            )
        else:
            if charged_applied and charged_cost > 0:
                if generation_job_id:
                    release_generation_credits(generation_job_id, "workflow_unexpected_status")
            return GenerationResult(
                status="error",
                meta={
                    "mode": payload.mode,
                    "error_message": f"Workflow ended with unexpected status: {final_state.get('status')}",
                }
            )

    except ValueError as exc:
        if str(exc) == "TOO_MANY_PENDING_ANALYZE_SESSIONS":
            add_admin_audit_log(
                admin_uid=None,
                admin_email=SYSTEM_AUDIT_EMAIL,
                action="usage_pending_review_limit_hit",
                target_type="user",
                target_id=str(user["uid"]),
                reason="User hit the concurrent Smart review limit.",
                metadata={
                    "uid": str(user["uid"]),
                    "mode": payload.mode,
                    "max_pending_reviews": settings.max_pending_analyze_sessions_per_user,
                    "pending_review_ttl_seconds": settings.pending_analyze_session_ttl_seconds,
                },
            )
            raise HTTPException(
                status_code=429,
                detail=(
                    f"You cannot start a new Smart review right now because this account already has "
                    f"{settings.max_pending_analyze_sessions_per_user} other Smart reviews in progress. "
                    f"Finish one, leave one, or wait about {_format_wait_window(settings.pending_analyze_session_ttl_seconds)}."
                ),
            ) from exc
        if str(exc) == "USAGE_CAP_REACHED":
            user_created_at = int((user.get("profile") or {}).get("createdAt") or 0)
            now = int(time.time())
            if user_created_at and now < user_created_at + (24 * 60 * 60):
                raise HTTPException(
                    status_code=429,
                    detail="This new account reached its first-24-hours usage limit of 1 credit. Please wait until the first day passes.",
                ) from exc
            raise HTTPException(
                status_code=429,
                detail="This account reached its daily usage limit of 5 credits. Please try again later.",
            ) from exc
        if str(exc) == "INSUFFICIENT_CREDITS":
            if charged_applied and charged_cost > 0:
                try:
                    if generation_job_id:
                        release_generation_credits(generation_job_id, "insufficient_credits")
                except Exception:
                    pass
            raise HTTPException(status_code=402, detail="Insufficient credits") from exc
        if charged_applied and charged_cost > 0:
            try:
                if generation_job_id:
                    release_generation_credits(generation_job_id, "validation_or_provider_rejection")
            except Exception:
                pass
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except ApiKeyManagerProxyError as exc:
        failure_reason = f"provider_{exc.error_type}"
        if charged_applied and charged_cost > 0:
            try:
                if generation_job_id:
                    release_generation_credits(generation_job_id, failure_reason)
            except Exception:
                pass
        current_profile = get_user(user["uid"])
        return GenerationResult(
            status="error",
            meta={
                "mode": payload.mode,
                "error_message": _provider_error_message(exc),
                "failure_reason": failure_reason,
                "provider_error": exc.to_metadata(),
                "current_balance": current_profile.get("credits", 0),
            },
        )
    except Exception as e:
        if charged_applied and charged_cost > 0:
            try:
                if generation_job_id:
                    release_generation_credits(generation_job_id, "exception")
            except Exception:
                pass
        print(f"Server Error: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal error occurred. Please try again later.")


def _resolve_generation_status(payload: GenerateRequest) -> str:
    if payload.mode == "quick":
        return "generating"
    return payload.status or "processing"


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
        total_cost += _effective_model_cost(task, valid_models.get(model_name, {}))

    return round(total_cost, 2)


def _validate_generation_results(requested_outputs: list[str], results: Any) -> str | None:
    if not isinstance(results, dict):
        return "generation_results_missing"

    for task in requested_outputs or []:
        value = results.get(task)
        if task == "image":
            if not _is_valid_generated_image_result(value):
                return "generated_image_missing_or_invalid"
            continue
        if task == "caption":
            if not _is_valid_generated_text_result(value):
                return "generated_text_missing_or_invalid"
            continue

    return None


def _is_valid_generated_text_result(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    text = value.strip()
    if not text:
        return False
    if _looks_like_generation_error(text):
        return False
    return True


def _is_valid_generated_image_result(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    image_url = value.strip()
    if not image_url or _looks_like_generation_error(image_url):
        return False
    prefix = _uploaded_image_url_prefix()
    if not image_url.startswith(prefix):
        return False

    parsed = urlparse(image_url)
    filename = Path(parsed.path).name
    if not SAFE_GENERATED_FILENAME.match(filename):
        return False
    return (IMAGES_DIR / filename).exists()


def _looks_like_generation_error(value: str) -> bool:
    lowered = value.strip().lower()
    return lowered.startswith("generation failed:") or lowered.startswith("error:")


def _provider_error_message(error: ApiKeyManagerProxyError) -> str:
    if error.error_type == "timeout":
        return "The generation service took too long to respond. No credits were charged. Please try again."
    if error.error_type == "network_error":
        return "The generation service is temporarily unreachable. No credits were charged. Please try again."
    if error.error_type == "provider_internal_error":
        return "The generation service is temporarily unavailable. No credits were charged. Please try again."
    if error.error_type == "rate_limit":
        return "The generation service is busy right now. No credits were charged. Please wait a moment and try again."
    if error.error_type == "auth_error":
        return "The generation service is currently unavailable. No credits were charged. Please try again later."
    if error.error_type == "bad_request":
        return "This generation request could not be processed. No credits were charged."
    if error.error_type == "invalid_output":
        return "We couldn't deliver the generated result. No credits were charged."
    return "We couldn't deliver the generated result. No credits were charged."


def _plain_chat_error_message(error_code: str) -> str:
    if error_code == "INSUFFICIENT_CREDITS":
        return "Insufficient credits"
    if error_code == "CHAT_MODEL_REQUIRED":
        return "A chat model is required."
    if error_code == "CHAT_MODEL_NOT_FOUND":
        return "The selected chat model is no longer available. Refresh the model list and try again."
    if error_code == "CHAT_MODEL_PROVIDER_MISSING" or error_code == "CHAT_MODEL_ID_MISSING":
        return "The selected chat model is misconfigured."
    if error_code == "CHAT_LAST_MESSAGE_MUST_BE_USER":
        return "The final chat message must be a user message."
    if error_code == "CHAT_MODEL_DOES_NOT_SUPPORT_IMAGE_INPUT":
        return "The selected chat model does not support image input."
    if error_code == "CHAT_IMAGE_URL_INVALID":
        return "Only Vibecraft uploaded image URLs are allowed."
    if error_code == "CHAT_REQUEST_TOO_LARGE":
        return "This chat request is too large."
    if error_code == "CHAT_TEXT_PART_TOO_LARGE":
        return "One chat message is too long."
    if error_code == "CHAT_MESSAGE_TOO_LARGE":
        return "This message is too large."
    if error_code == "CHAT_SYSTEM_TOO_LARGE":
        return "The chat instructions are too large."
    if error_code == "CHAT_CONTEXT_TOO_LARGE":
        return "This conversation window is too large to send."
    if error_code == "CHAT_EMPTY_PROVIDER_RESPONSE":
        return "The chat model returned an empty reply."
    if error_code == "CHAT_INVALID_PROVIDER_RESPONSE":
        return "The chat model returned an invalid response."
    if error_code.startswith("CHAT_"):
        return "This chat request could not be processed."
    return error_code


def _effective_model_cost(task: str, model_config: dict[str, Any] | None) -> float:
    raw_cost = float((model_config or {}).get("cost", 0) or 0)
    floor = _minimum_generation_cost_for_task(task)
    return round(max(raw_cost, floor), 2)


def _minimum_generation_cost_for_task(task: str) -> float:
    if task == "image":
        return round(settings.minimum_image_generation_cost, 2)
    return round(settings.minimum_text_generation_cost, 2)


def _catalog_with_effective_costs(model_catalog: dict[str, Any]) -> dict[str, Any]:
    adjusted: dict[str, Any] = {}
    for task, models in (model_catalog or {}).items():
        adjusted[task] = {}
        for model_name, model_config in (models or {}).items():
            next_config = dict(model_config or {})
            next_config["cost"] = _effective_model_cost(task, next_config)
            adjusted[task][model_name] = next_config
    return adjusted


def _collect_catalog_cost_warnings(model_catalog: dict[str, Any]) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    for task, models in (model_catalog or {}).items():
        floor = _minimum_generation_cost_for_task(task)
        for model_name, model_config in (models or {}).items():
            configured_cost = float((model_config or {}).get("cost", 0) or 0)
            if configured_cost >= floor:
                continue
            display_name = str((model_config or {}).get("display_name") or model_name)
            warnings.append(
                {
                    "type": "catalog_cost_floor",
                    "task": task,
                    "model": model_name,
                    "display_name": display_name,
                    "configured_cost": round(configured_cost, 2),
                    "minimum_cost": floor,
                    "message": (
                        f"{display_name} is priced at {configured_cost:.2f} credits, below the enforced "
                        f"{task} floor of {floor:.2f}."
                    ),
                }
            )
    return warnings


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

    _validate_selected_model_exists("caption", prefs, wants_caption)
    _validate_selected_model_exists("image", prefs, wants_image)

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
    if user_choice:
        return user_choice if user_choice in valid_models else None
    return next(iter(valid_models), None)


def _validate_selected_model_exists(task: str, prefs: Dict[str, str], is_requested: bool) -> None:
    if not is_requested:
        return

    user_choice = (prefs.get(f"{task}_model") or prefs.get(task) or "").strip()
    if not user_choice:
        return

    valid_models = settings.model_catalog.get(task, {})
    if user_choice not in valid_models:
        raise HTTPException(
            status_code=400,
            detail=f"The selected {task} model '{user_choice}' is no longer available. Refresh the model list and try again.",
        )


def _validate_input_image(input_image) -> None:
    if input_image.url:
        _validate_uploaded_image_url(input_image.url)
        return

    raise HTTPException(status_code=400, detail="Uploaded image URL is required")


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
        _validate_uploaded_image_url(input_image.url)
        return {"url": input_image.url, "mime_type": input_image.mime_type or ""}

    return None


def _validate_uploaded_image_url(image_url: str) -> None:
    prefix = _uploaded_image_url_prefix()
    if not image_url.startswith(prefix):
        raise HTTPException(status_code=400, detail="Only Vibecraft uploaded image URLs are allowed")

    parsed = urlparse(image_url)
    filename = Path(parsed.path).name
    if not SAFE_UPLOADED_FILENAME.match(filename):
        raise HTTPException(status_code=400, detail="Uploaded image URL is invalid")


def _uploaded_image_url_prefix() -> str:
    return f"{settings.public_backend_base_url}/images/"


def _uploaded_image_url_for_filename(filename: str) -> str:
    return f"{_uploaded_image_url_prefix()}{filename}"


def _save_uploaded_input_image_bytes(mime_type: str, image_bytes: bytes) -> str:
    extension = _extension_for_mime_type(mime_type)
    filename = f"{os.urandom(16).hex()}.{extension}"
    save_path = UPLOADED_IMAGES_DIR / filename
    with open(save_path, "wb") as image_file:
        image_file.write(image_bytes)
    return filename


def _cleanup_expired_uploaded_images() -> None:
    cutoff = time.time() - UPLOAD_RETENTION_SECONDS
    for file_path in UPLOADED_IMAGES_DIR.iterdir():
        if not file_path.is_file():
            continue
        if not SAFE_UPLOADED_FILENAME.match(file_path.name):
            continue
        try:
            if file_path.stat().st_mtime < cutoff:
                file_path.unlink(missing_ok=True)
        except FileNotFoundError:
            continue


def _verify_uploaded_image_cleanup_health() -> None:
    verification_key = "uploads:cleanup:verification"
    if not consume_rate_limit(verification_key, max_count=1, window_seconds=60 * 60):
        return

    now = time.time()
    stale_count = 0
    for file_path in UPLOADED_IMAGES_DIR.iterdir():
        if not file_path.is_file():
            continue
        if not SAFE_UPLOADED_FILENAME.match(file_path.name):
            continue
        try:
            if file_path.stat().st_mtime < (now - UPLOAD_RETENTION_SECONDS):
                stale_count += 1
        except FileNotFoundError:
            continue

    if stale_count > 0:
        add_admin_audit_log(
            admin_uid=None,
            admin_email=SYSTEM_AUDIT_EMAIL,
            action="upload_cleanup_verification_failed",
            target_type="system",
            target_id="uploaded_images",
            reason="Stale uploaded images remained after cleanup verification.",
            metadata={"stale_file_count": stale_count},
        )


def _enforce_upload_limits(request: Request, uid: str) -> None:
    ip = get_remote_address(request)
    user_key = f"upload:user:{uid}"
    ip_key = f"upload:ip:{ip}"
    window_seconds = settings.upload_window_seconds

    if not consume_rate_limit(user_key, max_count=settings.upload_user_limit, window_seconds=window_seconds):
        _record_upload_limit_audit_event(uid=uid, ip=ip, source="user", window_seconds=window_seconds)
        raise HTTPException(
            status_code=429,
            detail=f"You hit the upload rate limit. Please wait about {_format_wait_window(window_seconds)} and try again.",
        )

    if not consume_rate_limit(ip_key, max_count=settings.upload_ip_limit, window_seconds=window_seconds):
        _record_upload_limit_audit_event(uid=uid, ip=ip, source="ip", window_seconds=window_seconds)
        raise HTTPException(
            status_code=429,
            detail=f"You hit the upload rate limit. Please wait about {_format_wait_window(window_seconds)} and try again.",
        )


def _record_upload_limit_audit_event(*, uid: str, ip: str, source: str, window_seconds: int) -> None:
    audit_key = f"audit:upload_limit:{source}:{uid}:{ip}"
    if not consume_rate_limit(audit_key, max_count=1, window_seconds=window_seconds):
        return
    add_admin_audit_log(
        admin_uid=None,
        admin_email=SYSTEM_AUDIT_EMAIL,
        action="upload_rate_limit_hit",
        target_type="user",
        target_id=uid,
        reason="Uploaded image rate limit was triggered.",
        metadata={
            "uid": uid,
            "ip": ip,
            "source": source,
            "window_seconds": window_seconds,
        },
    )


def _inspect_uploaded_image_bytes(image_bytes: bytes) -> tuple[str, int, int]:
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return ("image/png", *_parse_png_dimensions(image_bytes))
    if image_bytes.startswith(b"\xff\xd8"):
        return ("image/jpeg", *_parse_jpeg_dimensions(image_bytes))
    if image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
        return ("image/webp", *_parse_webp_dimensions(image_bytes))
    raise HTTPException(status_code=400, detail="Unsupported or invalid image file")


def _parse_png_dimensions(image_bytes: bytes) -> tuple[int, int]:
    if len(image_bytes) < 24 or image_bytes[12:16] != b"IHDR":
        raise HTTPException(status_code=400, detail="Invalid PNG image")
    width = struct.unpack(">I", image_bytes[16:20])[0]
    height = struct.unpack(">I", image_bytes[20:24])[0]
    return width, height


def _parse_jpeg_dimensions(image_bytes: bytes) -> tuple[int, int]:
    index = 2
    end = len(image_bytes)
    while index + 9 < end:
        if image_bytes[index] != 0xFF:
            index += 1
            continue
        while index < end and image_bytes[index] == 0xFF:
            index += 1
        if index >= end:
            break
        marker = image_bytes[index]
        index += 1
        if marker in {0xD8, 0xD9}:
            continue
        if index + 2 > end:
            break
        segment_length = struct.unpack(">H", image_bytes[index:index + 2])[0]
        if segment_length < 2 or index + segment_length > end:
            break
        if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
            if index + 7 > end:
                break
            height = struct.unpack(">H", image_bytes[index + 3:index + 5])[0]
            width = struct.unpack(">H", image_bytes[index + 5:index + 7])[0]
            return width, height
        index += segment_length
    raise HTTPException(status_code=400, detail="Invalid JPEG image")


def _parse_webp_dimensions(image_bytes: bytes) -> tuple[int, int]:
    if len(image_bytes) < 30:
        raise HTTPException(status_code=400, detail="Invalid WEBP image")
    chunk_type = image_bytes[12:16]
    if chunk_type == b"VP8X":
        width = 1 + int.from_bytes(image_bytes[24:27], "little")
        height = 1 + int.from_bytes(image_bytes[27:30], "little")
        return width, height
    if chunk_type == b"VP8 ":
        if len(image_bytes) < 30:
            raise HTTPException(status_code=400, detail="Invalid WEBP image")
        width = struct.unpack("<H", image_bytes[26:28])[0] & 0x3FFF
        height = struct.unpack("<H", image_bytes[28:30])[0] & 0x3FFF
        return width, height
    if chunk_type == b"VP8L":
        if len(image_bytes) < 25:
            raise HTTPException(status_code=400, detail="Invalid WEBP image")
        bits = int.from_bytes(image_bytes[21:25], "little")
        width = (bits & 0x3FFF) + 1
        height = ((bits >> 14) & 0x3FFF) + 1
        return width, height
    raise HTTPException(status_code=400, detail="Invalid WEBP image")


def _extension_for_mime_type(mime_type: str) -> str:
    if mime_type == "image/png":
        return "png"
    if mime_type == "image/webp":
        return "webp"
    return "jpg"
