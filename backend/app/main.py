import os
import re
import secrets
import json
import base64
import hashlib
import logging
import sys
import time
import struct
import threading
import uuid
from pathlib import Path
from typing import Any, Dict
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request, Depends, UploadFile, File, Form, Header, Response, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text

from app.config import (
    AVAILABLE_PAYMENT_METHOD_IDS,
    CREDIT_PLANS,
    CREDIT_PLANS_BY_ID,
    CREDIT_PLANS_USD,
    CREDIT_PLANS_USD_BY_ID,
    PAYMENT_METHODS,
    PAYMENT_WHATSAPP_NUMBER,
    settings,
)
from app.core.schema import AdminAuditLogListResponse, AdminAuthFailureSummaryResponse, AdminCreditCodeBatchListResponse, AdminCreditCodeListResponse, AdminCreditOrderAcceptRequest, AdminCreditOrderListResponse, AdminCreditOrderRefuseRequest, AdminCreditOrderResponse, AdminGenerationJobItem, AdminGenerationJobListResponse, AdminLoginRequest, AdminReasonRequest, AdminSessionResponse, AdminUserDetailResponse, AdminUserListResponse, CatalogUpdateNotification, CheckoutConfigResponse, CreditActivityListResponse, CreditLedgerListResponse, CreditOrderListResponse, CreditOrderResponse, CreditPlanResponse, DodoCheckoutRequest, DodoCheckoutResponse, PaymentMethodResponse, DashboardNewsItemResponse, DashboardNewsListResponse, DashboardNewsUpsertRequest, FeedbackItemResponse, FeedbackListResponse, FeedbackStatusUpdateRequest, FeedbackSubmitRequest, GenerateRequest, GenerationResult, PlainChatConversationCreateRequest, PlainChatConversationItem, PlainChatConversationListResponse, PlainChatConversationMessageCreateRequest, PlainChatConversationMessagesResponse, PlainChatConversationTurnResponse, PlainChatConversationUpdateRequest, PlainChatModelListResponse, SystemConfig, UserNotificationPreferencesUpdateRequest, UserProfileUpdateRequest, ProfileCompletionRequest, PackEstimateRequest, PackGenerateRequest, PackPlanRequest, PackSessionCreate, PackSessionUpdate
from app.packs import catalog as packs_catalog, service as packs_service
from app.db.session import session_scope
from app.db.repositories.security import SecurityRepository
from app.graph.workflow import studio_graph_app
from app.services.admin_auth import AdminAuthRateLimitError, authenticate_admin, list_admin_auth_failure_summaries, revoke_admin_session
from app.services.apikeymanager_client import ApiKeyManagerProxyError, check_apikeymanager_ready
from app.services.auth import format_suspension_detail, verify_admin_csrf, verify_admin_session, verify_api_key, verify_firebase_user
from app.services.email_service import dispatch as dispatch_email
from app.services import discord_orders, dodo_payments, meta_capi
from app.services.catalog_store import catalog_store
from app.services.model_visibility import filter_catalog, list_model_visibility, update_model_visibility, visible_model_catalog
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
    create_pack_session,
    count_pack_sessions,
    list_pack_sessions,
    get_pack_session,
    update_pack_session,
    delete_pack_session,
    create_analyze_session_with_charge,
    adjust_credits,
    create_credit_code,
    create_credit_code_batch_with_title,
    create_credit_order,
    credit_dodo_card_payment,
    count_recent_card_payments,
    record_card_payment_anomaly,
    reverse_dodo_card_payment,
    get_card_payment_uid,
    set_payment_hold,
    clear_payment_hold,
    list_user_credit_orders,
    list_admin_credit_orders,
    get_credit_order_proof_file_id,
    get_admin_credit_order,
    accept_credit_order,
    refuse_credit_order,
    create_dashboard_news_item,
    create_generation_job,
    deactivate_user_account,
    delete_chat_conversation,
    delete_dashboard_news_item,
    delete_history_entries_by_image_urls,
    list_feedback_items,
    submit_feedback,
    update_feedback_item_status,
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
    complete_user_profile,
    update_user_notification_preferences,
    set_email_lifecycle_enabled,
)
from app.services.user_files import (
    APIKEYMANAGER_GENERATED_IMAGE_DIRS,
    GENERATED_IMAGES_DIR,
    GENERATED_IMAGE_SAFE_HEADERS,
    generated_image_media_type,
    PAYMENT_PROOFS_DIR,
    SAFE_FILE_ID,
    SAFE_GENERATED_FILENAME,
    UPLOADED_IMAGES_DIR,
    create_payment_proof_file_record,
    create_uploaded_user_file_record,
    delete_private_user_file_by_id,
    generated_image_url_prefixes,
    get_private_user_file_record,
    load_payment_proof_file,
    load_private_user_file,
    private_file_id_from_url,
    private_file_url,
)

def _configure_app_logging() -> None:
    """Give the ``app.*`` loggers a real handler.

    Nothing here ever configured logging, and gunicorn/uvicorn only configure
    their own loggers — so ``app.*`` records fell through to Python's lastResort
    handler, which drops anything below WARNING. Every logger.info in the
    codebase was being discarded. Scoped to the "app" namespace (not root) so
    gunicorn/uvicorn keep their own formatting, with propagate off to avoid
    double-printing each line.
    """
    app_logger = logging.getLogger("app")
    level = os.getenv("LOG_LEVEL", "INFO").strip().upper()
    app_logger.setLevel(getattr(logging, level, logging.INFO))
    if not app_logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(
            logging.Formatter("[%(asctime)s] %(levelname)s %(name)s: %(message)s")
        )
        app_logger.addHandler(handler)
    app_logger.propagate = False


_configure_app_logging()
logger = logging.getLogger(__name__)

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
    # Trust X-Real-IP first: nginx sets it from $remote_addr, so clients cannot
    # forge it. X-Forwarded-For is built with $proxy_add_x_forwarded_for, which
    # APPENDS the real IP to any client-supplied value — taking its first entry
    # would let a caller mint a fresh rate-limit bucket per request.
    real_ip = request.headers.get("x-real-ip", "").strip()
    if real_ip:
        return real_ip

    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        # Last entry is the one appended by our own proxy hop.
        last_ip = forwarded_for.rsplit(",", 1)[-1].strip()
        if last_ip:
            return last_ip

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

# Payment proofs. Smaller cap than a generation input (a receipt is a photo or a
# one-page PDF), and PDF is allowed because bank-transfer receipts usually are one.
MAX_PROOF_BYTES = 5 * 1024 * 1024
MAX_PROOF_FILES = 3
PROOF_CONTENT_TYPES = {"image/png", "image/jpeg", "image/webp", "application/pdf"}
CREDIT_ORDER_NOTE_MAX_LENGTH = 400

# Shown when spending is frozen because a card payment on the account is under
# dispute (see set_payment_hold). Deliberately says what happened and that it is
# temporary — a hold is not an accusation, and most disputes resolve.
PAYMENT_HOLD_MESSAGE = (
    "Spending is paused while a card payment on this account is being disputed. "
    "It will be restored when the dispute is resolved — contact us if you think this is a mistake."
)

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
    try:
        from alembic.config import Config as AlembicConfig
        from alembic import command
        from app.db.session import get_database_url
        alembic_ini_path = Path(__file__).resolve().parent.parent / "alembic.ini"
        alembic_dir_path = Path(__file__).resolve().parent.parent / "alembic"
        if alembic_ini_path.exists():
            alembic_cfg = AlembicConfig(str(alembic_ini_path))
            alembic_cfg.set_main_option("script_location", str(alembic_dir_path))
            alembic_cfg.set_main_option("sqlalchemy.url", get_database_url())
            command.upgrade(alembic_cfg, "head")
            logger.info("[alembic] Automatic DB migration upgrade head succeeded.")
    except Exception as exc:
        logger.warning("[alembic] Auto DB migration on startup skipped/failed: %s", exc)

    _cleanup_expired_uploaded_images()
    _cleanup_expired_payment_proofs()
    catalog_store.initialize()
    preload_security_store()
    # Announce the email transport mode: DRY-RUN is silent-by-design, so without
    # this the only way to know a box delivers nothing is to inspect the DB.
    try:
        from app.services.email_client import transport_status

        logger.info("[email] transport: %s", transport_status())
    except Exception:
        logger.exception("[email] could not resolve transport status")
    # Same reasoning for the Discord order channel: a token-less box logs cards
    # instead of posting them, and that failure mode is otherwise invisible.
    try:
        from app.services.discord_client import transport_status as discord_transport_status

        logger.info("[discord] transport: %s", discord_transport_status())
    except Exception:
        logger.exception("[discord] could not resolve transport status")
    # Eagerly refresh the live model catalog so pack model lists are complete
    # from the very first request (before the AKM catalog webhook fires).
    try:
        settings.refresh_model_catalog()
    except Exception:
        pass


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
def list_plain_chat_model_options(request: Request):
    # Public, no auth: the catalogue is non-sensitive (ids, providers, modalities,
    # pricing summary already shown on /pricing) and carries no per-user data. This
    # lets the open Playground populate its model picker for anonymous visitors.
    del request
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
    try:
        normalized_system = normalize_plain_chat_system(payload.model, payload.system)
    except ValueError as exc:
        # e.g. the chosen model was disabled by an admin between selection and send:
        # surface a clear message instead of a bare 500.
        raise HTTPException(status_code=400, detail=_plain_chat_error_message(str(exc))) from exc
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
    model_name = ""

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
        status_code = 402 if str(exc) in {"INSUFFICIENT_CREDITS", "PAYMENT_HOLD"} else 400
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
        if exc.error_type == "content_blocked":
            from app.services.security_backend import record_moderation_rejection
            ban = record_moderation_rejection(
                user["uid"], model_name or "plain_chat", exc.code, moderation=getattr(exc, "moderation", None)
            )
            if isinstance(ban, dict) and ban.get("banned") and not ban.get("alreadySuspended"):
                # This block crossed the threshold and just suspended the account →
                # return the suspension response so the client ejects to sign-in
                # immediately instead of showing the per-block warning.
                raise HTTPException(
                    status_code=403,
                    detail=format_suspension_detail(ban.get("reason"), ban.get("until")),
                )
            raise HTTPException(status_code=403, detail={"error": {"code": "CONTENT_BLOCKED"}})
        if exc.error_type == "moderation_unavailable":
            # The safety gate could not reach a moderation backend and blocked
            # defensively (fail-closed). This is an infrastructure condition, NOT a
            # user violation: no rejection is recorded (no ban), nothing is charged,
            # and the client is told it is a transient "try again" error.
            raise HTTPException(status_code=503, detail={"error": {"code": "MODERATION_UNAVAILABLE"}})

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


