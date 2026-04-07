from typing import List, Dict, Any, Optional, Literal
from pydantic import BaseModel, Field

# ---------------------------------------------------------
# Frontend <-> Backend Types
# ---------------------------------------------------------

OutputType = Literal["image", "caption"]


class InputImage(BaseModel):
    """Uploaded image reference used as multimodal input."""
    name: Optional[str] = Field(default=None, description="Original file name")
    mime_type: Optional[str] = Field(
        default=None,
        description="MIME type of the uploaded image",
        json_schema_extra={"example": "image/png"},
    )
    url: Optional[str] = Field(
        default=None,
        description="Public image URL used for provider-side fetch",
        json_schema_extra={"example": "https://vibecraft.ouni.space/images/1234abcd.png"},
    )

class GenerateRequest(BaseModel):
    """Request payload for content generation."""
    user_text: str = Field(
        ...,
        min_length=3,
        max_length=2000,
        description="The main text prompt describing what content to generate (3-2000 characters)",
        json_schema_extra={"example": "A cozy coffee shop with warm lighting for Instagram"}
    )
    requested_outputs: List[OutputType] = Field(
        default=["image", "caption"],
        description="Types of content to generate. Can include 'image', 'caption', or both"
    )
    input_image: Optional[InputImage] = Field(
        default=None,
        description="Optional uploaded image used as multimodal input"
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
                    "input_image": {
                        "name": "reference.png",
                        "mime_type": "image/png",
                        "url": "https://vibecraft.ouni.space/images/1234abcd.png"
                    },
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
    content_prompts: Optional[Dict[str, str]] = Field(
        default=None,
        description="Per-content-type AI-generated prompts, editable by user on review page (e.g. {image_prompt: ..., caption_prompt: ...})"
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


class CatalogUpdateNotification(BaseModel):
    version: str = Field(
        ...,
        min_length=1,
        description="New catalog version announced by ApiKeyManager.",
    )
    updated_at: Optional[str] = Field(
        default=None,
        description="Optional timestamp from ApiKeyManager for the new catalog version.",
    )


# ---------------------------------------------------------
# State Management (Internal Graph State)
# ---------------------------------------------------------

ContentSpec = Dict[str, Any]

class StudioState(BaseModel):
    user_text: str = ""
    requested_outputs: List[OutputType] = []
    status: str = "processing"
    input_image: Optional[InputImage] = None
    
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

class HiddenParams(BaseModel):
    """Internal params extracted by AI — never sent to frontend."""
    image_prompt: str = Field(description="A concise, visual-only prompt optimized for image generation. Describe only what should be SEEN in the image — no prices, no text, no marketing language.")
    caption_prompt: str = Field(description="A concise summary of the user's idea optimized for caption/text generation, including marketing context, pricing, and call-to-action elements.")
    language: str = Field(description="The detected or appropriate language for the content (e.g., 'English', 'French')")

class IntentAnalysis(BaseModel):
    obligatory: ObligatorySettings
    ai_suggestion: AISuggestions
    hidden_params: HiddenParams
