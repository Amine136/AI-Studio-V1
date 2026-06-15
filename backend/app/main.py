import os
import re
import secrets
import json
import base64
import time
import struct
import threading
import uuid
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
from app.core.schema import AdminAuditLogListResponse, AdminAuthFailureSummaryResponse, AdminCreditCodeBatchListResponse, AdminCreditCodeListResponse, AdminGenerationJobItem, AdminGenerationJobListResponse, AdminLoginRequest, AdminReasonRequest, AdminSessionResponse, AdminUserDetailResponse, AdminUserListResponse, CatalogUpdateNotification, CreditActivityListResponse, CreditLedgerListResponse, DashboardNewsItemResponse, DashboardNewsListResponse, DashboardNewsUpsertRequest, GenerateRequest, GenerationResult, PlainChatConversationCreateRequest, PlainChatConversationItem, PlainChatConversationListResponse, PlainChatConversationMessageCreateRequest, PlainChatConversationMessagesResponse, PlainChatConversationTurnResponse, PlainChatConversationUpdateRequest, PlainChatModelListResponse, SystemConfig, UserNotificationPreferencesUpdateRequest, UserProfileUpdateRequest
from app.db.session import session_scope
from app.db.repositories.security import SecurityRepository
from app.graph.workflow import studio_graph_app
from app.services.admin_auth import AdminAuthRateLimitError, authenticate_admin, list_admin_auth_failure_summaries, revoke_admin_session
from app.services.apikeymanager_client import ApiKeyManagerProxyError, check_apikeymanager_ready
from app.services.auth import verify_admin_csrf, verify_admin_session, verify_api_key, verify_firebase_user
from app.services.catalog_store import catalog_store
from app.services.model_visibility import filter_catalog, list_model_visibility, update_model_visibility
from app.services.chat_service import assemble_plain_chat_context, list_plain_chat_models, minimum_required_credits_for_plain_chat, normalize_plain_chat_system, prepare_plain_chat_conversation_request, preview_plain_chat_prompt, send_plain_chat, serialize_plain_chat_parts
from app.services.security_backend import (
    add_history_entry,
    add_chat_turn,
    abandon_analyze_session,
    refund_analyze_session,
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
    create_dashboard_news_item,
    create_generation_job,
    deactivate_user_account,
    delete_chat_conversation,
    delete_dashboard_news_item,
    delete_history_entries_by_image_urls,
    disable_credit_code_batch,
    disable_credit_code,
    enable_credit_code,
    enable_credit_code_batch,
    get_admin_generation_job,
    get_admin_user_detail,
    get_chat_conversation,
    get_chat_messages,
    get_history,
    count_history,
    get_credit_breakdown,
    get_profile_change_status,
    get_user,
    hash_credit_code,
    list_admin_audit_logs,
    list_admin_generation_jobs,
    list_chat_conversations,
    list_credit_activity_entries,
    list_credit_ledger_entries,
    list_dashboard_news_items,
    update_chat_conversation_title,
    list_credit_code_batches,
    list_credit_code_batch_status_summaries,
    list_credit_codes,
    list_gift_code_status_summaries,
    list_users,
    search_users_with_total,
    mark_generation_job_awaiting_review,
    preload_security_store,
    redeem_credit_code,
    release_generation_credits,
    reserve_generation_credits,
    sweep_all_expired_credits,
    suspend_user,
    unsuspend_user,
    update_dashboard_news_item,
    update_user_profile,
    update_user_notification_preferences,
)
from app.services.user_files import (
    APIKEYMANAGER_GENERATED_IMAGE_DIRS,
    GENERATED_IMAGES_DIR,
    GENERATED_IMAGE_SAFE_HEADERS,
    generated_image_media_type,
    SAFE_FILE_ID,
    SAFE_GENERATED_FILENAME,
    UPLOADED_IMAGES_DIR,
    create_uploaded_user_file_record,
    delete_private_user_file_by_id,
    generated_image_url_prefixes,
    get_private_user_file_record,
    load_private_user_file,
    private_file_id_from_url,
    private_file_url,
    private_file_url_prefix,
)

MAX_INPUT_IMAGES = 4
# Editing models (e.g. Grok Imagine "*-editing") accept fewer source images than the
# global ceiling — Grok's edit endpoint takes at most 3.
MAX_EDITING_INPUT_IMAGES = 3
EDITING_MODEL_SUFFIX = "-editing"

SYSTEM_AUDIT_EMAIL = "system@vibecraft.local"
IMAGES_DIR = GENERATED_IMAGES_DIR
DEFAULT_PLAIN_CHAT_TITLE = "New Chat"
PLAIN_CHAT_TITLE_UPDATE_LIMIT = 20
PLAIN_CHAT_TITLE_UPDATE_WINDOW_SECONDS = 15 * 60

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
    return f"ip:{_get_client_ip(request)}"


def _get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        first_ip = forwarded_for.split(",", 1)[0].strip()
        if first_ip:
            return first_ip

    real_ip = request.headers.get("x-real-ip", "").strip()
    if real_ip:
        return real_ip

    return get_remote_address(request)


def _enforce_mode_specific_generate_limits(request: Request, payload: GenerateRequest, user: Dict[str, Any], *, direct_generation: bool) -> None:
    uid = str(user["uid"])
    ip = _get_client_ip(request)

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
    ip = _get_client_ip(request)
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

# Bounded-concurrency admission control for /generate (Finding #10).
# Caps in-flight generations PER WORKER so slow provider calls cannot exhaust
# the shared anyio threadpool and starve other sync endpoints. Per-worker, so
# the effective global cap is GENERATION_MAX_CONCURRENCY x gunicorn workers.
GENERATION_MAX_CONCURRENCY = max(1, int(os.getenv("GENERATION_MAX_CONCURRENCY", "12")))
_GENERATION_GATE = threading.BoundedSemaphore(GENERATION_MAX_CONCURRENCY)

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

allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-API-Key", "X-CSRF-Token"],
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
    description="Retrieve a generated output image by filename. Only generated image filenames are accepted."
)
@app.get(
    "/generated-images/{filename}",
    tags=["Generation"],
    include_in_schema=False
)
def get_image(filename: str):
    """Serves generated images with filename validation."""
    if not SAFE_GENERATED_FILENAME.match(filename):
        raise HTTPException(status_code=400, detail="Invalid filename")

    filepath = GENERATED_IMAGES_DIR / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Image not found")
    
    return FileResponse(
        filepath,
        media_type=generated_image_media_type(filename),
        headers=GENERATED_IMAGE_SAFE_HEADERS,
    )


