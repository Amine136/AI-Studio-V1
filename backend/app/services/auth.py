from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import HTTPException, Request, Response, Security
from fastapi.security import APIKeyHeader
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token

from app.config import settings
from app.services.admin_auth import get_admin_session
from app.services.security_backend import ensure_user, get_active_suspension, is_email_deactivated

# Header name the client must send
API_KEY_HEADER = APIKeyHeader(name="X-API-Key", auto_error=False)
BEARER_AUTH = HTTPBearer(auto_error=False)
GOOGLE_REQUEST = GoogleRequest()


def format_suspension_detail(reason: str | None, until: Any | None) -> str:
    """Build the user-facing suspension message used in 403 responses.

    Shared so every place that signals a suspension (the auth dependency and the
    moderation auto-ban path) produces the exact same string the frontend keys on
    to eject the user to the sign-in page.
    """
    detail = "Your account is suspended."
    reason_text = str(reason or "").strip()
    if reason_text:
        detail = f"Your account is suspended: {reason_text}"
    if until:
        until_text = datetime.fromtimestamp(int(until), tz=timezone.utc).isoformat()
        detail = f"{detail} Suspension ends at {until_text}."
    return detail


async def verify_api_key(api_key: str = Security(API_KEY_HEADER)):
    """FastAPI dependency: validates the X-API-Key header."""
    if not settings.api_key:
        # No key configured = auth disabled (dev mode)
        return
    
    if not api_key or api_key != settings.api_key:
        raise HTTPException(status_code=403, detail="Invalid or missing API key")


async def verify_firebase_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Security(BEARER_AUTH),
) -> Dict[str, Any]:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = credentials.credentials
    try:
        claims = id_token.verify_firebase_token(
            token,
            GOOGLE_REQUEST,
            audience=settings.firebase_project_id,
        )
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid Firebase token") from exc

    if not claims:
        raise HTTPException(status_code=401, detail="Invalid Firebase token")

    uid = claims.get("uid") or claims.get("user_id") or claims.get("sub")
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid Firebase token payload")

    email = claims.get("email", "")
    display_name = claims.get("name") or email or uid
    if settings.app_env == "staging" and settings.authorized_user_emails:
        normalized_email = str(email or "").strip().lower()
        if normalized_email not in settings.authorized_user_emails:
            raise HTTPException(status_code=403, detail="This staging environment is restricted to authorized accounts only.")
    deactivated_email = is_email_deactivated(email)
    if deactivated_email:
        detail = "This email address belongs to a deactivated account and cannot be used again."
        reason = str((deactivated_email or {}).get("reason") or "").strip()
        if reason:
            detail = reason
        raise HTTPException(status_code=403, detail=detail)
    profile = ensure_user(uid, email, display_name)
    # Pop the transient one-shot marker so it never leaks into API responses.
    (profile or {}).pop("_isNewlyCreated", None)
    if bool((profile or {}).get("isDeactivated")):
        detail = "This account has been deactivated. You no longer have access to this account or its data."
        reason = str((profile or {}).get("deactivationReason") or "").strip()
        if reason:
            detail = reason
        raise HTTPException(status_code=403, detail=detail)
    suspension = get_active_suspension(uid)
    if suspension:
        reason = str(suspension.get("reason") or profile.get("suspensionReason") or "").strip()
        raise HTTPException(
            status_code=403,
            detail=format_suspension_detail(reason, suspension.get("until")),
        )

    # Fire a server-side CompleteRegistration exactly once per user, deduped with
    # the browser Pixel via reg_<uid>. We CLAIM it atomically on the users row
    # (capi_registration_sent_at) instead of trusting who won the row-creation
    # race: many endpoints call ensure_user, so the auth path is not guaranteed
    # to be the creator. Runs only after the user cleared every gate above.
    # Fully fail-safe — never blocks or breaks auth on a tracking error.
    try:
        from app.services.postgres_security_store import claim_capi_registration
        from app.services.meta_capi import send_complete_registration

        # claim_capi_registration wins exactly once per user (first-ever sign-in),
        # so it doubles as the trigger for the one-time welcome email. Each side is
        # wrapped independently so one failing never blocks the other.
        if claim_capi_registration(uid):
            try:
                send_complete_registration(request=request, uid=uid, email=email)
            except Exception:
                pass
            try:
                from app.services.email_service import dispatch as _dispatch_email

                _dispatch_email(
                    "welcome", uid, dedupe_key="welcome", to_email=email, to_name=display_name
                )
            except Exception:
                pass
    except Exception:
        pass

    return {
        "uid": uid,
        "email": email,
        "display_name": display_name,
        "is_admin": False,
        "claims": claims,
        "profile": profile,
    }


async def verify_admin_session(request: Request, response: Response) -> Dict[str, Any]:
    cookie_name = settings.admin_session_cookie_name
    token = request.cookies.get(cookie_name, "").strip()
    if not token:
        auth_header = request.headers.get("Authorization", "").strip()
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Admin authentication required")

    try:
        session = get_admin_session(token)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired admin session")

    response.set_cookie(
        key=cookie_name,
        value=token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=settings.admin_session_ttl_seconds,
        path="/",
    )

    return {
        "uid": None,
        "email": session["username"],
        "username": session["username"],
        "session_id": session["sessionId"],
        "admin_id": session["adminId"],
        "session": session,
        "is_admin": True,
    }


async def verify_admin_csrf(request: Request) -> None:
    expected = request.cookies.get(settings.admin_csrf_cookie_name, "").strip()
    provided = request.headers.get("X-CSRF-Token", "").strip()
    if not expected or not provided or expected != provided:
        raise HTTPException(status_code=403, detail="Invalid admin CSRF token")


async def verify_admin_user(request: Request) -> Dict[str, Any]:
    response = Response()
    return await verify_admin_session(request, response)