def _verify_internal_secret(x_internal_secret: str | None) -> None:
    """Shared guard for internal cron/timer endpoints (see /internal/expire-credits)."""
    expected_secret = settings.internal_sweep_secret or settings.catalog_webhook_secret
    if not expected_secret:
        raise HTTPException(status_code=503, detail="Internal secret is not configured")
    if not x_internal_secret or not secrets.compare_digest(x_internal_secret, expected_secret):
        raise HTTPException(status_code=403, detail="Invalid internal secret")


@app.post(
    "/internal/email/drip",
    tags=["Configuration"],
    summary="Onboarding Drip Email Sweep",
    description="Internal endpoint (daily timer). Emails day-1/3/7 onboarding tips to active users.",
)
@limiter.limit("6/minute")
def email_drip_sweep(request: Request, x_internal_secret: str | None = Header(default=None)):
    del request
    _verify_internal_secret(x_internal_secret)
    from app.services.email_service import run_drip_sweep

    return {"status": "ok", **run_drip_sweep()}


@app.post(
    "/internal/email/expiry-warn",
    tags=["Configuration"],
    summary="Gift-Credit Expiry Warning Email Sweep",
    description="Internal endpoint (daily timer). Warns users whose gift credits expire within 24h.",
)
@limiter.limit("6/minute")
def email_expiry_warn_sweep(request: Request, x_internal_secret: str | None = Header(default=None)):
    del request
    _verify_internal_secret(x_internal_secret)
    from app.services.email_service import run_expiry_warn_sweep

    return {"status": "ok", **run_expiry_warn_sweep()}


@app.post(
    "/internal/email/winback",
    tags=["Configuration"],
    summary="Win-Back Email Sweep",
    description="Internal endpoint (daily timer). Re-engages consented users dormant for 7 / 14 days.",
)
@limiter.limit("6/minute")
def email_winback_sweep(request: Request, x_internal_secret: str | None = Header(default=None)):
    del request
    _verify_internal_secret(x_internal_secret)
    from app.services.email_service import run_winback_sweep

    return {"status": "ok", **run_winback_sweep()}


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


