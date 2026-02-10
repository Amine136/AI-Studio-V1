import os
import re
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.core.schema import GenerateRequest, GenerationResult, SystemConfig
from app.graph.workflow import studio_graph_app
from app.services.auth import verify_api_key

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
    title="AI Studio V1",
    version="1.0.0",
    description="""
## AI Studio Backend API

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
        "name": "AI Studio Support",
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
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Key"],
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
    description="Retrieve the available field options and model catalog for the AI Studio."
)
@limiter.limit("30/minute")
def get_system_config(request: Request, _=Depends(verify_api_key)):
    """
    Fetch the current system configuration including:
    - **field_options**: Available options for platforms, styles, lighting, etc.
    - **model_catalog**: Available AI models for generation tasks
    """
    return SystemConfig(
        field_options=settings.field_options,
        model_catalog=settings.model_catalog
    )


@app.post(
    "/generate",
    response_model=GenerationResult,
    tags=["Generation"],
    summary="Generate AI Content",
    description="Submit a content generation request to create images, captions, or both."
)
@limiter.limit("10/minute")
def generate_content(request: Request, payload: GenerateRequest, _=Depends(verify_api_key)):
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
    try:
        initial_state = {
            "user_text": payload.user_text,
            "requested_outputs": payload.requested_outputs,
            "user_preferences": payload.user_preferences or {},
            "status": payload.status or "processing"
        }
        if payload.user_corrections:
            initial_state["user_corrections"] = payload.user_corrections

        final_state = studio_graph_app.invoke(initial_state)

        if final_state.get("status") == "awaiting_review":
            return GenerationResult(
                status="awaiting_review",
                ui_schema=final_state.get("ui_schema")
            )
        elif final_state.get("status") == "complete":
            final_payload = final_state.get("final_response", {})
            return GenerationResult(
                status="success",
                results=final_payload.get("results"),
                meta=final_payload.get("meta")
            )
        else:
            return GenerationResult(
                status="error",
                meta={"error_message": f"Workflow ended with unexpected status: {final_state.get('status')}"}
            )

    except Exception as e:
        print(f"Server Error: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal error occurred. Please try again later.")