@app.get(
    "/files/{file_id}",
    tags=["Generation"],
    summary="Get Private User File",
    description="Retrieve a private uploaded file owned by the current authenticated user.",
)
def get_private_user_file(
    file_id: str,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    file_record, filepath = load_private_user_file(file_id, str(user["uid"]))
    return FileResponse(
        filepath,
        media_type=str(file_record["mime_type"]),
        headers={
            "Cache-Control": "private, max-age=3600",
            "Vary": "Authorization",
            **GENERATED_IMAGE_SAFE_HEADERS,
        },
    )


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
    file_id = create_uploaded_user_file_record(str(user["uid"]), filename, image.content_type)
    return {
        "id": file_id,
        "name": image.filename or filename,
        "mime_type": image.content_type,
        "url": private_file_url(file_id),
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
    model_catalog = _catalog_with_parameter_schemas(filter_catalog(catalog_store.get_catalog()))
    return SystemConfig(
        field_options=settings.field_options,
        model_catalog=model_catalog,
        smart_analysis_fee=settings.smart_analysis_fee,
        minimum_text_generation_cost=round(settings.minimum_text_generation_cost, 3),
        minimum_image_generation_cost=round(settings.minimum_image_generation_cost, 2),
        catalog_warnings=_collect_catalog_cost_warnings(model_catalog),
    )


@app.get(
    "/chat/models",
    response_model=PlainChatModelListResponse,
    tags=["Chat"],
    summary="List Plain Chat Models",
    description="Return available catalog models for the dedicated plain-chat flow.",
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
        _normalize_plain_chat_title(payload.title),
    )
    return PlainChatConversationItem.model_validate(conversation)


@app.patch(
    "/chat/conversations/{conversation_id}",
    response_model=PlainChatConversationItem,
    tags=["Chat"],
    summary="Update Plain Chat Conversation",
    description="Update metadata for a stored plain-chat conversation.",
)
@limiter.limit("30/minute")
def update_plain_chat_conversation_item(
    request: Request,
    conversation_id: str,
    payload: PlainChatConversationUpdateRequest,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    del request
    existing_conversation = get_chat_conversation(user["uid"], conversation_id)
    if existing_conversation is None:
        raise HTTPException(status_code=404, detail="Chat conversation not found")

    normalized_title = _normalize_plain_chat_title(payload.title)
    if normalized_title == _normalize_plain_chat_title(str(existing_conversation.get("title") or DEFAULT_PLAIN_CHAT_TITLE)):
        return PlainChatConversationItem.model_validate(existing_conversation)

    if not _allow_plain_chat_title_update(user["uid"]):
        return PlainChatConversationItem.model_validate(existing_conversation)

    conversation = update_chat_conversation_title(
        user["uid"],
        conversation_id,
        normalized_title,
    )
    return PlainChatConversationItem.model_validate(conversation)


@app.delete(
    "/chat/conversations/{conversation_id}",
    status_code=204,
    tags=["Chat"],
    summary="Delete Plain Chat Conversation",
    description="Delete one stored plain-chat conversation and its messages for the current user.",
)
@limiter.limit("20/minute")
def delete_plain_chat_conversation_item(
    request: Request,
    conversation_id: str,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    del request
    conversation = get_chat_conversation(user["uid"], conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Chat conversation not found")
    existing_messages = get_chat_messages(user["uid"], conversation_id, 500)
    image_urls = _collect_chat_message_image_urls(existing_messages)
    deleted = delete_chat_conversation(user["uid"], conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Chat conversation not found")
    delete_history_entries_by_image_urls(user["uid"], image_urls)
    _delete_chat_conversation_images(image_urls)
    return Response(status_code=204)


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

    try:
        catalog_store.get_catalog()
        _enforce_plain_chat_request_size(request)
        _enforce_plain_chat_limits(request, user)

        conversation = get_chat_conversation(user["uid"], conversation_id)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Chat conversation not found")

        current_profile = get_user(user["uid"])
        current_credits = float((current_profile or {}).get("credits", 0) or 0)
        model_name = str(conversation.get("model") or "")
        minimum_required = minimum_required_credits_for_plain_chat(model_name)
        if current_credits < minimum_required:
            raise HTTPException(
                status_code=402,
                detail=(
                    "Insufficient credits for the minimum required cost. "
                    f"You need at least {minimum_required:.4f} credits for this chat model."
                ),
            )
        chat_activity_id = f"chat_turn:{uuid.uuid4()}"
        user_parts = serialize_plain_chat_parts(payload.parts)
        prompt_preview = _derive_plain_chat_title_from_parts(user_parts) or "Plain Chat"
        chat_activity_metadata = {
            "activity_id": chat_activity_id,
            "activity_type": "chat",
            "activity_label": f'Chat: "{prompt_preview}"',
            "conversation_id": conversation_id,
            "prompt_preview": prompt_preview,
        }

        existing_messages = get_chat_messages(user["uid"], conversation_id, 200)
        auto_title = None
        existing_title = _normalize_plain_chat_title(str(conversation.get("title") or DEFAULT_PLAIN_CHAT_TITLE))
        if len(existing_messages) == 0 and existing_title == DEFAULT_PLAIN_CHAT_TITLE:
            auto_title = _derive_plain_chat_title_from_parts(user_parts)
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

        try:
            result = send_plain_chat(request_payload, user_uid=str(user["uid"]))
        except Exception:
            raise

        assistant_message = result.get("message")
        if not isinstance(assistant_message, dict):
            raise ValueError("CHAT_INVALID_PROVIDER_RESPONSE")

        resolved_cost_raw = result.get("resolvedCost")
        try:
            charged_cost = round(float(resolved_cost_raw or 0), 6)
        except (TypeError, ValueError):
            charged_cost = 0.0

        persisted_turn = add_chat_turn(
            user["uid"],
            conversation_id,
            user_parts=user_parts,
            assistant_parts=list(assistant_message.get("parts") or []),
            title=_normalize_plain_chat_title(auto_title) if auto_title else None,
            prompt_tokens=int((result.get("usage") or {}).get("promptTokens") or 0),
            completion_tokens=int((result.get("usage") or {}).get("completionTokens") or 0),
            charged_cost=charged_cost,
        )
        cost_delta_minor = int(persisted_turn.get("costDeltaMinor") or 0)

        if cost_delta_minor != 0:
            current_profile = adjust_credits(
                user["uid"],
                -(cost_delta_minor / 100),
                "plain_chat_charge",
                actor_uid=user["uid"],
                allow_negative=True,
                metadata={
                    **chat_activity_metadata,
                    "route": "plain_chat_conversation",
                    "model": result.get("model") or conversation.get("model"),
                    "provider": result.get("provider"),
                    "billingMode": result.get("billingMode"),
                    "resolvedCost": charged_cost,
                    "chargedCostMicro": persisted_turn.get("chargedCostMicro"),
                    "totalCostMicro": persisted_turn.get("totalCostMicro"),
                    "totalCostMinor": persisted_turn.get("totalCostMinor"),
                    "costDeltaMinor": cost_delta_minor,
                    "usage": result.get("usage") or {},
                    "billing": result.get("billing") or {},
                    "message_count": len(assembled_messages),
                    "stored_message_count": len(existing_messages) + 1,
                    "options": payload.options.model_dump(by_alias=True, exclude_none=True) if payload.options else {},
                    "prompt_preview": preview_plain_chat_prompt(request_payload),
                },
            )
        else:
            current_profile = get_user(user["uid"])

        persisted_user_message = persisted_turn["user"]
        persisted_assistant_message = persisted_turn["assistant"]
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
                "billingMode": result.get("billingMode"),
                "resolvedCost": result.get("resolvedCost"),
                "billing": result.get("billing") or {},
                "current_balance": (current_profile or {}).get("credits", 0),
            },
        )
    except HTTPException:
        raise
    except ValueError as exc:
        detail = _plain_chat_error_message(str(exc))
        status_code = 402 if str(exc) == "INSUFFICIENT_CREDITS" else 400
        if str(exc) in {"CHAT_REQUEST_TOO_LARGE"}:
            status_code = 413
        if str(exc).startswith("CHAT_BAD_PARAM:"):
            status_code = 422
        if status_code == 402:
            raise HTTPException(status_code=402, detail=detail) from exc
        if status_code == 413:
            raise HTTPException(status_code=413, detail=detail) from exc
        if status_code == 422:
            raise HTTPException(status_code=422, detail=detail) from exc
        return PlainChatConversationTurnResponse(status="error", meta={"error_message": detail})
    except ApiKeyManagerProxyError as exc:
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


def _normalize_plain_chat_title(value: str | None) -> str:
    normalized = re.sub(r"\s+", " ", (value or "").strip())
    if not normalized:
        return DEFAULT_PLAIN_CHAT_TITLE
    if len(normalized) > 120:
        normalized = normalized[:117].rstrip() + "..."
    return normalized


def _derive_plain_chat_title_from_parts(parts: list[dict[str, Any]]) -> str | None:
    for part in parts:
        if str(part.get("type") or "") != "text":
            continue
        text = re.sub(r"\s+", " ", str(part.get("text") or "").strip())
        if not text:
            continue
        if len(text) > 72:
            text = text[:69].rstrip() + "..."
        return text
    return None


def _allow_plain_chat_title_update(uid: str) -> bool:
    return consume_rate_limit(
        f"chat:title:user:{uid}",
        max_count=PLAIN_CHAT_TITLE_UPDATE_LIMIT,
        window_seconds=PLAIN_CHAT_TITLE_UPDATE_WINDOW_SECONDS,
    )


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


@app.post(
    "/internal/expire-credits",
    tags=["Configuration"],
    summary="Expire Gift Credits Sweep",
    description="Internal endpoint (cron/systemd timer) that expires past-due gift credit lots across all users.",
)
@limiter.limit("6/minute")
def expire_credits_sweep(request: Request, x_internal_secret: str | None = Header(default=None)):
    del request
    # Prefer the dedicated sweep secret; fall back to the catalog webhook secret
    # for back-compat when a dedicated one has not been provisioned.
    expected_secret = settings.internal_sweep_secret or settings.catalog_webhook_secret
    if not expected_secret:
        raise HTTPException(status_code=503, detail="Internal secret is not configured")
    if not x_internal_secret or not secrets.compare_digest(x_internal_secret, expected_secret):
        raise HTTPException(status_code=403, detail="Invalid internal secret")
    result = sweep_all_expired_credits()
    return {"status": "ok", **result}


@app.get("/admin/model-visibility", tags=["Configuration"], summary="Get Model Visibility For Admin")
@limiter.limit("20/minute")
def admin_get_model_visibility(request: Request, _admin: Dict[str, Any] = Depends(verify_admin_session)):
    del request
    catalog = catalog_store.get_catalog()
    return list_model_visibility(catalog)


@app.patch("/admin/model-visibility", tags=["Configuration"], summary="Update Model Visibility For Admin")
@limiter.limit("20/minute")
def admin_update_model_visibility(
    request: Request,
    payload: Dict[str, Any],
    admin: Dict[str, Any] = Depends(verify_admin_session),
    _csrf: None = Depends(verify_admin_csrf),
):
    del request
    disabled_model_ids = payload.get("disabledModelIds", [])
    disabled_provider_ids = payload.get("disabledProviderIds", [])
    if not isinstance(disabled_model_ids, list):
        raise HTTPException(status_code=400, detail="disabledModelIds must be a list")
    if not isinstance(disabled_provider_ids, list):
        raise HTTPException(status_code=400, detail="disabledProviderIds must be a list")
    update_model_visibility(disabled_model_ids, disabled_provider_ids)
    catalog = catalog_store.get_catalog()
    add_admin_audit_log(
        admin_uid=admin.get("adminId"),
        admin_email=admin.get("email") or "admin",
        action="model_visibility_update",
        target_type="model_visibility",
        target_id="global",
        reason="Updated model availability from admin panel",
        metadata={
            "disabledModelIds": disabled_model_ids,
            "disabledProviderIds": disabled_provider_ids,
        },
    )
    return list_model_visibility(catalog)


@app.post("/admin-auth/login", response_model=AdminSessionResponse, tags=["Admin Authentication"], summary="Login To Admin Portal")
@limiter.limit("30/minute")
def admin_login(request: Request, payload: AdminLoginRequest, response: Response):
    started_at = time.monotonic()
    try:
        token, session = authenticate_admin(
            payload.username,
            payload.password,
            ip_address=_get_client_ip(request),
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
    profile = get_user(user["uid"])
    profile.update(get_profile_change_status(user["uid"]))
    return profile


@app.patch("/me", tags=["Configuration"], summary="Update Current User Profile")
@limiter.limit("15/minute")
def update_current_user_profile(
    request: Request,
    payload: UserProfileUpdateRequest,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    try:
        return update_user_profile(user["uid"], username=payload.username, bio=payload.bio)
    except ValueError as exc:
        code = str(exc)
        if code == "PROFILE_USERNAME_REQUIRED":
            raise HTTPException(status_code=400, detail="Username is required") from exc
        if code == "PROFILE_USERNAME_TAKEN":
            raise HTTPException(status_code=409, detail="Username is already taken") from exc
        if code == "PROFILE_DAILY_UPDATE_LIMIT":
            raise HTTPException(status_code=429, detail="Profile updates are limited to 10 per day") from exc
        if code == "PROFILE_UPDATE_LIMIT":
            raise HTTPException(status_code=429, detail="Profile changes are limited to 2 per month") from exc
        raise HTTPException(status_code=400, detail="Invalid profile update") from exc


@app.patch("/me/preferences", tags=["Configuration"], summary="Update Current User Notification Preferences")
@limiter.limit("20/minute")
def update_current_user_notification_preferences(
    request: Request,
    payload: UserNotificationPreferencesUpdateRequest,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    return update_user_notification_preferences(
        user["uid"],
        email_general_news_enabled=payload.email_general_news_enabled,
        email_platform_updates_enabled=payload.email_platform_updates_enabled,
    )


@app.post("/me/deactivate", tags=["Configuration"], summary="Deactivate Current User Account")
@limiter.limit("3/day")
def deactivate_current_user_account(
    request: Request,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    return deactivate_user_account(user["uid"])


@app.get(
    "/dashboard-news",
    response_model=DashboardNewsListResponse,
    tags=["Configuration"],
    summary="List Active Dashboard News",
)
@limiter.limit("60/minute")
def get_dashboard_news(request: Request):
    del request
    items = list_dashboard_news_items(active_only=True)
    return {"items": items, "total": len(items)}


@app.get("/history", tags=["Configuration"], summary="Get User History")
@limiter.limit("30/minute")
def get_user_history(request: Request, limit: int = 20, user: Dict[str, Any] = Depends(verify_firebase_user)):
    capped_limit = min(max(limit, 1), 150)
    uid = user["uid"]
    return {"entries": get_history(uid, capped_limit), "total": count_history(uid)}


@app.get("/credits/ledger", response_model=CreditLedgerListResponse, tags=["Configuration"], summary="Get User Credit Ledger")
@limiter.limit("30/minute")
def get_user_credit_ledger(request: Request, limit: int = 20, user: Dict[str, Any] = Depends(verify_firebase_user)):
    del request
    capped_limit = min(max(limit, 1), 50)
    return CreditLedgerListResponse(entries=list_credit_ledger_entries(user["uid"], capped_limit))


@app.get("/credits/activity", response_model=CreditActivityListResponse, tags=["Configuration"], summary="Get User Credit Activity")
@limiter.limit("30/minute")
def get_user_credit_activity(request: Request, limit: int = 20, user: Dict[str, Any] = Depends(verify_firebase_user)):
    del request
    capped_limit = min(max(limit, 1), 50)
    return CreditActivityListResponse(entries=list_credit_activity_entries(user["uid"], capped_limit))


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


@app.get("/credits/breakdown", tags=["Configuration"], summary="Credit Balance Breakdown")
@limiter.limit("30/minute")
def credit_balance_breakdown(request: Request, user: Dict[str, Any] = Depends(verify_firebase_user)):
    del request
    return get_credit_breakdown(user["uid"])


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
    users, total = search_users_with_total(q, limit)
    return {
        "users": users,
        "total": total,
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


def _parse_validity_seconds(payload: Dict[str, Any]) -> int | None:
    """Parse an optional gift-credit validity window from an admin payload.

    Accepts days + hours (e.g. ``{"validityDays": 2, "validityHours": 12}``) or an
    explicit ``validitySeconds``. Returns a positive number of seconds, or None
    meaning the redeemed credits never expire.
    """
    if payload.get("validitySeconds") is not None:
        seconds = int(payload.get("validitySeconds") or 0)
    else:
        days = int(payload.get("validityDays") or 0)
        hours = int(payload.get("validityHours") or 0)
        seconds = days * 86400 + hours * 3600
    return seconds if seconds > 0 else None


@app.post("/admin/codes", tags=["Configuration"], summary="Create Credit Code For Admin")
@limiter.limit("10/minute")
def admin_create_code(request: Request, payload: Dict[str, Any], admin: Dict[str, Any] = Depends(verify_admin_session), _csrf: None = Depends(verify_admin_csrf)):
    del request
    credits = float(payload.get("credits", 0))
    max_claims = int(payload.get("maxClaims", 0))
    validity_seconds = _parse_validity_seconds(payload)
    try:
        code = create_credit_code(credits, max_claims, admin["uid"], validity_seconds=validity_seconds)
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
                "validity_seconds": validity_seconds,
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
    validity_seconds = _parse_validity_seconds(payload)
    try:
        codes = create_credit_code_batch_with_title(quantity, credits, admin["uid"], title, validity_seconds)
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
                "validity_seconds": validity_seconds,
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


@app.get(
    "/admin/dashboard-news",
    response_model=DashboardNewsListResponse,
    tags=["Configuration"],
    summary="List Dashboard News For Admin",
)
@limiter.limit("30/minute")
def admin_list_dashboard_news(
    request: Request,
    _admin: Dict[str, Any] = Depends(verify_admin_session),
):
    del request
    items = list_dashboard_news_items(active_only=False)
    return {"items": items, "total": len(items)}


@app.post(
    "/admin/dashboard-news",
    response_model=DashboardNewsItemResponse,
    tags=["Configuration"],
    summary="Create Dashboard News For Admin",
)
@limiter.limit("20/minute")
def admin_create_dashboard_news(
    request: Request,
    payload: DashboardNewsUpsertRequest,
    admin: Dict[str, Any] = Depends(verify_admin_session),
    _csrf: None = Depends(verify_admin_csrf),
):
    del request
    return create_dashboard_news_item(
        badge=payload.badge,
        when_label="",
        title=payload.title,
        title_fr=payload.titleFr,
        title_ar=payload.titleAr,
        description=payload.description,
        description_fr=payload.descriptionFr,
        description_ar=payload.descriptionAr,
        link_label=payload.linkLabel,
        link_label_fr=payload.linkLabelFr,
        link_label_ar=payload.linkLabelAr,
        link_href=payload.linkHref,
        tone=payload.tone,
        sort_order=payload.sortOrder,
        is_active=payload.isActive,
        admin_uid=admin["uid"],
        admin_email=admin["email"],
    )


@app.patch(
    "/admin/dashboard-news/{item_id}",
    response_model=DashboardNewsItemResponse,
    tags=["Configuration"],
    summary="Update Dashboard News For Admin",
)
@limiter.limit("20/minute")
def admin_update_dashboard_news(
    request: Request,
    item_id: str,
    payload: DashboardNewsUpsertRequest,
    admin: Dict[str, Any] = Depends(verify_admin_session),
    _csrf: None = Depends(verify_admin_csrf),
):
    del request
    try:
        return update_dashboard_news_item(
            item_id,
            badge=payload.badge,
            when_label="",
            title=payload.title,
            title_fr=payload.titleFr,
            title_ar=payload.titleAr,
            description=payload.description,
            description_fr=payload.descriptionFr,
            description_ar=payload.descriptionAr,
            link_label=payload.linkLabel,
            link_label_fr=payload.linkLabelFr,
            link_label_ar=payload.linkLabelAr,
            link_href=payload.linkHref,
            tone=payload.tone,
            sort_order=payload.sortOrder,
            is_active=payload.isActive,
            admin_uid=admin["uid"],
            admin_email=admin["email"],
        )
    except ValueError as exc:
        if str(exc) == "DASHBOARD_NEWS_NOT_FOUND":
            raise HTTPException(status_code=404, detail="Dashboard news item not found") from exc
        raise


@app.delete(
    "/admin/dashboard-news/{item_id}",
    tags=["Configuration"],
    summary="Delete Dashboard News For Admin",
)
@limiter.limit("20/minute")
def admin_delete_dashboard_news(
    request: Request,
    item_id: str,
    admin: Dict[str, Any] = Depends(verify_admin_session),
    _csrf: None = Depends(verify_admin_csrf),
):
    del request
    try:
        delete_dashboard_news_item(item_id, admin_uid=admin["uid"], admin_email=admin["email"])
    except ValueError as exc:
        if str(exc) == "DASHBOARD_NEWS_NOT_FOUND":
            raise HTTPException(status_code=404, detail="Dashboard news item not found") from exc
        raise
    return {"success": True}


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
    generation_job_id: str | None = None
    if not _GENERATION_GATE.acquire(blocking=False):
        raise HTTPException(
            status_code=503,
            detail="The generation service is busy right now. Please retry in a few seconds.",
            headers={"Retry-After": "5"},
        )
    try:
        catalog_store.get_catalog()
        _validate_generate_request(payload)
        request_input_images = _normalize_request_input_images(payload)
        request_input_image_metadata = [image.model_dump() for image in request_input_images]
        effective_status = _resolve_generation_status(payload)
        direct_generation = effective_status == "generating"
        current_profile = get_user(user["uid"])
        minimum_required = _minimum_required_credits_for_generate(
            payload,
            include_analysis_fee=bool(payload.mode == "smart" and not direct_generation),
        )
        current_credits = float((current_profile or {}).get("credits", 0) or 0)
        if current_credits < minimum_required["total"]:
            raise HTTPException(
                status_code=402,
                detail=(
                    "Insufficient credits for the minimum required cost. "
                    f"You need at least {minimum_required['total']:.2f} credits "
                    f"(analysis {minimum_required['analyze_fee']:.2f}, "
                    f"text {minimum_required['caption_minimum']:.2f}, "
                    f"image {minimum_required['image_minimum']:.2f})."
                ),
            )
        _enforce_mode_specific_generate_limits(request, payload, user, direct_generation=direct_generation)

        analyze_session_id = (payload.user_preferences or {}).get("analyze_session_id")
        
        if direct_generation and analyze_session_id:
            try:
                complete_analyze_session(analyze_session_id, user["uid"])
            except ValueError:
                pass

        analyze_session = None

        if not direct_generation:
            analyze_key = f"analyze:{user['uid']}"
            if not consume_rate_limit(analyze_key, max_count=20, window_seconds=3600):
                raise HTTPException(status_code=429, detail="Analyze limit reached. Try again later.")

            try:
                if payload.mode == "smart":
                    analyze_session = create_analyze_session_with_charge(
                        user["uid"],
                        payload.user_text,
                        settings.smart_analysis_fee,
                    )
                else:
                    # quick mode creates session without analysis fee
                    analyze_session = create_analyze_session_with_charge(
                        user["uid"],
                        payload.user_text,
                        0.0,
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
                    raise HTTPException(
                        status_code=429,
                        detail="This account reached its daily usage limit of 30 credits. Please try again later.",
                    ) from exc
                if str(exc) == "INSUFFICIENT_CREDITS":
                    raise HTTPException(status_code=402, detail="Insufficient credits") from exc
                raise HTTPException(status_code=400, detail=str(exc)) from exc

            job = create_generation_job(
                user["uid"],
                payload.user_text,
                payload.requested_outputs,
                {
                    "user_preferences": payload.user_preferences or {},
                    "model_parameters": payload.model_parameters or {},
                    "status": effective_status,
                    "mode": payload.mode,
                    "user_corrections": payload.user_corrections or {},
                    "input_image": request_input_image_metadata[0] if len(request_input_image_metadata) == 1 else None,
                    "input_images": request_input_image_metadata,
                },
                status="processing",
            )
            generation_job_id = str(job.get("id") or "")
        else:
            expected_required = _expected_required_credits_for_generate(payload)
            expected_total = expected_required["total"]
            
            try:
                reserve_result = reserve_generation_credits(
                    user["uid"],
                    payload.user_text,
                    payload.requested_outputs,
                    {
                        "user_preferences": payload.user_preferences or {},
                        "model_parameters": payload.model_parameters or {},
                        "status": effective_status,
                        "mode": payload.mode,
                        "user_corrections": payload.user_corrections or {},
                        "input_image": request_input_image_metadata[0] if len(request_input_image_metadata) == 1 else None,
                        "input_images": request_input_image_metadata,
                        "image_model": (payload.user_preferences or {}).get("image_model"),
                        "caption_model": (payload.user_preferences or {}).get("caption_model"),
                    },
                    estimated_cost=expected_total,
                )
                generation_job_id = str(reserve_result["job"]["id"])
            except ValueError as exc:
                if str(exc) == "USAGE_CAP_REACHED":
                    raise HTTPException(
                        status_code=429,
                        detail="This account reached its daily usage limit of 30 credits. Please try again later.",
                    ) from exc
                if str(exc) == "INSUFFICIENT_CREDITS":
                    raise HTTPException(
                        status_code=402,
                        detail=(
                            "Insufficient credits for the selected settings. "
                            f"You need about {expected_total:.4f} credits."
                        ),
                    ) from exc
                raise HTTPException(status_code=400, detail=str(exc)) from exc

        input_images = _prepare_input_images(request_input_images, str(user["uid"]))

        initial_state = {
            "user_text": payload.user_text,
            "owner_uid": str(user["uid"]),
            "requested_outputs": payload.requested_outputs,
            "input_images": input_images,
            "user_preferences": payload.user_preferences or {},
            "model_parameters": payload.model_parameters or {},
            "status": effective_status,
        }
        if payload.user_corrections:
            initial_state["user_corrections"] = payload.user_corrections

        try:
            final_state = studio_graph_app.invoke(initial_state)
        except Exception:
            if direct_generation and generation_job_id:
                release_generation_credits(generation_job_id, failure_reason="provider_exception")
            elif not direct_generation and analyze_session:
                refund_analyze_session(analyze_session["id"], user["uid"])
            raise

        if final_state.get("status") == "awaiting_review":
            if payload.mode == "quick":
                if analyze_session:
                    refund_analyze_session(analyze_session["id"], user["uid"])
                return GenerationResult(
                    status="error",
                    meta={
                        "mode": payload.mode,
                        "error_message": "Quick mode cannot enter the review step.",
                    },
                )
            if generation_job_id:
                mark_generation_job_awaiting_review(generation_job_id)
            return GenerationResult(
                status="awaiting_review",
                ui_schema=final_state.get("ui_schema"),
                content_prompts=final_state.get("content_prompts"),
                meta={
                    "mode": payload.mode,
                    "smart_analysis_fee": analyze_session.get("analysisFee", 0),
                    "analyze_session_id": analyze_session["id"],
                    "current_balance": analyze_session.get("balance"),
                },
            )
        elif final_state.get("status") == "complete":
            final_payload = final_state.get("final_response", {})
            delivery_error = _validate_generation_results(payload.requested_outputs, final_payload.get("results"))
            if delivery_error:
                current_profile = get_user(user["uid"])
                if direct_generation and generation_job_id:
                    release_generation_credits(generation_job_id, failure_reason=delivery_error)
                elif not direct_generation and analyze_session:
                    refund_analyze_session(analyze_session["id"], user["uid"])
                return GenerationResult(
                    status="error",
                    meta={
                        "mode": payload.mode,
                        "error_message": "We couldn't deliver the generated result. No credits were charged.",
                        "current_balance": current_profile.get("credits", 0),
                    },
                )
            try:
                charged_cost = round(float((final_payload.get("meta") or {}).get("total_cost") or 0), 6)
            except (TypeError, ValueError):
                charged_cost = 0.0

            if direct_generation and generation_job_id:
                capture_result = capture_generation_credits(generation_job_id, charged_cost)
                current_balance = capture_result["balance"].get("credits", 0)
            else:
                current_profile = get_user(user["uid"])
                current_balance = current_profile.get("credits", 0)

            return GenerationResult(
                status="success",
                results=final_payload.get("results"),
                meta={
                    "mode": payload.mode,
                    **(final_payload.get("meta") or {}),
                    "charged_cost": charged_cost,
                    "current_balance": current_balance,
                },
            )
        elif final_state.get("status") == "error":
            failure_reason = str(
                (final_state.get("final_response", {}).get("meta") or {}).get("failure_reason")
                or final_state.get("failure_reason")
                or "generation_delivery_failed"
            )
            current_profile = get_user(user["uid"])
            if direct_generation and generation_job_id:
                release_generation_credits(generation_job_id, failure_reason=failure_reason)
            elif not direct_generation and analyze_session:
                refund_analyze_session(analyze_session["id"], user["uid"])
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
            raise HTTPException(
                status_code=429,
                detail="This account reached its daily usage limit of 30 credits. Please try again later.",
            ) from exc
        if str(exc) == "INSUFFICIENT_CREDITS":
            raise HTTPException(status_code=402, detail="Insufficient credits") from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except ApiKeyManagerProxyError as exc:
        failure_reason = f"provider_{exc.error_type}"
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
        print(f"Server Error: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal error occurred. Please try again later.")
    finally:
        _GENERATION_GATE.release()


def _resolve_generation_status(payload: GenerateRequest) -> str:
    if payload.mode == "quick":
        return "generating"
    return payload.status or "processing"


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

    private_file_id = private_file_id_from_url(image_url)
    if private_file_id:
        file_record = get_private_user_file_record(private_file_id)
        return bool(file_record and str(file_record.get("kind") or "") == "generated_output")

    parsed = urlparse(image_url)
    filename = Path(parsed.path).name
    if not SAFE_GENERATED_FILENAME.match(filename):
        return False

    generated_local_prefix = f"{settings.public_backend_base_url}/images/" if settings.public_backend_base_url else ""
    if generated_local_prefix and image_url.startswith(generated_local_prefix):
        return (GENERATED_IMAGES_DIR / filename).exists()

    generated_prefixes: list[str] = []
    if settings.public_backend_base_url:
        generated_prefixes.append(f"{settings.public_backend_base_url}/generated-images/")
    if settings.apikeymanager_public_base_url:
        generated_prefixes.append(f"{settings.apikeymanager_public_base_url}/generated-images/")
    for generated_prefix in generated_prefixes:
        if image_url.startswith(generated_prefix):
            return True

    return False


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
    if error_code.startswith("CHAT_BAD_PARAM:"):
        _, parameter_name, reason = (error_code.split(":", 2) + ["", ""])[:3]
        label = parameter_name or "parameter"
        if reason == "unsupported":
            return f"Bad params: {label} is not supported for this model."
        if reason == "enum":
            return f"Bad params: {label} must use one of the allowed values for this model."
        if reason == "range":
            return f"Bad params: {label} is outside the allowed range for this model."
        if reason == "fixed":
            return f"Bad params: {label} cannot be changed for this model."
        if reason == "type":
            return f"Bad params: {label} has an invalid type."
        return f"Bad params: {label} is invalid for this model."
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
    if error_code == "CHAT_TOO_MANY_IMAGES":
        return f"Attach at most {MAX_INPUT_IMAGES} images per message."
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


def _minimum_generation_cost_for_task(task: str) -> float:
    if task == "image":
        return round(settings.minimum_image_generation_cost, 4)
    return round(settings.minimum_text_generation_cost, 4)


def _format_credit_amount(value: float) -> str:
    if value > 0 and value < 0.01:
        return f"{value:.3f}"
    return f"{value:.2f}"

def _raw_model_pricing_minimum(task: str, model_config: dict[str, Any] | None) -> float:
    config = dict(model_config or {})
    if task == "caption":
        return round(settings.minimum_text_generation_cost, 4)

    billing = config.get("billing") if isinstance(config.get("billing"), dict) else {}
    fixed_config = billing.get("fixed") if isinstance(billing.get("fixed"), dict) else {}
    fixed_amount = _parse_billing_float(fixed_config.get("amount"))
    image_config = billing.get("image") if isinstance(billing.get("image"), dict) else {}
    image_size_prices = image_config.get("imageSizePrices") if isinstance(image_config.get("imageSizePrices"), dict) else {}
    sample_image_size_prices = image_config.get("sampleImageSizePrices") if isinstance(image_config.get("sampleImageSizePrices"), dict) else {}
    base_price = _parse_billing_float(image_config.get("basePrice"))

    candidates: list[float] = []
    if fixed_amount is not None:
        candidates.append(fixed_amount)
    if base_price is not None:
        candidates.append(base_price)
    candidates.extend(
        parsed for raw in image_size_prices.values() if (parsed := _parse_billing_float(raw)) is not None
    )
    candidates.extend(
        parsed for raw in sample_image_size_prices.values() if (parsed := _parse_billing_float(raw)) is not None
    )
    return round(min(candidates), 4) if candidates else 0.0


def _collect_catalog_cost_warnings(model_catalog: dict[str, Any]) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    for task, models in (model_catalog or {}).items():
        floor = _minimum_generation_cost_for_task(task)
        for model_name, model_config in (models or {}).items():
            configured_cost = _raw_model_pricing_minimum(task, model_config)
            if configured_cost >= floor:
                continue
            display_name = str((model_config or {}).get("display_name") or model_name)
            warnings.append(
                {
                    "type": "catalog_cost_floor",
                    "task": task,
                    "model": model_name,
                    "display_name": display_name,
                    "configured_cost": round(configured_cost, 4),
                    "minimum_cost": floor,
                    "message": (
                        f"{display_name} is priced at {_format_credit_amount(configured_cost)} credits, below the enforced "
                        f"{task} floor of {_format_credit_amount(floor)}."
                    ),
                }
            )
    return warnings


def _is_editing_model(model_id: str | None) -> bool:
    """Grok exposes image editing as a separate model id with an "-editing" suffix."""
    return bool(model_id) and str(model_id).strip().lower().endswith(EDITING_MODEL_SUFFIX)


def _validate_generate_request(payload: GenerateRequest) -> None:
    requested = payload.requested_outputs or []
    if not requested:
        raise HTTPException(status_code=400, detail="At least one output must be selected")

    input_images = _normalize_request_input_images(payload)
    if len(input_images) > MAX_INPUT_IMAGES:
        raise HTTPException(status_code=400, detail=f"At most {MAX_INPUT_IMAGES} input images are allowed")
    for input_image in input_images:
        _validate_input_image(input_image)

    prefs = payload.user_preferences or {}
    has_input_images = len(input_images) > 0
    wants_caption = "caption" in requested
    wants_image = "image" in requested

    # Editing models accept at most MAX_EDITING_INPUT_IMAGES source images.
    if wants_image and has_input_images and _is_editing_model(_resolve_model_choice("image", prefs)):
        if len(input_images) > MAX_EDITING_INPUT_IMAGES:
            raise HTTPException(
                status_code=400,
                detail=f"This editing model accepts at most {MAX_EDITING_INPUT_IMAGES} input images.",
            )

    _validate_selected_model_exists("caption", prefs, wants_caption)
    _validate_selected_model_exists("image", prefs, wants_image)

    # Text/caption rules are unchanged. The only relaxation for input images is that
    # the caption model no longer has to be a shared Nano Banana — any Gemini text
    # model accepts image input and can caption from the uploaded image.
    if wants_caption:
        caption_model = _resolve_model_choice("caption", prefs)
        if caption_model:
            caption_entry = settings.model_catalog.get("caption", {}).get(caption_model, {})
            if wants_image:
                if not _is_gemini_text_model(caption_entry):
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

    # Image rules are capability-based, not provider-locked: any model that outputs
    # images is allowed, and when input images are uploaded it just has to accept
    # image input and have enough input-image slots (Recraft=1, others=3, Imagen=0).
    if wants_image:
        image_model = _resolve_model_choice("image", prefs)
        if image_model:
            image_entry = settings.model_catalog.get("image", {}).get(image_model, {})
            if not _is_image_capable_model(image_entry):
                raise HTTPException(
                    status_code=400,
                    detail="For image output, the selected image model must support image generation.",
                )
            if has_input_images:
                max_input_images = _max_input_images_for_entry(image_entry)
                if max_input_images <= 0:
                    raise HTTPException(
                        status_code=400,
                        detail="The selected image model does not accept input images. Remove the uploaded image or choose an image-editing model.",
                    )
                if len(input_images) > max_input_images:
                    raise HTTPException(
                        status_code=400,
                        detail=f"The selected image model accepts at most {max_input_images} input image(s).",
                    )

    _validate_generate_model_parameters(payload, prefs)


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


GENERATE_PARAMETER_OPTION_KEY_MAP: Dict[str, str] = {
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
    "quality": "quality",
    "aspectRatio": "aspectRatio",
    "seed": "seed",
    "addWatermark": "addWatermark",
    "enhancePrompt": "enhancePrompt",
    "outputMimeType": "outputMimeType",
}


def _catalog_with_parameter_schemas(model_catalog: dict[str, Any]) -> dict[str, Any]:
    enriched: dict[str, Any] = {}
    for task, models in (model_catalog or {}).items():
        enriched[task] = {}
        for model_name, model_config in (models or {}).items():
            next_config = dict(model_config or {})
            next_config["parameterSchema"] = settings.get_model_parameter_schema(model_name, next_config)
            next_config["pricing"] = _derive_model_pricing_summary(task, model_name, next_config)
            enriched[task][model_name] = next_config
    return enriched


def _parse_billing_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return round(parsed, 6)


def _derive_model_pricing_summary(task: str, model_name: str, model_config: dict[str, Any] | None) -> dict[str, Any]:
    config = dict(model_config or {})
    if task == "caption":
        floor = round(settings.minimum_text_generation_cost, 4)
        return {
            "minimum": floor,
            "expected": {
                "type": "usage_based",
                "amount": floor,
                "label": "Estimated text floor",
            },
        }

    billing = config.get("billing") if isinstance(config.get("billing"), dict) else {}
    fixed_config = billing.get("fixed") if isinstance(billing.get("fixed"), dict) else {}
    fixed_amount = _parse_billing_float(fixed_config.get("amount"))
    image_config = billing.get("image") if isinstance(billing.get("image"), dict) else {}
    image_size_prices = image_config.get("imageSizePrices") if isinstance(image_config.get("imageSizePrices"), dict) else {}
    sample_image_size_prices = image_config.get("sampleImageSizePrices") if isinstance(image_config.get("sampleImageSizePrices"), dict) else {}
    base_price = _parse_billing_float(image_config.get("basePrice"))

    normalized_image_size_prices = {
        str(key): parsed
        for key, raw in image_size_prices.items()
        if (parsed := _parse_billing_float(raw)) is not None
    }
    normalized_sample_image_size_prices = {
        str(key): parsed
        for key, raw in sample_image_size_prices.items()
        if (parsed := _parse_billing_float(raw)) is not None
    }

    candidates: list[float] = []
    if fixed_amount is not None:
        candidates.append(fixed_amount)
    if base_price is not None:
        candidates.append(base_price)
    candidates.extend(normalized_image_size_prices.values())
    candidates.extend(normalized_sample_image_size_prices.values())
    floor = round(settings.minimum_image_generation_cost, 4)
    raw_minimum = round(min(candidates), 4) if candidates else 0.0
    minimum = round(max(raw_minimum, floor), 4)

    expected: dict[str, Any]
    if fixed_amount is not None and not normalized_image_size_prices and not normalized_sample_image_size_prices and base_price is None:
        expected = {
            "type": "fixed",
            "label": "Fixed image billing",
            "amount": round(fixed_amount, 4),
        }
    else:
        expected = {
            "type": "image_variant" if (normalized_image_size_prices or normalized_sample_image_size_prices) else "fixed",
            "label": "Expected image variants",
        }
    if base_price is not None:
        expected["basePrice"] = round(base_price, 4)
    if normalized_image_size_prices:
        expected["imageSizePrices"] = {key: round(value, 4) for key, value in normalized_image_size_prices.items()}
    if normalized_sample_image_size_prices:
        expected["sampleImageSizePrices"] = {key: round(value, 4) for key, value in normalized_sample_image_size_prices.items()}

    return {
        "minimum": minimum,
        "expected": expected,
    }


def _minimum_required_credits_for_generate(payload: GenerateRequest, include_analysis_fee: bool) -> dict[str, float]:
    requested = payload.requested_outputs or []
    prefs = payload.user_preferences or {}

    analyze_fee = round(settings.smart_analysis_fee if include_analysis_fee else 0, 4)
    caption_minimum = 0.0
    image_minimum = 0.0

    if "caption" in requested:
        caption_model = _resolve_model_choice("caption", prefs)
        caption_entry = settings.model_catalog.get("caption", {}).get(caption_model or "", {})
        caption_pricing = _derive_model_pricing_summary("caption", caption_model or "", caption_entry)
        caption_minimum = round(float(caption_pricing.get("minimum") or 0), 4)

    if "image" in requested:
        image_model = _resolve_model_choice("image", prefs)
        image_entry = settings.model_catalog.get("image", {}).get(image_model or "", {})
        image_pricing = _derive_model_pricing_summary("image", image_model or "", image_entry)
        image_minimum = round(float(image_pricing.get("minimum") or 0), 4)

    total = round(analyze_fee + caption_minimum + image_minimum, 4)
    return {
        "analyze_fee": analyze_fee,
        "caption_minimum": caption_minimum,
        "image_minimum": image_minimum,
        "total": total,
    }


def _normalize_expected_pricing_key(value: Any) -> str:
    raw = str(value or "").strip().lower().replace(" ", "")
    if raw in {"512", "512px", "0.5k"}:
        return "0.5k"
    if raw in {"1024", "1024px", "1k"}:
        return "1k"
    if raw in {"2048", "2048px", "2k"}:
        return "2k"
    if raw in {"4096", "4096px", "4k"}:
        return "4k"
    return raw


def _resolve_expected_variant_price(price_map: dict[str, Any] | None, value: Any) -> float | None:
    if not isinstance(price_map, dict):
        return None
    target = _normalize_expected_pricing_key(value)
    if not target:
        return None
    for raw_key, raw_value in price_map.items():
        if _normalize_expected_pricing_key(raw_key) != target:
            continue
        parsed = _parse_billing_float(raw_value)
        if parsed is not None:
            return round(parsed, 4)
    return None


def _expected_model_cost_for_generate(task: str, model_name: str, model_entry: dict[str, Any] | None, params: dict[str, Any] | None) -> float:
    pricing = _derive_model_pricing_summary(task, model_name, model_entry)
    expected = pricing.get("expected")
    minimum = round(float(pricing.get("minimum") or 0), 4)

    if isinstance(expected, (int, float)):
        return round(float(expected), 4)
    if not isinstance(expected, dict):
        return minimum

    amount = _parse_billing_float(expected.get("amount"))
    if amount is not None:
        return round(amount, 4)

    if task == "image":
        parameter_schema = settings.get_model_parameter_schema(model_name, model_entry)
        raw_params = {
            **_default_image_size_parameters(parameter_schema),
            **(params or {}),
        }
        sample_variant = _resolve_expected_variant_price(
            expected.get("sampleImageSizePrices") if isinstance(expected.get("sampleImageSizePrices"), dict) else None,
            raw_params.get("sampleImageSize"),
        )
        if sample_variant is not None:
            return sample_variant

        image_variant = _resolve_expected_variant_price(
            expected.get("imageSizePrices") if isinstance(expected.get("imageSizePrices"), dict) else None,
            raw_params.get("imageSize"),
        )
        if image_variant is not None:
            return image_variant

        # Grok prices the image by resolution (1k/2k).
        resolution_variant = _resolve_expected_variant_price(
            expected.get("imageSizePrices") if isinstance(expected.get("imageSizePrices"), dict) else None,
            raw_params.get("resolution"),
        )
        if resolution_variant is not None:
            return resolution_variant

        # OpenAI prices the image by quality (low/medium) rather than size.
        quality_variant = _resolve_expected_variant_price(
            expected.get("imageSizePrices") if isinstance(expected.get("imageSizePrices"), dict) else None,
            raw_params.get("quality"),
        )
        if quality_variant is not None:
            return quality_variant

        base_price = _parse_billing_float(expected.get("basePrice"))
        if base_price is not None:
            return round(base_price, 4)

    return minimum


def _default_image_size_parameters(parameter_schema: dict[str, Any]) -> dict[str, Any]:
    defaults: dict[str, Any] = {}
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


def _expected_required_credits_for_generate(payload: GenerateRequest) -> dict[str, float]:
    requested = payload.requested_outputs or []
    prefs = payload.user_preferences or {}
    raw_sections = payload.model_parameters or {}

    caption_expected = 0.0
    image_expected = 0.0

    if "caption" in requested:
        caption_model = _resolve_model_choice("caption", prefs)
        caption_entry = settings.model_catalog.get("caption", {}).get(caption_model or "", {})
        caption_expected = _expected_model_cost_for_generate(
            "caption",
            caption_model or "",
            caption_entry,
            raw_sections.get("caption") if isinstance(raw_sections, dict) else {},
        )

    if "image" in requested:
        image_model = _resolve_model_choice("image", prefs)
        image_entry = settings.model_catalog.get("image", {}).get(image_model or "", {})
        image_expected = _expected_model_cost_for_generate(
            "image",
            image_model or "",
            image_entry,
            raw_sections.get("image") if isinstance(raw_sections, dict) else {},
        )

    total = round(caption_expected + image_expected, 4)
    return {
        "caption_expected": round(caption_expected, 4),
        "image_expected": round(image_expected, 4),
        "total": total,
    }


def _validate_generate_model_parameters(payload: GenerateRequest, prefs: Dict[str, str]) -> None:
    raw_sections = payload.model_parameters or {}
    if not isinstance(raw_sections, dict):
        raise HTTPException(status_code=422, detail="Bad params: model_parameters must be an object.")

    for task_name, raw_params in raw_sections.items():
        if task_name not in {"image", "caption"}:
            raise HTTPException(status_code=422, detail=f"Bad params: {task_name} is not a supported output section.")
        if task_name not in (payload.requested_outputs or []):
            raise HTTPException(status_code=422, detail=f"Bad params: {task_name} parameters were provided for an output that is not requested.")
        if not isinstance(raw_params, dict):
            raise HTTPException(status_code=422, detail=f"Bad params: {task_name} parameters must be an object.")

        model_name = _resolve_model_choice(task_name, prefs)
        model_entry = settings.model_catalog.get(task_name, {}).get(model_name or "", {})
        parameter_schema = settings.get_model_parameter_schema(model_name or "", model_entry)

        for option_key, option_value in raw_params.items():
            if option_key == "sampleCount":
                raise HTTPException(status_code=422, detail="Bad params: sampleCount is not supported.")

            schema_entry = parameter_schema.get(option_key)
            if not isinstance(schema_entry, dict):
                raise HTTPException(status_code=422, detail=f"Bad params: {option_key} is not supported for {task_name}.")

            if schema_entry.get("configurable") is False and "value" in schema_entry:
                if not _schema_value_matches(option_value, schema_entry.get("value")):
                    raise HTTPException(status_code=422, detail=f"Bad params: {option_key} is fixed for this model.")
                continue

            try:
                _validate_option_against_schema(option_key, option_value, schema_entry)
            except ValueError as exc:
                reason = str(exc).split(":")[-1]
                if reason == "enum":
                    detail = f"Bad params: {option_key} is not an allowed value for this model."
                elif reason == "range":
                    detail = f"Bad params: {option_key} is outside the allowed range for this model."
                elif reason == "type":
                    detail = f"Bad params: {option_key} has an invalid type."
                else:
                    detail = f"Bad params: please validate parameter {option_key}."
                raise HTTPException(status_code=422, detail=detail) from exc


def _normalize_generate_model_parameters(
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


def _validate_option_against_schema(option_key: str, option_value: Any, schema_entry: dict[str, Any]) -> None:
    option_type = str(schema_entry.get("type") or "").strip().lower()

    if option_type == "enum":
        allowed_values = schema_entry.get("values")
        if not isinstance(allowed_values, list) or not allowed_values:
            raise ValueError(f"GENERATE_BAD_PARAM:{option_key}:unsupported")
        if not any(_schema_value_matches(option_value, allowed) for allowed in allowed_values):
            raise ValueError(f"GENERATE_BAD_PARAM:{option_key}:enum")
        return

    if option_type in {"float", "integer"}:
        if not isinstance(option_value, (int, float)) or isinstance(option_value, bool):
            raise ValueError(f"GENERATE_BAD_PARAM:{option_key}:type")

        numeric_value = float(option_value)
        minimum = schema_entry.get("min")
        maximum = schema_entry.get("max")
        min_exclusive = schema_entry.get("minExclusive")
        max_exclusive = schema_entry.get("maxExclusive")

        if minimum is not None and numeric_value < float(minimum):
            raise ValueError(f"GENERATE_BAD_PARAM:{option_key}:range")
        if maximum is not None and numeric_value > float(maximum):
            raise ValueError(f"GENERATE_BAD_PARAM:{option_key}:range")
        if min_exclusive is not None and numeric_value <= float(min_exclusive):
            raise ValueError(f"GENERATE_BAD_PARAM:{option_key}:range")
        if max_exclusive is not None and numeric_value >= float(max_exclusive):
            raise ValueError(f"GENERATE_BAD_PARAM:{option_key}:range")
        return

    if option_type == "boolean":
        if not isinstance(option_value, bool):
            raise ValueError(f"GENERATE_BAD_PARAM:{option_key}:type")
        return


def _schema_value_matches(actual: Any, expected: Any) -> bool:
    if isinstance(actual, str) and isinstance(expected, str):
        return actual.strip().upper() == expected.strip().upper()
    return actual == expected


def _validate_input_image(input_image) -> None:
    if input_image.file_id or input_image.url:
        _validate_uploaded_image_reference(file_id=input_image.file_id, image_url=input_image.url)
        return

    raise HTTPException(status_code=400, detail="Uploaded image reference is required")


def _normalize_request_input_images(payload: GenerateRequest) -> list:
    if payload.input_images is not None:
        return list(payload.input_images or [])
    return [payload.input_image] if payload.input_image else []


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


def _max_input_images_for_entry(model_entry: Dict[str, Any]) -> int:
    """How many input images a model accepts (mirrors the AKM gateway guardrail and
    the frontend's imageInputConstraints). 0 when the model has no IMAGE input
    modality (e.g. Imagen, Ideogram); Recraft's image-to-image takes a single source."""
    if "IMAGE" not in set(model_entry.get("input_modalities") or []):
        return 0
    if model_entry.get("provider") == "recraft":
        return 1
    return MAX_EDITING_INPUT_IMAGES


def _prepare_input_images(input_images, owner_uid: str) -> list[Dict[str, str]]:
    prepared: list[Dict[str, str]] = []
    for input_image in input_images or []:
        prepared_image = _prepare_input_image(input_image, owner_uid)
        if prepared_image:
            prepared.append(prepared_image)
    return prepared


def _prepare_input_image(input_image, owner_uid: str) -> Dict[str, str] | None:
    if not input_image:
        return None

    if input_image.file_id or input_image.url:
        candidate_id = str(input_image.file_id or "").strip() or private_file_id_from_url(str(input_image.url or "")) or ""
        file_record, filepath = load_private_user_file(
            candidate_id,
            owner_uid,
            allowed_kinds={"uploaded_input", "generated_output"},
        )
        image_bytes = filepath.read_bytes()
        return {
            "mime_type": str(file_record["mime_type"] or input_image.mime_type or ""),
            "data": base64.b64encode(image_bytes).decode("ascii"),
        }

    return None


def _validate_uploaded_image_reference(*, file_id: str | None = None, image_url: str | None = None) -> None:
    normalized_file_id = str(file_id or "").strip()
    normalized_url = str(image_url or "").strip()

    if normalized_file_id and SAFE_FILE_ID.match(normalized_file_id):
        return
    if normalized_url:
        if private_file_id_from_url(normalized_url):
            return

    raise HTTPException(status_code=400, detail="Only Vibecraft private file URLs are allowed")


def _collect_chat_message_image_urls(messages: list[dict[str, Any]]) -> set[str]:
    image_urls: set[str] = set()
    for message in messages:
        for part in list(message.get("parts") or []):
            if str(part.get("type") or "") != "image_url":
                continue
            image_url = str(part.get("url") or "").strip()
            if image_url:
                image_urls.add(image_url)
    return image_urls


def _delete_chat_conversation_images(image_urls: set[str]) -> None:
    for image_url in image_urls:
        private_file_id = private_file_id_from_url(image_url)
        if private_file_id:
            delete_private_user_file_by_id(private_file_id)
            continue

        parsed = urlparse(image_url)
        target_name = Path(parsed.path).name
        if target_name and any(image_url.startswith(prefix) for prefix in generated_image_url_prefixes()) and re.fullmatch(r"^[0-9a-f-]{36}\.(png|jpg|webp)$", target_name):
            for directory in (GENERATED_IMAGES_DIR, *APIKEYMANAGER_GENERATED_IMAGE_DIRS):
                try:
                    (directory / target_name).unlink(missing_ok=True)
                except OSError:
                    continue


def _save_uploaded_input_image_bytes(mime_type: str, image_bytes: bytes) -> str:
    extension = _extension_for_mime_type(mime_type)
    filename = f"{os.urandom(16).hex()}.{extension}"
    save_path = UPLOADED_IMAGES_DIR / filename
    with open(save_path, "wb") as image_file:
        image_file.write(image_bytes)
    return filename

def _cleanup_expired_uploaded_images() -> None:
    cutoff = int(time.time() - UPLOAD_RETENTION_SECONDS)
    with session_scope() as session:
        repo = SecurityRepository(session)
        for entry in repo.list_user_files_before(kind="uploaded_input", created_before=cutoff):
            filepath = UPLOADED_IMAGES_DIR / str(entry.storage_path)
            try:
                filepath.unlink(missing_ok=True)
            except OSError:
                pass
            repo.delete_user_file(entry)


def _verify_uploaded_image_cleanup_health() -> None:
    verification_key = "uploads:cleanup:verification"
    if not consume_rate_limit(verification_key, max_count=1, window_seconds=60 * 60):
        return

    now = int(time.time())
    stale_count = 0
    with session_scope() as session:
        repo = SecurityRepository(session)
        stale_count = len(repo.list_user_files_before(kind="uploaded_input", created_before=now - UPLOAD_RETENTION_SECONDS))

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
    ip = _get_client_ip(request)
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
