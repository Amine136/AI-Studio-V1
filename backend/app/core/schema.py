from typing import List, Dict, Any, Optional, Literal
from pydantic import BaseModel, Field

# ---------------------------------------------------------
# Frontend <-> Backend Types
# ---------------------------------------------------------

OutputType = Literal["image", "caption"]

class GenerateRequest(BaseModel):
    """Request payload for content generation."""
    user_text: str = Field(
        ...,
        description="The main text prompt describing what content to generate",
        json_schema_extra={"example": "A cozy coffee shop with warm lighting for Instagram"}
    )
    requested_outputs: List[OutputType] = Field(
        default=["image", "caption"],
        description="Types of content to generate. Can include 'image', 'caption', or both"
    )
    user_preferences: Optional[Dict[str, str]] = Field(
        default={},
        description="User-specified preferences like platform, style, lighting, etc.",
        json_schema_extra={"example": {"platform": "Instagram", "lighting": "Golden Hour"}}
    )
    user_corrections: Optional[Dict[str, Any]] = Field(
        default={},
        description="Corrections or overrides for AI-suggested values during review"
    )
    status: Optional[str] = Field(
        default="processing",
        description="Current processing status. Typically 'processing' for new requests"
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "user_text": "A sleek tech product on a minimalist desk",
                    "requested_outputs": ["image", "caption"],
                    "user_preferences": {"platform": "LinkedIn", "brand_voice": "Professional"}
                }
            ]
        }
    }

class GenerationResult(BaseModel):
    """Response payload from content generation."""
    status: str = Field(
        ...,
        description="Result status: 'success', 'awaiting_review', or 'error'"
    )
    ui_schema: Optional[Dict[str, Any]] = Field(
        default=None,
        description="UI schema for review form when status is 'awaiting_review'"
    )
    results: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Generated content including images and captions when status is 'success'"
    )
    meta: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Additional metadata about the generation process"
    )

class SystemConfig(BaseModel):
    """System configuration with available options and models."""
    field_options: Dict[str, Any] = Field(
        ...,
        description="Available options for form fields (platforms, styles, lighting, etc.)"
    )
    model_catalog: Dict[str, Any] = Field(
        ...,
        description="Catalog of available AI models and their capabilities"
    )


# ---------------------------------------------------------
# State Management (Internal Graph State)
# ---------------------------------------------------------

ContentSpec = Dict[str, Any]

class StudioState(BaseModel):
    user_text: str = ""
    requested_outputs: List[OutputType] = []
    status: str = "processing"
    
    # Context
    user_preferences: Dict[str, str] = {}
    user_corrections: Dict[str, Any] = {}
    extracted_intent: Dict[str, Any] = {}
    
    # Execution
    assigned_models: Dict[str, str] = {}
    content_spec: ContentSpec = {}
    model_requests: List[Dict[str, Any]] = []
    generated_assets: Dict[str, Any] = {}
    
    # Output
    final_response: Dict[str, Any] = {}
    ui_schema: Dict[str, Any] = {}

# ---------------------------------------------------------
# Intent Analysis Models (Strict JSON Enforcement)
# ---------------------------------------------------------

class ObligatorySettings(BaseModel):
    # Fix: Removed 'default=None' inside Field() to satisfy Google API
    platform: str = Field(description="The social media platform (e.g., 'Instagram', 'LinkedIn')")
    brand_voice: Optional[str] = Field(description="The tone of voice (e.g., 'Professional')")
    goal: Optional[str] = Field(description="The marketing goal")

class AISuggestions(BaseModel):
    # Fix: Removed 'default=None', relies on Optional type hint
    lighting: Optional[str] = Field(description="Suggested lighting style")
    medium: Optional[str] = Field(description="Artistic medium (e.g. Photo, 3D)")
    camera_angle: Optional[str] = Field(description="Camera angle")
    color_palette: Optional[str] = Field(description="Dominant color palette")
    art_style: Optional[str] = Field(description="Artistic style")
    composition: Optional[str] = Field(description="Image composition")

class IntentAnalysis(BaseModel):
    obligatory: ObligatorySettings
    ai_suggestion: AISuggestions