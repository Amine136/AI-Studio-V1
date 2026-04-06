from typing import Any, Dict

from fastapi import Depends, HTTPException, Security
from fastapi.security import APIKeyHeader
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token

from app.config import settings
from app.services.security_store import ensure_user

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
    profile = ensure_user(uid, email, display_name)

    return {
        "uid": uid,
        "email": email,
        "display_name": display_name,
        "is_admin": bool(email and email.lower() in settings.admin_emails),
        "claims": claims,
        "profile": profile,
    }


async def verify_admin_user(user: Dict[str, Any] = Depends(verify_firebase_user)) -> Dict[str, Any]:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
