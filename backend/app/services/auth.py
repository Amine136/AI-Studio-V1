from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader
from app.config import settings

# Header name the client must send
API_KEY_HEADER = APIKeyHeader(name="X-API-Key", auto_error=False)


async def verify_api_key(api_key: str = Security(API_KEY_HEADER)):
    """FastAPI dependency: validates the X-API-Key header."""
    if not settings.api_key:
        # No key configured = auth disabled (dev mode)
        return
    
    if not api_key or api_key != settings.api_key:
        raise HTTPException(status_code=403, detail="Invalid or missing API key")
