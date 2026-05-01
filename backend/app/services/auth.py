from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import Depends, HTTPException, Request, Response, Security
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


async def verify_api_key(api_key: str = Security(API_KEY_HEADER)):
    """FastAPI dependency: validates the X-API-Key header."""
    if not settings.api_key:
        # No key configured = auth disabled (dev mode)
        return
    
    if not api_key or api_key != settings.api_key:
        raise HTTPException(status_code=403, detail="Invalid or missing API key")


async def verify_firebase_user(
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
    deactivated_email = is_email_deactivated(email)
    if deactivated_email:
        detail = "This email address belongs to a deactivated account and cannot be used again."
        reason = str((deactivated_email or {}).get("reason") or "").strip()
        if reason:
            detail = reason
        raise HTTPException(status_code=403, detail=detail)
    profile = ensure_user(uid, email, display_name)
    if bool((profile or {}).get("isDeactivated")):
        detail = "This account has been deactivated. You no longer have access to this account or its data."
        reason = str((profile or {}).get("deactivationReason") or "").strip()
        if reason:
            detail = reason
        raise HTTPException(status_code=403, detail=detail)
    suspension = get_active_suspension(uid)
    if suspension:
        detail = "Your account is suspended."
        reason = str(suspension.get("reason") or profile.get("suspensionReason") or "").strip()
        until = suspension.get("until")
        if reason:
            detail = f"Your account is suspended: {reason}"
        if until:
            until_text = datetime.fromtimestamp(int(until), tz=timezone.utc).isoformat()
            detail = f"{detail} Suspension ends at {until_text}."
        raise HTTPException(status_code=403, detail=detail)

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
        secure=settings.admin_cookie_secure,
        samesite="lax",
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