@app.post("/me/complete-profile", tags=["Configuration"], summary="Complete New User Profile")
@limiter.limit("15/minute")
def complete_current_user_profile(
    request: Request,
    payload: ProfileCompletionRequest,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    try:
        return complete_user_profile(user["uid"], full_name=payload.full_name, username=payload.username)
    except ValueError as exc:
        code = str(exc)
        if code == "PROFILE_NAME_REQUIRED":
            raise HTTPException(status_code=400, detail="Your name is required") from exc
        if code == "PROFILE_USERNAME_REQUIRED":
            raise HTTPException(status_code=400, detail="Username is required") from exc
        if code == "PROFILE_USERNAME_TAKEN":
            raise HTTPException(status_code=409, detail="Username is already taken") from exc
        raise HTTPException(status_code=400, detail="Invalid profile") from exc


@app.patch("/me/preferences", tags=["Configuration"], summary="Update Current User Notification Preferences")
@limiter.limit("10/day")
def update_current_user_notification_preferences(
    request: Request,
    payload: UserNotificationPreferencesUpdateRequest,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    return update_user_notification_preferences(
        user["uid"],
        email_general_news_enabled=payload.email_general_news_enabled,
        email_platform_updates_enabled=payload.email_platform_updates_enabled,
        email_lifecycle_enabled=payload.email_lifecycle_enabled,
        preferred_language=payload.preferred_language,
        mark_prompted=bool(payload.preferences_prompted),
    )


def _handle_email_unsubscribe(token: str) -> HTMLResponse:
    """One-click unsubscribe from lifecycle/marketing email. The signed token is the
    only credential (no login needed), so a mail client can honour List-Unsubscribe."""
    from app.services.email_service import verify_unsubscribe_token

    parsed = verify_unsubscribe_token((token or "").strip())
    ok = False
    if parsed:
        uid, _category = parsed
        try:
            set_email_lifecycle_enabled(uid, False)
            ok = True
        except Exception:
            ok = False
    message = (
        "You've been unsubscribed from tips &amp; product reminders."
        if ok
        else "This unsubscribe link is invalid or has expired."
    )
    body = (
        "<!doctype html><html><body style=\"margin:0;background:#0f1320;color:#eef1fb;"
        "font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif\">"
        "<div style=\"max-width:520px;margin:64px auto;padding:32px;background:#151b2d;border-radius:14px\">"
        "<div style=\"font-size:20px;font-weight:800;color:#adc6ff;margin-bottom:12px\">Vibecraft</div>"
        f"<p style=\"font-size:16px;line-height:1.6;color:#c2c6d6\">{message}</p>"
        "<p style=\"font-size:14px;color:#6b7080\">You can change email preferences any time in "
        f"<a href=\"{settings.app_base_url}/settings\" style=\"color:#adc6ff\">Settings</a>.</p>"
        "</div></body></html>"
    )
    return HTMLResponse(content=body, status_code=200 if ok else 400)


@app.get("/email/unsubscribe", tags=["Configuration"], summary="One-Click Email Unsubscribe", include_in_schema=False)
@limiter.limit("60/hour")
def email_unsubscribe_get(request: Request, token: str = ""):
    del request
    return _handle_email_unsubscribe(token)


@app.post("/email/unsubscribe", tags=["Configuration"], summary="One-Click Email Unsubscribe (RFC 8058)", include_in_schema=False)
@limiter.limit("60/hour")
def email_unsubscribe_post(request: Request, token: str = ""):
    # RFC 8058 List-Unsubscribe-Post: mail clients POST here automatically.
    del request
    return _handle_email_unsubscribe(token)


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
def redeem_user_credit_code(
    request: Request,
    payload: Dict[str, Any],
    background_tasks: BackgroundTasks,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    code = str(payload.get("code", "")).strip()
    if not code:
        raise HTTPException(status_code=400, detail="Code is required")
    code_hash = hash_credit_code(code)
    per_code_key = f"redeem_code:{code_hash}"
    if not consume_rate_limit(per_code_key, max_count=20, window_seconds=900):
        raise HTTPException(status_code=429, detail="Too many attempts for this code. Try again later.")
    result = redeem_credit_code(code, user["uid"])
    # Receipt email on a successful redemption (deduped by code_hash so a re-POST
    # of the same code never double-sends). Fired off-request; never blocks.
    if isinstance(result, dict) and result.get("success"):
        background_tasks.add_task(
            dispatch_email,
            "credit_receipt",
            user["uid"],
            dedupe_key=code_hash,
            to_email=str(user.get("email") or ""),
            to_name=str(user.get("display_name") or ""),
            ctx={
                "credits": result.get("credits"),
                "balance": result.get("balance"),
                "expires_at": result.get("expiresAt"),
            },
        )
    return result


@app.get("/credits/breakdown", tags=["Configuration"], summary="Credit Balance Breakdown")
@limiter.limit("30/minute")
def credit_balance_breakdown(request: Request, user: Dict[str, Any] = Depends(verify_firebase_user)):
    del request
    return get_credit_breakdown(user["uid"])


# ---------------------------------------------------------------------------
# Manual credit purchase (Tunisian payment methods)
#
# The user picks a plan, pays out-of-band, and uploads a receipt; the order sits
# `pending` until an admin accepts it with a redeem code they generated in
# /admin/codes, or refuses it. Accepting moves NO credits — the user redeems the
# code through /credits/redeem, so a purchase reaches the ledger exactly once.
# ---------------------------------------------------------------------------


@app.get(
    "/credits/checkout-config",
    response_model=CheckoutConfigResponse,
    tags=["Configuration"],
    summary="Get Credit Checkout Config",
)
@limiter.limit("60/minute")
def get_credit_checkout_config(request: Request, _: bool = Depends(verify_api_key)):
    # API-key only (no Firebase): /credits is browsable logged-out, so an anonymous
    # visitor can read the plans and is only walled when they try to order.
    del request
    return CheckoutConfigResponse(
        plans=[
            CreditPlanResponse(
                id=str(plan["id"]),
                name=str(plan["name"]),
                credits=float(plan["credits"]),
                priceMinor=int(plan["price_minor"]),
                currency=str(plan["currency"]),
            )
            for plan in CREDIT_PLANS
        ],
        plansUsd=[
            CreditPlanResponse(
                id=str(plan["id"]),
                name=str(plan["name"]),
                credits=float(plan["credits"]),
                priceMinor=int(plan["price_minor"]),
                currency=str(plan["currency"]),
            )
            for plan in CREDIT_PLANS_USD
        ],
        methods=[
            PaymentMethodResponse(
                id=str(method["id"]),
                group=str(method["group"]),
                available=bool(method["available"]),
                label=str(method.get("label") or ""),
                icon=str(method.get("icon") or ""),
                primaryLabel=str(method.get("primary_label") or ""),
                primaryValue=str(method.get("primary_value") or ""),
                meta=[str(m) for m in method.get("meta") or []],
            )
            for method in PAYMENT_METHODS
        ],
        whatsappNumber=PAYMENT_WHATSAPP_NUMBER,
        maxProofFiles=MAX_PROOF_FILES,
        maxProofBytes=MAX_PROOF_BYTES,
        noteMaxLength=CREDIT_ORDER_NOTE_MAX_LENGTH,
    )


@app.post(
    "/credits/checkout/dodo",
    response_model=DodoCheckoutResponse,
    tags=["Configuration"],
    summary="Create A Dodo Payments Checkout Session",
)
@limiter.limit("10/minute")
def create_dodo_checkout(
    request: Request,
    payload: DodoCheckoutRequest,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    # request is read below for the buyer's Meta Pixel cookies.
    plan = CREDIT_PLANS_USD_BY_ID.get(str(payload.planId).strip())
    if plan is None:
        raise HTTPException(status_code=400, detail="Unknown plan")

    # Two brakes, both here rather than in the webhook: refusing to CREDIT a
    # payment the customer already made would be the wrong failure mode.
    #
    # Card testing is the threat this rail actually has, and it does not produce
    # payments — a declined card records nothing. So the attempt cap, not the
    # purchase cap, is what bounds someone working through a list of stolen
    # cards. It is checked first and consumes a token per session started.
    attempt_cap = int(settings.max_card_checkout_attempts_per_day)
    if attempt_cap > 0 and not consume_rate_limit(
        f"card:checkout:attempt:{user['uid']}", max_count=attempt_cap, window_seconds=24 * 60 * 60
    ):
        logger.warning("[dodo] uid=%s hit the daily card checkout ATTEMPT cap", user["uid"])
        raise HTTPException(
            status_code=429,
            detail=(
                "Too many card payment attempts today. Please try again tomorrow, "
                "or contact us on WhatsApp if you need help."
            ),
        )

    # The purchase cap bounds how much one account can buy in a day, and with it
    # how much chargeback exposure a single compromised account can create.
    daily_cap = int(settings.max_card_checkouts_per_day)
    if daily_cap > 0:
        recent = count_recent_card_payments(str(user["uid"]), window_seconds=24 * 60 * 60)
        if recent >= daily_cap:
            raise HTTPException(
                status_code=429,
                detail=(
                    f"You have reached the limit of {daily_cap} card purchases per day. "
                    "Please try again tomorrow, or contact us on WhatsApp if you need more."
                ),
            )

    return_url = f"{settings.app_base_url}/credits/buy?step=card-return"
    try:
        checkout_url = dodo_payments.create_checkout_session(
            uid=str(user["uid"]),
            plan=plan,
            return_url=return_url,
            # Ride along in the session metadata so the webhook can attribute the
            # Purchase; by then this browser is gone.
            fbp=request.cookies.get("_fbp"),
            fbc=request.cookies.get("_fbc"),
        )
    except dodo_payments.DodoNotConfiguredError as exc:
        logger.warning("[dodo] checkout session requested but not configured: %s", exc)
        raise HTTPException(status_code=503, detail="Card payment is not available right now") from exc
    except Exception as exc:
        logger.exception("[dodo] failed to create checkout session")
        raise HTTPException(status_code=502, detail="Could not start card checkout") from exc

    return DodoCheckoutResponse(checkoutUrl=checkout_url)


def _dodo_business_is_ours(payload: Dict[str, Any]) -> bool:
    """Does this delivery belong to the Dodo business this instance serves?

    ``business_id`` sits on the webhook ENVELOPE, beside ``type`` and ``data`` —
    not inside ``data``. A valid signature only proves the sender holds the
    secret; staging and production share one Dodo account, so a copied
    DODO_WEBHOOK_SECRET would otherwise let a test-mode payment credit a real
    user. Unset, the check is skipped with a warning rather than failing closed:
    staging predates the setting and must keep working until the env is
    provisioned.
    """
    observed = str(payload.get("business_id") or "").strip()
    expected = str(settings.dodo_business_id or "").strip()
    if not expected:
        # Log what we actually saw, so the value can be read straight out of the
        # logs after the first delivery in a new environment. Test and live are
        # separate Dodo environments and the live business_id cannot be known in
        # advance from the test-mode one — so the safe bootstrap is: deploy with
        # this unset, take one real payment, read the id from here, then set it.
        # Guessing it instead would 401 every live delivery and leave paying
        # customers with no credits.
        logger.warning(
            "[dodo] DODO_BUSINESS_ID is not configured — accepting this delivery without the "
            "business pin. Observed business_id=%s; set that in the environment to enable the pin.",
            observed or "<missing>",
        )
        return True
    return observed == expected


def _dodo_cart_product_ids(data: Dict[str, Any]) -> set[str]:
    """Product ids on a Payment payload. Empty when Dodo did not send a cart —
    ``product_cart`` is Optional, so absent means 'cannot verify', not 'wrong'."""
    ids: set[str] = set()
    for item in data.get("product_cart") or []:
        if isinstance(item, dict):
            product_id = str(item.get("product_id") or "").strip()
            if product_id:
                ids.add(product_id)
    return ids


def _dodo_uid_for_payment(dodo_payment_id: str) -> str:
    """The account a card payment belongs to, or "" if we never credited it.

    A dispute can arrive for a payment made outside our checkout, or from the
    other environment sharing this Dodo account — neither is ours to freeze.
    """
    uid = get_card_payment_uid(dodo_payment_id)
    if not uid:
        logger.warning("[dodo] no card payment on record for payment_id=%s; ignoring", dodo_payment_id)
        return ""
    return str(uid)


def _dodo_dispute_amount_minor(data: Dict[str, Any]) -> int | None:
    """Dispute.amount is a STRING on Dodo's model, unlike Payment.total_amount
    and Refund.amount which are ints. Returns None when it cannot be parsed, and
    None means 'reverse the whole payment'."""
    raw = data.get("amount")
    if raw is None:
        return None
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        logger.warning("[dodo] could not parse dispute amount %r; treating as a full reversal", raw)
        return None


def _handle_dodo_reversal_event(event_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Refund and dispute events — the half of the card rail that takes credits
    back.

    Disputes are a lifecycle, not a moment, so they are handled in two stages:
    `dispute.opened` freezes spending while the outcome is unknown, and only
    `dispute.lost` actually debits. `dispute.won`/`dispute.cancelled` lift the
    freeze without ever having taken anything, which is the point — a customer
    who wins a legitimate billing dispute should not have been punished for
    raising it.

    Refunds are unconditional: the money has already gone back.
    """
    data = payload.get("data") or {}
    dodo_payment_id = str(data.get("payment_id") or "").strip()

    if not dodo_payment_id:
        logger.error("[dodo] %s with no payment_id; cannot act", event_type)
        return {"status": "unprocessable", "type": event_type}

    # Mid-lifecycle dispute events and failed refunds change nothing about the
    # money. Logged rather than dropped so a support case can be traced.
    if event_type in ("dispute.accepted", "dispute.challenged", "dispute.expired", "refund.failed"):
        logger.info("[dodo] %s for payment_id=%s (no ledger effect)", event_type, dodo_payment_id)
        return {"status": "ignored", "type": event_type}

    if event_type == "dispute.opened":
        uid = _dodo_uid_for_payment(dodo_payment_id)
        if not uid:
            return {"status": "unknown_payment", "type": event_type}
        set_payment_hold(
            uid,
            reason=f"A card payment ({dodo_payment_id}) is being disputed. Spending is paused until it resolves.",
        )
        logger.warning("[dodo] dispute OPENED on payment_id=%s; spending frozen for uid=%s", dodo_payment_id, uid)
        return {"status": "hold_applied", "type": event_type}

    if event_type in ("dispute.won", "dispute.cancelled"):
        uid = _dodo_uid_for_payment(dodo_payment_id)
        if not uid:
            return {"status": "unknown_payment", "type": event_type}
        # No debit ever happened for these, so there is nothing to give back —
        # only the freeze to lift. Safe even if dispute.opened never arrived.
        clear_payment_hold(uid, reason=f"Dispute on card payment {dodo_payment_id} resolved in our favour.")
        logger.info("[dodo] %s on payment_id=%s; spending unfrozen for uid=%s", event_type, dodo_payment_id, uid)
        return {"status": "hold_cleared", "type": event_type}

    if event_type == "refund.succeeded":
        event_ref_id = str(data.get("refund_id") or "").strip()
        amount_minor = data.get("amount")
        # A partial refund reverses only part of the credits; is_partial is
        # authoritative, but a missing amount still means "all of it".
        if not bool(data.get("is_partial")) or amount_minor is None:
            amount_minor = None
        else:
            amount_minor = int(amount_minor)
        kind = "refund"
        reason_label = f"Refund {event_ref_id} on card payment {dodo_payment_id}."
    elif event_type == "dispute.lost":
        event_ref_id = str(data.get("dispute_id") or "").strip()
        amount_minor = _dodo_dispute_amount_minor(data)
        kind = "dispute"
        reason_label = f"Chargeback lost on card payment {dodo_payment_id}."
    else:
        logger.info("[dodo] %s for payment_id=%s; no action defined", event_type, dodo_payment_id)
        return {"status": "ignored", "type": event_type}

    if not event_ref_id:
        logger.error("[dodo] %s for payment_id=%s has no event id; cannot dedupe, refusing to act",
                     event_type, dodo_payment_id)
        return {"status": "unprocessable", "type": event_type}

    result = reverse_dodo_card_payment(
        dodo_payment_id=dodo_payment_id,
        event_ref_id=event_ref_id,
        kind=kind,
        amount_minor=amount_minor,
        reason_label=reason_label,
    )
    if not result.get("success"):
        # 500 so Dodo keeps retrying: money has left our side and the credits
        # are still with the user.
        raise HTTPException(status_code=500, detail="Could not record this reversal")
    if result.get("duplicate"):
        return {"status": "duplicate", "type": event_type}
    if result.get("unknown_payment"):
        return {"status": "unknown_payment", "type": event_type}
    logger.warning(
        "[dodo] %s reversed payment_id=%s: clawed %s minor, wrote off %s minor",
        event_type,
        dodo_payment_id,
        result.get("clawed_minor"),
        result.get("written_off_minor"),
    )
    return {"status": "reversed", "type": event_type}


@app.post(
    "/webhooks/dodo",
    tags=["Configuration"],
    summary="Dodo Payments Webhook",
    include_in_schema=False,
)
@limiter.limit("240/minute")
async def handle_dodo_webhook(request: Request):
    """Dodo's webhook for payment events. Unauthenticated by design — same
    shape as /discord/interactions: the HMAC signature over the raw body IS
    the authentication, so the body is read as raw bytes rather than through a
    Pydantic model (re-serializing a parsed dict would change the bytes the
    signature was computed over and every verification would fail).

    A missing DODO_WEBHOOK_SECRET is NOT treated as "feature disabled, no-op"
    the way a missing Discord token or email key is elsewhere in this
    codebase — this endpoint mints credits, so an unconfigured secret means
    every delivery is rejected with 503 rather than silently accepted.
    """
    body = await request.body()
    if not settings.dodo_webhook_secret:
        logger.error("[dodo] webhook received but DODO_WEBHOOK_SECRET is not configured; rejecting")
        raise HTTPException(status_code=503, detail="Webhook is not configured")

    try:
        payload = dodo_payments.verify_webhook(body, dict(request.headers))
    except dodo_payments.WebhookVerificationError as exc:
        logger.warning("[dodo] webhook signature REJECTED: %s", exc)
        raise HTTPException(status_code=401, detail="invalid webhook signature") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="malformed webhook payload")

    if not _dodo_business_is_ours(payload):
        logger.error(
            "[dodo] delivery for business_id=%s, which is not ours; rejecting",
            payload.get("business_id") or "<missing>",
        )
        raise HTTPException(status_code=401, detail="unexpected business")

    event_type = str(payload.get("type") or "")
    if event_type in ("payment.failed", "payment.cancelled", "payment.processing"):
        # Crediting only ever happens on a confirmed "payment.succeeded" -- these
        # three are acknowledged and logged (not silently dropped) so a "I paid
        # but got nothing" support case can be traced to what Dodo actually
        # reported, without needing to grant credits for anything here.
        data = payload.get("data") or {}
        metadata = data.get("metadata") or {}
        logger.info(
            "[dodo] %s: uid=%s plan_id=%s payment_id=%s",
            event_type,
            metadata.get("uid") or "<missing>",
            metadata.get("plan_id") or "<missing>",
            data.get("payment_id") or "<missing>",
        )
        return {"status": "ignored", "type": event_type}

    if event_type.startswith("refund.") or event_type.startswith("dispute."):
        return _handle_dodo_reversal_event(event_type, payload)

    if event_type != "payment.succeeded":
        # Any other subscribed event we don't specifically act on.
        return {"status": "ignored", "type": event_type}

    data = payload.get("data") or {}
    metadata = data.get("metadata") or {}
    uid = str(metadata.get("uid") or "").strip()
    plan_id = str(metadata.get("plan_id") or "").strip()
    dodo_payment_id = str(data.get("payment_id") or "").strip()
    plan = CREDIT_PLANS_USD_BY_ID.get(plan_id)

    if not uid or not dodo_payment_id or plan is None:
        logger.error(
            "[dodo] payment.succeeded with unusable payload: uid=%s plan_id=%s payment_id=%s",
            uid or "<missing>",
            plan_id or "<missing>",
            dodo_payment_id or "<missing>",
        )
        # 200, not 4xx: the signature was valid, so this is our metadata being
        # wrong, not a request Dodo should retry forever.
        return {"status": "unprocessable"}

    # The product the customer actually paid for must be the one this plan maps
    # to. Without this, `metadata.plan_id` alone decides how many credits are
    # granted — safe only as long as create_checkout_session stays the sole
    # writer of that metadata, which is a property of today's call sites rather
    # than an enforced invariant. A payment link or a dashboard-created payment
    # carrying plan_id="ultra" would otherwise mint 70 credits for anything.
    cart_product_ids = _dodo_cart_product_ids(data)
    expected_product_id = str(settings.dodo_product_ids.get(plan_id) or "").strip()
    if cart_product_ids and expected_product_id and expected_product_id not in cart_product_ids:
        logger.error(
            "[dodo] payment.succeeded for plan_id=%s but the cart holds %s, not %s; refusing to credit",
            plan_id,
            sorted(cart_product_ids),
            expected_product_id,
        )
        record_card_payment_anomaly(
            uid=uid,
            dodo_payment_id=dodo_payment_id,
            action="card_payment_product_mismatch",
            reason=f"Refused to credit: plan '{plan_id}' does not match the product paid for.",
            metadata={
                "plan_id": plan_id,
                "expected_product_id": expected_product_id,
                "cart_product_ids": sorted(cart_product_ids),
            },
        )
        return {"status": "product_mismatch"}

    # total_amount is what the customer was actually charged (currency's minor
    # unit — cents for USD), including tax. Not `amount`: that field doesn't
    # exist on Dodo's Payment object.
    #
    # `is not None` rather than `or`: total_amount is a required int on Dodo's
    # Payment model, so a zero-amount payment is a real value, not a missing
    # one. `or` would substitute the full plan price and record a free purchase
    # as if it had been paid for — erasing the only local evidence it happened.
    raw_total_amount = data.get("total_amount")
    price_minor = int(raw_total_amount) if raw_total_amount is not None else int(plan["price_minor"])
    currency = str(data.get("currency") or plan["currency"])

    # Nothing upstream guarantees the customer paid the plan price. Dodo checkout
    # accepts up to 20 stacked discount codes on its hosted page, so a code
    # created in the dashboard can reduce the charge without us ever seeing it.
    # Grant credits in proportion to what was actually collected rather than
    # refusing outright: a promo then degrades to "fewer credits for less money"
    # instead of taking the customer's money and silently giving them nothing.
    expected_minor = int(plan["price_minor"])
    plan_credits_minor = int(round(float(plan["credits"]) * 100))
    same_currency = currency.strip().upper() == str(plan["currency"]).strip().upper()
    granted_credits_minor = plan_credits_minor
    underpaid = False

    if same_currency and price_minor < expected_minor:
        if price_minor <= 0:
            logger.error(
                "[dodo] payment.succeeded collected %s %s for plan %s; refusing to credit",
                price_minor,
                currency,
                plan_id,
            )
            record_card_payment_anomaly(
                uid=uid,
                dodo_payment_id=dodo_payment_id,
                action="card_payment_unpaid",
                reason="Refused to credit: the payment collected nothing.",
                metadata={"plan_id": plan_id, "expected_minor": expected_minor, "currency": currency},
            )
            return {"status": "unpaid"}
        granted_credits_minor = (plan_credits_minor * price_minor) // expected_minor
        underpaid = True

    result = credit_dodo_card_payment(
        dodo_payment_id=dodo_payment_id,
        uid=uid,
        plan_id=plan_id,
        credits=granted_credits_minor / 100,
        price_minor=price_minor,
        currency=currency,
    )
    if not result.get("success"):
        # NOT a duplicate — an unexplained failure while crediting a payment
        # Dodo believes succeeded. 500 so Dodo's retry schedule keeps trying
        # rather than treating this delivery as handled.
        raise HTTPException(status_code=500, detail="Could not record this payment")

    # Report the sale to Meta on the delivery that actually credited. Dodo
    # retries the same event up to 8 times, and `duplicate` is what tells those
    # apart — event_id would dedupe them Meta-side anyway, this just avoids the
    # pointless calls.
    if not result.get("duplicate"):
        try:
            buyer_email = str(get_user(uid).get("email") or "")
            meta_capi.send_purchase(
                event_id=f"dodo_{dodo_payment_id}",
                uid=uid,
                email=buyer_email,
                plan_id=plan_id,
                plan_name=str(plan["name"]),
                price_minor=price_minor,
                currency=currency,
                fbp=str(metadata.get("fbp") or "") or None,
                fbc=str(metadata.get("fbc") or "") or None,
            )
        except Exception:
            logger.exception("[dodo] Meta CAPI Purchase dispatch failed for %s", dodo_payment_id)

    # Flag the odd ones only on the delivery that actually credited, so a Dodo
    # retry does not pile up duplicate audit rows for the same payment.
    if not result.get("duplicate"):
        if underpaid:
            record_card_payment_anomaly(
                uid=uid,
                dodo_payment_id=dodo_payment_id,
                action="card_payment_underpaid",
                reason=(
                    f"Collected {price_minor} of {expected_minor} {currency} for plan "
                    f"'{plan_id}'; credited {granted_credits_minor / 100:.2f} instead of "
                    f"{plan_credits_minor / 100:.2f}."
                ),
                metadata={
                    "plan_id": plan_id,
                    "collected_minor": price_minor,
                    "expected_minor": expected_minor,
                    "currency": currency,
                    "granted_credits": granted_credits_minor / 100,
                    "plan_credits": plan_credits_minor / 100,
                },
            )
        elif not same_currency:
            # Adaptive pricing settled in another currency. Credited in full —
            # comparing cents against paise would be nonsense — but a human
            # should see it, because it is also what a mispriced product looks
            # like.
            record_card_payment_anomaly(
                uid=uid,
                dodo_payment_id=dodo_payment_id,
                action="card_payment_currency_mismatch",
                reason=(
                    f"Settled in {currency}, but plan '{plan_id}' is priced in "
                    f"{plan['currency']}. Credited in full without an amount check."
                ),
                metadata={
                    "plan_id": plan_id,
                    "collected_minor": price_minor,
                    "settled_currency": currency,
                    "plan_currency": str(plan["currency"]),
                },
            )

    return {"status": "duplicate" if result.get("duplicate") else "credited"}


@app.get(
    "/credits/orders",
    response_model=CreditOrderListResponse,
    tags=["Configuration"],
    summary="List My Credit Orders",
)
@limiter.limit("30/minute")
def list_my_credit_orders(request: Request, user: Dict[str, Any] = Depends(verify_firebase_user)):
    del request
    return CreditOrderListResponse(orders=list_user_credit_orders(str(user["uid"]), limit=20))


@app.post(
    "/credits/orders",
    response_model=CreditOrderResponse,
    tags=["Configuration"],
    summary="Place A Manual Credit Order",
)
@limiter.limit("5/minute")
async def place_credit_order(
    request: Request,
    background_tasks: BackgroundTasks,
    plan_id: str = Form(...),
    payment_method: str = Form(...),
    note: str = Form(""),
    proofs: list[UploadFile] = File(...),
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    plan = CREDIT_PLANS_BY_ID.get(str(plan_id).strip())
    if plan is None:
        raise HTTPException(status_code=400, detail="Unknown plan")
    if str(payment_method).strip() not in AVAILABLE_PAYMENT_METHOD_IDS:
        raise HTTPException(status_code=400, detail="This payment method is not available yet")
    if len(note) > CREDIT_ORDER_NOTE_MAX_LENGTH:
        raise HTTPException(status_code=400, detail="Note is too long")

    uploads = [item for item in proofs if item is not None and item.filename]
    if not uploads:
        raise HTTPException(status_code=400, detail="Attach at least one proof of payment")
    if len(uploads) > MAX_PROOF_FILES:
        raise HTTPException(status_code=400, detail=f"Attach at most {MAX_PROOF_FILES} files")

    _enforce_upload_limits(request, str(user["uid"]))

    # Sweep expired receipts from the path that creates them, the same way the
    # upload endpoint sweeps expired uploads. Startup alone would mean the
    # retention window only advances when the backend restarts.
    _cleanup_expired_payment_proofs()

    # Read and validate every file BEFORE writing any of them, so a rejected
    # second file never leaves the first one orphaned on disk.
    validated: list[tuple[str, bytes]] = []
    for upload in uploads:
        if upload.content_type not in PROOF_CONTENT_TYPES:
            raise HTTPException(status_code=400, detail="Proof must be a PNG, JPEG, WEBP, or PDF file")
        file_bytes = await upload.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail="One of the uploaded files is empty")
        if len(file_bytes) > MAX_PROOF_BYTES:
            raise HTTPException(status_code=400, detail="Each file must be 5 MB or smaller")
        detected_type = _inspect_payment_proof_bytes(file_bytes)
        if detected_type != upload.content_type:
            raise HTTPException(status_code=400, detail="Uploaded file content does not match its declared type")
        validated.append((detected_type, file_bytes))

    # A re-submitted receipt is NOT rejected here — a buyer refused over a wrong
    # amount may legitimately re-send the same correct receipt. The hash is what
    # lets the reviewer see it happened; the decision stays theirs.
    file_ids: list[str] = []
    for mime_type, file_bytes in validated:
        filename = _save_payment_proof_bytes(mime_type, file_bytes)
        file_ids.append(
            create_payment_proof_file_record(
                str(user["uid"]),
                filename,
                mime_type,
                hashlib.sha256(file_bytes).hexdigest(),
            )
        )

    try:
        order = create_credit_order(
            uid=str(user["uid"]),
            plan_id=str(plan["id"]),
            plan_name=str(plan["name"]),
            credits=float(plan["credits"]),
            price_minor=int(plan["price_minor"]),
            currency=str(plan["currency"]),
            payment_method=str(payment_method).strip(),
            note=note,
            proof_file_ids=file_ids,
            # Stored now, used much later: the Purchase event goes out when an
            # admin accepts this order, with no buyer browser around to read
            # cookies from.
            fb_pixel_fbp=request.cookies.get("_fbp"),
            fb_pixel_fbc=request.cookies.get("_fbc"),
        )
        # Announce it in the Discord review channel after the response is sent.
        # Deliberately fail-open and out-of-band: a Discord outage must never
        # turn a paid-for order into a failed checkout.
        background_tasks.add_task(discord_orders.announce_credit_order, str(order["id"]))
        return order
    except ValueError as exc:
        # The order was rejected, so the files we just wrote have no owner record
        # to reach them — drop them rather than leaking disk.
        for file_id in file_ids:
            delete_private_user_file_by_id(file_id)
        if str(exc) == "TOO_MANY_ORDERS_THIS_WEEK":
            # Deliberately worded differently from the open-orders case below:
            # this one does not clear when a reviewer works through the queue.
            raise HTTPException(
                status_code=429,
                detail=(
                    f"You have reached the limit of {settings.max_credit_orders_per_week} orders per week. "
                    "Please try again in a few days, or contact us on WhatsApp if you need more."
                ),
            ) from exc
        if str(exc) == "TOO_MANY_OPEN_ORDERS":
            raise HTTPException(
                status_code=429,
                detail="You already have orders awaiting review. Please wait for them to be processed.",
            ) from exc
        raise HTTPException(status_code=400, detail="Could not place this order") from exc


@app.get(
    "/credits/orders/{order_id}/proof/{file_id}",
    tags=["Configuration"],
    summary="Get Credit Order Proof From A Signed Link",
)
@limiter.limit("60/minute")
def get_credit_order_proof_signed(
    request: Request,
    order_id: str,
    file_id: str,
    exp: int = 0,
    sig: str = "",
):
    """Serve one payment proof to whoever holds a valid, unexpired signed link.

    This exists so a reviewer can open a receipt from the Discord card on their
    phone: the admin route next to it needs an admin session cookie, which a
    Discord embed has no way to carry. The signature covers order + file + expiry
    together, so a link cannot be re-pointed at another order's proof, and it
    stops working on its own — an old card in the channel scrollback is not a
    permanent key to a customer's receipt.
    """
    del request
    if not discord_orders.verify_proof_link(order_id, file_id, int(exp or 0), str(sig or "")):
        # One message for expired, tampered, and unsigned alike — a distinct
        # "expired" response would confirm that the order/file pair is real.
        raise HTTPException(status_code=403, detail="This link is no longer valid. Open the admin panel instead.")
    if get_credit_order_proof_file_id(order_id, file_id) is None:
        raise HTTPException(status_code=404, detail="Proof not found")
    file_record, filepath = load_payment_proof_file(file_id)
    storage_path = str(file_record["storage_path"])
    mime_type = str(file_record.get("mime_type") or "image/jpeg")

    if filepath.exists():
        return FileResponse(
            filepath,
            media_type=mime_type,
            headers={
                "Cache-Control": "private, no-store",
                "Content-Disposition": "inline",
                **GENERATED_IMAGE_SAFE_HEADERS,
            },
        )

    r2_public_base = os.getenv("R2_PUBLIC_URL", "https://pub-64bf9ef2292c49f0a2053981c85e16d9.r2.dev").rstrip("/")
    return RedirectResponse(url=f"{r2_public_base}/payment_proofs/{storage_path}", status_code=307)


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


@app.post("/feedback", response_model=FeedbackItemResponse, tags=["Configuration"], summary="Submit Platform Feedback")
@limiter.limit("10/hour")
def submit_platform_feedback(
    request: Request,
    payload: FeedbackSubmitRequest,
    background_tasks: BackgroundTasks,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    user_agent = (request.headers.get("user-agent") or "")[:255]
    try:
        result = submit_feedback(
            uid=user["uid"],
            email=str(user.get("email") or ""),
            category=payload.category,
            message=payload.message,
            route=payload.route,
            language=payload.language,
            user_agent=user_agent,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid feedback") from exc
    # Acknowledge receipt, deduped by the feedback item id (one ack per submission).
    recipient = str(user.get("email") or "")
    stored = result.pop("stored", False) if isinstance(result, dict) else False
    item_id = result.get("id") if isinstance(result, dict) else None
    if recipient and item_id and stored:
        background_tasks.add_task(
            dispatch_email,
            "feedback_ack",
            user["uid"],
            dedupe_key=str(item_id),
            to_email=recipient,
            to_name=str(user.get("display_name") or ""),
        )
    return result


@app.get(
    "/admin/feedback",
    response_model=FeedbackListResponse,
    tags=["Configuration"],
    summary="List Feedback For Admin",
)
@limiter.limit("30/minute")
def admin_list_feedback(
    request: Request,
    status: str | None = None,
    _admin: Dict[str, Any] = Depends(verify_admin_session),
):
    del request
    if status not in (None, "new", "handled"):
        raise HTTPException(status_code=400, detail="Invalid status filter")
    items = list_feedback_items(status=status)
    return {"items": items, "total": len(items)}


@app.patch(
    "/admin/feedback/{item_id}",
    response_model=FeedbackItemResponse,
    tags=["Configuration"],
    summary="Update Feedback Status For Admin",
)
@limiter.limit("30/minute")
def admin_update_feedback_status(
    request: Request,
    item_id: str,
    payload: FeedbackStatusUpdateRequest,
    admin: Dict[str, Any] = Depends(verify_admin_session),
    _csrf: None = Depends(verify_admin_csrf),
):
    del request
    try:
        return update_feedback_item_status(
            item_id,
            status=payload.status,
            admin_uid=admin["uid"],
            admin_email=admin["email"],
        )
    except ValueError as exc:
        if str(exc) == "FEEDBACK_NOT_FOUND":
            raise HTTPException(status_code=404, detail="Feedback item not found") from exc
        raise


# Maps a service-layer rejection to the status + message the admin UI shows.
CREDIT_ORDER_ERRORS = {
    "ORDER_NOT_FOUND": (404, "Order not found"),
    "ORDER_NOT_PENDING": (409, "This order has already been resolved"),
    "CODE_REQUIRED": (400, "A redeem code is required"),
    "CODE_NOT_FOUND": (400, "That code does not exist. Generate it in Codes first."),
    "CODE_INACTIVE": (400, "That code has been disabled"),
    "CODE_EXPIRED": (400, "That code has expired"),
    "CODE_EXHAUSTED": (400, "That code has already been claimed"),
    "CODE_CREDITS_MISMATCH": (409, "That code is worth a different number of credits than this order"),
}


def _raise_credit_order_error(exc: ValueError) -> None:
    status_code, detail = CREDIT_ORDER_ERRORS.get(str(exc), (400, "Could not update this order"))
    raise HTTPException(status_code=status_code, detail=detail) from exc


@app.get(
    "/admin/orders",
    response_model=AdminCreditOrderListResponse,
    tags=["Configuration"],
    summary="List Credit Orders For Admin",
)
@limiter.limit("30/minute")
def admin_list_credit_orders(
    request: Request,
    status: str | None = None,
    _admin: Dict[str, Any] = Depends(verify_admin_session),
):
    del request
    if status not in (None, "pending", "accepted", "refused"):
        raise HTTPException(status_code=400, detail="Invalid status filter")
    orders = list_admin_credit_orders(status=status)
    return {"orders": orders, "total": len(orders)}


@app.get(
    "/admin/orders/{order_id}/proof/{file_id}",
    tags=["Configuration"],
    summary="Get Credit Order Proof For Admin",
)
@limiter.limit("60/minute")
def admin_get_credit_order_proof(
    request: Request,
    order_id: str,
    file_id: str,
    _admin: Dict[str, Any] = Depends(verify_admin_session),
):
    # /files/{id} is owner-scoped, so an admin cannot read a user's proof through
    # it. This route is the admin-side equivalent, and it only serves a file that
    # is actually attached to the order named in the path.
    del request
    if get_credit_order_proof_file_id(order_id, file_id) is None:
        raise HTTPException(status_code=404, detail="Proof not found")
    file_record, filepath = load_payment_proof_file(file_id)
    storage_path = str(file_record["storage_path"])
    mime_type = str(file_record.get("mime_type") or "image/jpeg")

    if filepath.exists():
        try:
            from app.services.r2_storage import upload_to_r2
            upload_to_r2(filepath.read_bytes(), f"payment_proofs/{storage_path}", mime_type)
        except Exception:
            pass
        return FileResponse(
            filepath,
            media_type=mime_type,
            headers={
                "Cache-Control": "private, max-age=3600",
                "Content-Disposition": "inline",
                **GENERATED_IMAGE_SAFE_HEADERS,
            },
        )

    r2_public_base = os.getenv("R2_PUBLIC_URL", "https://pub-64bf9ef2292c49f0a2053981c85e16d9.r2.dev").rstrip("/")
    return RedirectResponse(url=f"{r2_public_base}/payment_proofs/{storage_path}", status_code=307)


@app.post(
    "/admin/orders/{order_id}/accept",
    response_model=AdminCreditOrderResponse,
    tags=["Configuration"],
    summary="Accept Credit Order For Admin",
)
@limiter.limit("30/minute")
def admin_accept_credit_order(
    request: Request,
    order_id: str,
    payload: AdminCreditOrderAcceptRequest,
    background_tasks: BackgroundTasks,
    admin: Dict[str, Any] = Depends(verify_admin_session),
    _csrf: None = Depends(verify_admin_csrf),
):
    del request
    try:
        result = accept_credit_order(
            order_id,
            code=payload.code,
            admin_uid=admin["uid"],
            admin_email=admin["email"],
            confirm_mismatch=payload.confirmMismatch,
        )
    except ValueError as exc:
        _raise_credit_order_error(exc)
    # Repaint the Discord card so it stops offering buttons for an order that is
    # already done. A no-op when the order was never announced there.
    background_tasks.add_task(discord_orders.sync_credit_order_card, order_id)
    return result


@app.post(
    "/admin/orders/{order_id}/refuse",
    response_model=AdminCreditOrderResponse,
    tags=["Configuration"],
    summary="Refuse Credit Order For Admin",
)
@limiter.limit("30/minute")
def admin_refuse_credit_order(
    request: Request,
    order_id: str,
    payload: AdminCreditOrderRefuseRequest,
    background_tasks: BackgroundTasks,
    admin: Dict[str, Any] = Depends(verify_admin_session),
    _csrf: None = Depends(verify_admin_csrf),
):
    del request
    try:
        result = refuse_credit_order(
            order_id,
            reason=payload.reason,
            admin_uid=admin["uid"],
            admin_email=admin["email"],
        )
    except ValueError as exc:
        _raise_credit_order_error(exc)
    background_tasks.add_task(discord_orders.sync_credit_order_card, order_id)
    return result


@app.post(
    "/discord/interactions",
    tags=["Configuration"],
    summary="Handle A Discord Interaction",
    include_in_schema=False,
)
@limiter.limit("240/minute")
async def handle_discord_interaction(request: Request):
    """Discord's webhook for button presses on order cards.

    Unauthenticated by design: the Ed25519 signature over the raw body IS the
    authentication, and Discord cannot send a session cookie or a CSRF token.
    Authorization (which channel, which Discord account) is enforced in
    ``discord_orders.handle_interaction``, on top of this.

    The body is read as raw bytes rather than through a Pydantic model because
    the signature covers the exact bytes Discord sent — re-serializing a parsed
    dict changes them and every verification would fail.
    """
    body = await request.body()
    signature = request.headers.get("x-signature-ed25519", "")
    timestamp = request.headers.get("x-signature-timestamp", "")

    if not discord_orders.verify_interaction_signature(signature, timestamp, body):
        # Must be 401: Discord probes a newly-registered interactions URL with
        # deliberately invalid signatures and refuses to save it unless they are
        # rejected. Logged because the alternative — a silent 401 — is
        # indistinguishable from "Discord never called us" when a button press
        # fails, and the two have completely different fixes.
        logger.warning(
            "[discord] interaction signature REJECTED (bad DISCORD_PUBLIC_KEY, or a probe): "
            "sig_present=%s ts_present=%s public_key_configured=%s",
            bool(signature),
            bool(timestamp),
            bool(settings.discord_public_key),
        )
        raise HTTPException(status_code=401, detail="invalid request signature")

    try:
        payload = json.loads(body or b"{}")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="malformed interaction payload") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="malformed interaction payload")

    return discord_orders.handle_interaction(payload)


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
    return _generate_content_impl(request, payload, user)


def _generate_content_impl(request: Request, payload: GenerateRequest, user: Dict[str, Any], price_override: float | None = None, platform_fee: float | None = None) -> GenerationResult:
    """Core generation flow shared by the public /generate route and Packs.

    Carries no @limiter decorator so internal callers (e.g. Packs) do not re-trip
    the public 5/min route limit; the quick-mode per-user/IP limits inside still
    apply. Expects payload.mode == "quick" / status == "generating" for the
    deterministic direct-generation path.
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
                if str(exc) == "PAYMENT_HOLD":
                    raise HTTPException(status_code=402, detail=PAYMENT_HOLD_MESSAGE) from exc
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
            if platform_fee is not None:
                expected_total = round(float(expected_required["total"]) + float(platform_fee), 6)
            elif price_override is not None:
                expected_total = price_override
            else:
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
                if str(exc) == "PAYMENT_HOLD":
                    raise HTTPException(status_code=402, detail=PAYMENT_HOLD_MESSAGE) from exc
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
            if platform_fee is not None:
                charged_cost = round(charged_cost + float(platform_fee), 6)
            elif price_override is not None:
                charged_cost = round(float(price_override), 6)

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
            if failure_reason == "content_blocked":
                raise HTTPException(status_code=403, detail={"error": {"code": "CONTENT_BLOCKED"}})
            if failure_reason == "moderation_unavailable":
                # Defensive fail-closed block (moderation backend unreachable), not a
                # user violation: credits already released above, no ban, transient error.
                raise HTTPException(status_code=503, detail={"error": {"code": "MODERATION_UNAVAILABLE"}})

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
        if str(exc) == "PAYMENT_HOLD":
            raise HTTPException(status_code=402, detail=PAYMENT_HOLD_MESSAGE) from exc
        if str(exc) == "INSUFFICIENT_CREDITS":
            raise HTTPException(status_code=402, detail="Insufficient credits") from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except ApiKeyManagerProxyError as exc:
        if exc.error_type == "content_blocked":
            from app.services.security_backend import record_moderation_rejection
            ban = record_moderation_rejection(
                user["uid"],
                f"generate:{getattr(payload.mode, 'value', payload.mode)}",
                exc.code,
                moderation=getattr(exc, "moderation", None),
            )
            if direct_generation and generation_job_id:
                release_generation_credits(generation_job_id, failure_reason="content_blocked")
            elif not direct_generation and analyze_session:
                refund_analyze_session(analyze_session["id"], user["uid"])
            if isinstance(ban, dict) and ban.get("banned") and not ban.get("alreadySuspended"):
                # This block crossed the threshold and just suspended the account →
                # return the suspension response so the client ejects to sign-in
                # immediately instead of showing the per-block warning.
                raise HTTPException(
                    status_code=403,
                    detail=format_suspension_detail(ban.get("reason"), ban.get("until")),
                )
            raise HTTPException(status_code=403, detail={"error": {"code": "CONTENT_BLOCKED"}})
        if exc.error_type == "moderation_unavailable":
            # Defensive fail-closed block (no moderation backend reachable), NOT a user
            # violation: release reserved credits, record NO rejection (no ban), and
            # return a transient "try again" error distinct from a content block.
            if direct_generation and generation_job_id:
                release_generation_credits(generation_job_id, failure_reason="moderation_unavailable")
            elif not direct_generation and analyze_session:
                refund_analyze_session(analyze_session["id"], user["uid"])
            raise HTTPException(status_code=503, detail={"error": {"code": "MODERATION_UNAVAILABLE"}})

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
    if error_code == "PAYMENT_HOLD":
        return PAYMENT_HOLD_MESSAGE
    if error_code == "CHAT_MODEL_REQUIRED":
        return "A chat model is required."
    if error_code == "CHAT_MODEL_NOT_FOUND":
        return "This model is no longer available - it may have been turned off. Please pick another model and try again."
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
    # Visible catalog: an admin-disabled model must not be selectable or usable,
    # including by a client that posts its id directly (bypassing the UI list).
    valid_models = visible_model_catalog().get(task, {})
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

    valid_models = visible_model_catalog().get(task, {})
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


# Shared image downscaler (smart create /generate, plain chat, and packs all use
# the SAME logic) - shrinks oversized uploads so the base64 body fits the AKM
# gateway's 1 MiB Fastify bodyLimit. See app/services/image_downscale.py.
from app.services.image_downscale import (  # noqa: E402
    PROVIDER_IMAGE_MAX_DIM as _PROVIDER_IMAGE_MAX_DIM,
    PROVIDER_TOTAL_IMAGE_BUDGET as _PROVIDER_TOTAL_IMAGE_BUDGET,
    downscale_image_for_provider as _downscale_image_for_provider,
    per_image_output_cap as _per_image_output_cap,
)


def _prepare_input_images(input_images, owner_uid: str, *, max_dim: int = _PROVIDER_IMAGE_MAX_DIM) -> list[Dict[str, str]]:
    items = list(input_images or [])
    output_cap = _per_image_output_cap(len(items))
    prepared: list[Dict[str, str]] = []
    for input_image in items:
        prepared_image = _prepare_input_image(input_image, owner_uid, max_dim=max_dim, output_cap=output_cap)
        if prepared_image:
            prepared.append(prepared_image)
    return prepared


def _prepare_input_image(
    input_image,
    owner_uid: str,
    *,
    max_dim: int = _PROVIDER_IMAGE_MAX_DIM,
    output_cap: int = _PROVIDER_TOTAL_IMAGE_BUDGET,
) -> Dict[str, str] | None:
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
        mime_type = str(file_record["mime_type"] or input_image.mime_type or "")
        image_bytes, mime_type = _downscale_image_for_provider(image_bytes, mime_type, max_dim=max_dim, output_cap=output_cap)
        return {
            "mime_type": mime_type,
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


def _cleanup_expired_payment_proofs() -> None:
    """Drop receipts whose order was resolved longer ago than the retention window.

    Keyed on the ORDER's `resolved_at`, never the file's `created_at`: a pending
    order is a live review item however old its upload is, and a reviewer must
    always be able to see what they are approving.

    Only the bytes and the `user_files` row go — deleting that row also drops the
    `credit_order_proofs` link through the DB-level cascade. The `credit_orders`
    row itself (plan, price, who approved it, which code) is the financial record
    and is never touched here, which is why `CreditOrderProof` still keeps proofs
    out of the 30-day upload reaper.
    """
    retention_days = int(settings.payment_proof_retention_days)
    if retention_days <= 0:
        # 0 restores the original keep-forever behaviour, for a business that
        # wants every receipt on file.
        return

    cutoff = int(time.time()) - (retention_days * 24 * 60 * 60)
    removed = 0
    with session_scope() as session:
        repo = SecurityRepository(session)
        for entry in repo.list_payment_proofs_for_orders_resolved_before(resolved_before=cutoff):
            filepath = PAYMENT_PROOFS_DIR / str(entry.storage_path)
            try:
                filepath.unlink(missing_ok=True)
            except OSError:
                # A file we cannot unlink still loses its row: keeping the row
                # would mean retrying this forever, and the row is the only thing
                # that makes those bytes reachable through the proof routes.
                logger.warning("[proofs] could not unlink expired payment proof %s", filepath)
            repo.delete_user_file(entry)
            removed += 1

    if removed:
        logger.info(
            "[proofs] swept %s payment proof(s) for orders resolved before %s (retention=%sd)",
            removed,
            cutoff,
            retention_days,
        )


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
    if mime_type == "application/pdf":
        return "pdf"
    return "jpg"


def _inspect_payment_proof_bytes(file_bytes: bytes) -> str:
    """Return the real content type of a proof, or 400.

    Same declared-vs-detected principle as image uploads: the browser's
    Content-Type is a hint, the magic bytes decide. Dimensions are irrelevant
    here — nobody feeds a receipt to a model — so only the type is checked.
    """
    if file_bytes.startswith(b"%PDF-"):
        return "application/pdf"
    if file_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if file_bytes.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if file_bytes.startswith(b"RIFF") and file_bytes[8:12] == b"WEBP":
        return "image/webp"
    raise HTTPException(status_code=400, detail="Proof must be a PNG, JPEG, WEBP, or PDF file")


def _save_payment_proof_bytes(mime_type: str, file_bytes: bytes) -> str:
    extension = _extension_for_mime_type(mime_type)
    filename = f"{os.urandom(16).hex()}.{extension}"
    save_path = PAYMENT_PROOFS_DIR / filename
    with open(save_path, "wb") as proof_file:
        proof_file.write(file_bytes)
    try:
        from app.services.r2_storage import upload_to_r2
        upload_to_r2(file_bytes, f"payment_proofs/{filename}", mime_type)
    except Exception as exc:
        logger.warning("[R2] Failed to upload payment proof %s to R2: %s", filename, exc)
    return filename


# ===========================================================================
# Template / Use-Case Packs
#
# Packs are a deterministic way to drive the existing generation pipeline:
# list/get read the in-code catalog; estimate is a pure pricing read; generate
# renders the pack template and runs N single-image generations through the
# shared core (app.packs.core -> _generate_content_impl), inheriting moderation,
# the image-input guardrail, and server-side credit charging.
# ===========================================================================

def _require_available_pack(pack_id: str):
    pack = packs_catalog.get_pack(pack_id)
    if pack is None or not pack.enabled or not packs_service.pack_available(pack):
        raise HTTPException(status_code=404, detail="Pack not found")
    return pack


@app.get("/packs", tags=["Packs"], summary="List Packs")
@limiter.limit("60/minute")
def list_packs_endpoint(
    request: Request,
    sector: str | None = None,
    lang: str = "ar",
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    """Enabled packs (optionally filtered by sector), localized, with any pack
    whose capability has no live model auto-hidden."""
    packs = [
        packs_service.card_view(pack, lang)
        for pack in packs_catalog.list_packs(sector)
        if packs_service.pack_available(pack)
    ]
    return {"sector": sector, "lang": lang, "packs": packs}


@app.get("/packs/{pack_id}", tags=["Packs"], summary="Get Pack")
@limiter.limit("60/minute")
def get_pack_endpoint(
    request: Request,
    pack_id: str,
    lang: str = "ar",
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    pack = _require_available_pack(pack_id)
    return packs_service.detail_view(pack, lang)


@app.post("/packs/{pack_id}/estimate", tags=["Packs"], summary="Estimate Pack Cost")
@limiter.limit("60/minute")
def estimate_pack_endpoint(
    request: Request,
    pack_id: str,
    payload: PackEstimateRequest,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    pack = _require_available_pack(pack_id)
    try:
        est = packs_service.estimate_pack(pack, payload.n, payload.aspect_ratio, has_image=bool(payload.has_image), model=payload.model, quality=payload.quality)
    except packs_service.PackError as exc:
        raise HTTPException(status_code=422, detail=packs_service.pack_error_detail(exc)) from exc
    if not est.get("available"):
        raise HTTPException(status_code=409, detail={"error": {"code": "CAPABILITY_UNAVAILABLE"}})
    return est


@app.post("/packs/{pack_id}/plan", tags=["Packs"], summary="Plan A Pack Generation")
@limiter.limit("30/minute")
def plan_pack_endpoint(
    request: Request,
    pack_id: str,
    payload: PackPlanRequest,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    """Free planning step: the agent turns the user's free text + 0..N images into
    a ready-to-run plan (model + ratio + quality + prompt), or asks ONE clarifying
    question. No credits are reserved or charged. The real moderation gate still
    runs at /generate; here clearly-abusive requests get a brief decline."""
    pack = _require_available_pack(pack_id)
    uid = str(user["uid"])
    # The agent is free to the user but makes real (billed) provider calls, so it is
    # metered per user like the paid /generate path. The per-IP limit alone does not
    # bound one account fanning out across addresses.
    if not consume_rate_limit(
        f"packs:plan:user:{uid}",
        max_count=settings.packs_plan_user_limit,
        window_seconds=settings.packs_plan_window_seconds,
    ):
        raise HTTPException(
            status_code=429,
            detail=(
                f"You reached the limit of {settings.packs_plan_user_limit} planning requests per "
                f"{_format_wait_window(settings.packs_plan_window_seconds)}. Please try again later."
            ),
        )
    if len(payload.image_refs or []) > MAX_INPUT_IMAGES:
        raise HTTPException(status_code=400, detail=f"At most {MAX_INPUT_IMAGES} input images are allowed")
    # Prepare uploads to inline base64 so the vision agent can actually SEE them
    # (private /api/files URLs are not fetchable by the provider). Keep the file
    # name + order so the agent can map "image 1 / image 2" to a role.
    plan_imgs = (payload.image_refs or [])[:MAX_INPUT_IMAGES]
    plan_cap = _per_image_output_cap(len(plan_imgs))
    image_refs: list[Dict[str, Any]] = []
    try:
        for img in plan_imgs:
            prepared = _prepare_input_image(img, str(user["uid"]), max_dim=1024, output_cap=plan_cap)
            if prepared:
                image_refs.append({**prepared, "name": img.name or ""})
        result = packs_service.plan_pack(
            pack,
            user_text=payload.text or "",
            image_refs=image_refs,
            lang=payload.lang,
            variant_id=payload.variant_id,
            round_no=payload.round,
            mockup_first=payload.mockup_first,
            history=[t.model_dump() for t in (payload.history or [])],
            use_fake=settings.packs_test_fake_provider,
            uid=str(user["uid"]),
        )
    except HTTPException:
        raise
    except packs_service.PackError as exc:
        raise HTTPException(status_code=422, detail=packs_service.pack_error_detail(exc)) from exc

    ban = result.pop("moderation_ban", None)
    if isinstance(ban, dict) and ban.get("banned") and not ban.get("alreadySuspended"):
        raise HTTPException(
            status_code=403,
            detail=format_suspension_detail(ban.get("reason"), ban.get("until")),
        )
    return result


@app.post("/packs/{pack_id}/generate", tags=["Packs"], summary="Generate From Pack")
@limiter.limit("15/minute")
def generate_pack_endpoint(
    request: Request,
    pack_id: str,
    payload: PackGenerateRequest,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    pack = _require_available_pack(pack_id)
    image_refs = [img.model_dump() for img in (payload.image_refs or [])]
    try:
        return packs_service.generate_pack(
            pack,
            payload.slot_values,
            payload.n,
            payload.aspect_ratio,
            image_refs,
            user,
            request,
            model=payload.model,
            quality=payload.quality,
            prompt_override=payload.prompt_override,
            use_fake=settings.packs_test_fake_provider,
        )
    except packs_service.PackError as exc:
        raise HTTPException(status_code=422, detail=packs_service.pack_error_detail(exc)) from exc


# ----------------------- Pack sessions (saved studios) -----------------------
# A pack session is a named, reopenable gallery of generations + the agent memory,
# stored per user. Mirrors the plain-chat conversation list/rename/reopen UX.

def _enforce_pack_session_request_size(request: Request) -> None:
    """A session autosaves its gallery + agent memory as free-form JSON, so cap the
    body: without this an authenticated user can push arbitrary blobs into Postgres
    (nginx allows 25 MB, while real sessions are ~3-11 KB)."""
    content_length = request.headers.get("content-length")
    if not content_length:
        return
    try:
        request_bytes = int(content_length)
    except (TypeError, ValueError):
        return
    if request_bytes > int(settings.pack_session_max_request_bytes):
        raise HTTPException(status_code=413, detail="Session data is too large.")


@app.post("/pack-sessions", tags=["Packs"], summary="Create Pack Session")
@limiter.limit("60/minute")
def create_pack_session_endpoint(
    request: Request,
    payload: PackSessionCreate,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    _enforce_pack_session_request_size(request)
    uid = str(user["uid"])
    if count_pack_sessions(uid) >= settings.pack_sessions_per_user_limit:
        raise HTTPException(
            status_code=409,
            detail=(
                f"You have reached the maximum of {settings.pack_sessions_per_user_limit} saved "
                "sessions. Delete one and try again."
            ),
        )
    title = (payload.title or "New session").strip()[:120] or "New session"
    return create_pack_session(uid, payload.pack_id, payload.variant_id, title, payload.data or {})


@app.get("/pack-sessions", tags=["Packs"], summary="List Pack Sessions")
@limiter.limit("120/minute")
def list_pack_sessions_endpoint(
    request: Request,
    pack_id: str | None = None,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    return {"sessions": list_pack_sessions(str(user["uid"]), pack_id)}


@app.get("/pack-sessions/{session_id}", tags=["Packs"], summary="Get Pack Session")
@limiter.limit("120/minute")
def get_pack_session_endpoint(
    request: Request,
    session_id: str,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    entry = get_pack_session(str(user["uid"]), session_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return entry


@app.patch("/pack-sessions/{session_id}", tags=["Packs"], summary="Update Pack Session")
@limiter.limit("120/minute")
def update_pack_session_endpoint(
    request: Request,
    session_id: str,
    payload: PackSessionUpdate,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    _enforce_pack_session_request_size(request)
    title = payload.title.strip()[:120] if payload.title is not None else None
    entry = update_pack_session(str(user["uid"]), session_id, title=title, data=payload.data)
    if entry is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return entry


@app.delete("/pack-sessions/{session_id}", tags=["Packs"], summary="Delete Pack Session")
@limiter.limit("60/minute")
def delete_pack_session_endpoint(
    request: Request,
    session_id: str,
    user: Dict[str, Any] = Depends(verify_firebase_user),
):
    if not delete_pack_session(str(user["uid"]), session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"deleted": True}
