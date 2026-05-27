import re
from typing import List, Dict, Any, Optional, Literal
from pydantic import BaseModel, Field, field_validator

# ---------------------------------------------------------
# Frontend <-> Backend Types
# ---------------------------------------------------------

OutputType = Literal["image", "caption"]
GenerationMode = Literal["quick", "smart"]
GenerationStatus = Literal["processing", "generating"]


class InputImage(BaseModel):
    """Uploaded image reference used as multimodal input."""
    file_id: Optional[str] = Field(
        default=None,
        alias="fileId",
        description="Private uploaded file identifier",
        json_schema_extra={"example": "123e4567-e89b-12d3-a456-426614174000"},
    )
    name: Optional[str] = Field(default=None, description="Original file name")
    mime_type: Optional[str] = Field(
        default=None,
        description="MIME type of the uploaded image",
        json_schema_extra={"example": "image/png"},
    )
    url: Optional[str] = Field(
        default=None,
        description="Authenticated image URL for the uploaded file",
        json_schema_extra={"example": "https://vibecraft.ouni.space/api/files/123e4567-e89b-12d3-a456-426614174000"},
    )

    model_config = {"populate_by_name": True}


ChatPartType = Literal["text", "image_url"]
ChatRole = Literal["user", "assistant"]


class ChatMessagePart(BaseModel):
    type: ChatPartType = Field(..., description="Structured chat content part type.")
    text: Optional[str] = Field(default=None, max_length=15000, description="Text content for text parts.")
    url: Optional[str] = Field(default=None, max_length=2048, description="Image URL for image_url parts.")
    mime_type: Optional[str] = Field(
        default=None,
        alias="mimeType",
        max_length=128,
        description="Optional MIME type for image parts.",
    )

    model_config = {"populate_by_name": True}


class ChatMessage(BaseModel):
    role: ChatRole = Field(..., description="Chat speaker role.")
    parts: List[ChatMessagePart] = Field(
        ...,
        min_length=1,
        max_length=16,
        description="Ordered content parts for one chat message.",
    )


class PlainChatOptions(BaseModel):
    temperature: Optional[float] = Field(default=None, ge=0, le=2)
    max_tokens: Optional[int] = Field(default=None, alias="maxTokens", ge=10, le=15000)
    top_p: Optional[float] = Field(default=None, alias="topP", gt=0, le=1)
    thinking_budget: Optional[int] = Field(default=None, alias="thinkingBudget", ge=1, le=1_000_000)
    thinking_level: Optional[Literal["MINIMAL", "LOW", "MEDIUM", "HIGH"]] = Field(default=None, alias="thinkingLevel")
    presence_penalty: Optional[float] = Field(default=None, alias="presencePenalty", ge=-2, le=2)
    frequency_penalty: Optional[float] = Field(default=None, alias="frequencyPenalty", ge=-2, le=2)
    candidate_count: Optional[int] = Field(default=None, alias="candidateCount", ge=1, le=16)
    media_resolution: Optional[Literal["low", "medium", "high", "ultra_high", "LOW", "MEDIUM", "HIGH", "ULTRA_HIGH"]] = Field(default=None, alias="mediaResolution")
    image_size: Optional[str] = Field(default=None, alias="imageSize", max_length=20)
    sample_image_size: Optional[str] = Field(default=None, alias="sampleImageSize", max_length=20)
    aspect_ratio: Optional[str] = Field(default=None, alias="aspectRatio", max_length=20)
    seed: Optional[int] = Field(default=None, ge=1, le=2_147_483_647)
    add_watermark: Optional[bool] = Field(default=None, alias="addWatermark")
    enhance_prompt: Optional[bool] = Field(default=None, alias="enhancePrompt")
    output_mime_type: Optional[str] = Field(default=None, alias="outputMimeType", max_length=120)
    prompt_cache_key: Optional[str] = Field(default=None, alias="promptCacheKey", max_length=255)

    model_config = {"populate_by_name": True, "extra": "forbid"}

    @field_validator("thinking_level", mode="before")
    @classmethod
    def normalize_thinking_level(cls, value):
        if value is None:
            return None
        if isinstance(value, str):
            normalized = value.strip().upper()
            return normalized or None
        return value

    @field_validator("media_resolution", mode="before")
    @classmethod
    def normalize_media_resolution(cls, value):
        if value is None:
            return None
        if isinstance(value, str):
            normalized = value.strip().lower()
            return normalized or None
        return value


class PlainChatRequest(BaseModel):
    model: str = Field(..., min_length=1, max_length=255, description="Selected chat model ID.")
    system: List[ChatMessagePart] = Field(
        default_factory=list,
        max_length=8,
        description="Optional system prompt parts stored separately from the conversation messages.",
    )
    messages: List[ChatMessage] = Field(
        ...,
        min_length=1,
        max_length=50,
        description="Conversation turns in canonical chat format.",
    )
    options: Optional[PlainChatOptions] = Field(default=None, description="Optional chat generation settings.")


class PlainChatModelItem(BaseModel):
    id: str
    display_name: str = Field(alias="displayName")
    description: str = ""
    provider: str
    supports_image_input: bool = Field(default=False, alias="supportsImageInput")
    input_modalities: List[str] = Field(default_factory=list, alias="inputModalities")
    output_modalities: List[str] = Field(default_factory=list, alias="outputModalities")
    parameter_schema: Dict[str, Any] = Field(default_factory=dict, alias="parameterSchema")
    pricing: Dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class PlainChatModelListResponse(BaseModel):
    models: List[PlainChatModelItem] = Field(default_factory=list)


class PlainChatConversationCreateRequest(BaseModel):
    model: str = Field(..., min_length=1, max_length=255, description="Selected chat model ID.")
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    system: List[ChatMessagePart] = Field(default_factory=list, max_length=8)


class PlainChatConversationItem(BaseModel):
    id: str
    model: str
    title: str = Field(default="New Chat")
    system: List[ChatMessagePart] = Field(default_factory=list)
    created_at: int = Field(alias="createdAt")
    updated_at: int = Field(alias="updatedAt")
    last_message_at: Optional[int] = Field(default=None, alias="lastMessageAt")
    prompt_tokens_total: int = Field(default=0, alias="promptTokensTotal")
    completion_tokens_total: int = Field(default=0, alias="completionTokensTotal")
    total_tokens: int = Field(default=0, alias="totalTokens")
    total_cost_credits: float = Field(default=0, alias="totalCostCredits")
    total_cost_raw_credits: float = Field(default=0, alias="totalCostRawCredits")

    model_config = {"populate_by_name": True}


class PlainChatConversationListResponse(BaseModel):
    conversations: List[PlainChatConversationItem] = Field(default_factory=list)


class PlainChatConversationMessagesResponse(BaseModel):
    conversation: PlainChatConversationItem
    messages: List[Dict[str, Any]] = Field(default_factory=list)


class PlainChatConversationUpdateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)


class PlainChatConversationMessageCreateRequest(BaseModel):
    parts: List[ChatMessagePart] = Field(..., min_length=1, max_length=16)
    options: Optional[PlainChatOptions] = None


class PlainChatConversationTurnResponse(BaseModel):
    status: str = Field(..., description="Result status: 'success' or 'error'.")
    conversation: Optional[PlainChatConversationItem] = None
    user_message: Optional[Dict[str, Any]] = Field(default=None, alias="userMessage")
    assistant_message: Optional[Dict[str, Any]] = Field(default=None, alias="assistantMessage")
    usage: Optional[Dict[str, Any]] = Field(default=None)
    meta: Optional[Dict[str, Any]] = Field(default=None)

    model_config = {"populate_by_name": True}


class UserProfileUpdateRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=15)
    bio: str = Field(default="", max_length=500)

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        normalized = re.sub(r"[^a-z0-9._-]+", "", str(value or "").strip().lower())
        if not normalized:
            raise ValueError("Username is required")
        return normalized[:15]

    @field_validator("bio")
    @classmethod
    def normalize_bio(cls, value: str) -> str:
        return str(value or "").strip()[:500]


class UserNotificationPreferencesUpdateRequest(BaseModel):
    email_general_news_enabled: bool = Field(alias="emailGeneralNewsEnabled")
    email_platform_updates_enabled: bool = Field(alias="emailPlatformUpdatesEnabled")

    model_config = {"populate_by_name": True}


class CreditLedgerEntryResponse(BaseModel):
    id: str
    uid: str
    delta_minor: int = Field(alias="deltaMinor")
    reason: str
    actor_uid: Optional[str] = Field(default=None, alias="actorUid")
    metadata: Dict[str, Any] = Field(default_factory=dict)
    code_hash: Optional[str] = Field(default=None, alias="codeHash")
    analyze_session_id: Optional[str] = Field(default=None, alias="analyzeSessionId")
    created_at: int = Field(alias="createdAt")

    model_config = {"populate_by_name": True}


class CreditLedgerListResponse(BaseModel):
    entries: List[CreditLedgerEntryResponse] = Field(default_factory=list)


class CreditActivityEntryResponse(BaseModel):
    id: str
    created_at: int = Field(alias="createdAt")
    activity_type: str = Field(alias="activityType")
    activity: str
    status: str = "COMPLETED"
    delta_minor: int = Field(alias="deltaMinor")

    model_config = {"populate_by_name": True}


class CreditActivityListResponse(BaseModel):
    entries: List[CreditActivityEntryResponse] = Field(default_factory=list)

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
    mode: GenerationMode = Field(
        default="smart",
        description="Workflow mode. 'quick' generates directly, 'smart' runs analyze then review before generation."
    )
    input_image: Optional[InputImage] = Field(
        default=None,
        description="Legacy optional uploaded image used as multimodal input"
    )
    input_images: Optional[List[InputImage]] = Field(
        default=None,
        description="Optional uploaded images used as multimodal input, maximum 4"
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
    model_parameters: Optional[Dict[str, Dict[str, Any]]] = Field(
        default={},
        description="Optional per-output model parameters selected during review, e.g. {image: {...}, caption: {...}}",
    )
    status: GenerationStatus = Field(
        default="processing",
        description="Current workflow stage. 'processing' starts analysis, 'generating' executes final generation."
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "user_text": "A sleek tech product on a minimalist desk",
                    "requested_outputs": ["image", "caption"],
                    "mode": "smart",
                    "input_images": [
                        {
                            "fileId": "123e4567-e89b-12d3-a456-426614174000",
                            "name": "reference.png",
                            "mime_type": "image/png",
                            "url": "https://vibecraft.ouni.space/api/files/123e4567-e89b-12d3-a456-426614174000"
                        }
                    ],
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
    smart_analysis_fee: float = Field(
        default=0.1,
        description="Fixed fee charged when Smart mode starts the analysis/review step."
    )
    minimum_text_generation_cost: float = Field(
        default=0.01,
        description="Minimum effective cost applied to text generation models."
    )
    minimum_image_generation_cost: float = Field(
        default=0.10,
        description="Minimum effective cost applied to image generation models."
    )
    catalog_warnings: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Warnings for catalog entries priced below the enforced backend cost floors."
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


class AdminLoginRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=64)
    password: str = Field(..., min_length=8, max_length=256)


class AdminSessionAccount(BaseModel):
    id: str
    username: str
    isActive: bool = True
    createdAt: int
    updatedAt: int
    lastLoginAt: Optional[int] = None


class AdminSessionResponse(BaseModel):
    sessionId: str
    username: str
    adminId: str
    createdAt: int
    expiresAt: int
    account: AdminSessionAccount


class AdminUserListItem(BaseModel):
    uid: str
    email: str
    displayName: str
    credits: float
    reservedCredits: float = 0.0
    totalCredits: float = 0.0
    isSuspended: bool = False
    suspensionReason: str = ""
    activeSuspensionUntil: Optional[int] = None
    activeSuspensionIsPermanent: bool = False
    lastSeenAt: Optional[int] = None
    createdAt: Optional[int] = None


class AdminUserListResponse(BaseModel):
    users: List[AdminUserListItem]
    total: int
    search: str = ""


class AdminUserDetailResponse(BaseModel):
    uid: str
    email: str
    displayName: str
    credits: float
    reservedCredits: float = 0.0
    totalCredits: float = 0.0
    isSuspended: bool = False
    suspensionReason: str = ""
    activeSuspensionUntil: Optional[int] = None
    activeSuspensionIsPermanent: bool = False
    lastSeenAt: Optional[int] = None
    createdAt: Optional[int] = None
    updatedAt: Optional[int] = None


class AdminReasonRequest(BaseModel):
    reason: str = Field(
        ...,
        min_length=3,
        max_length=500,
        description="Required reason for sensitive admin actions.",
    )


class AdminCreditCodeItem(BaseModel):
    code: str
    codePreview: str
    credits: float
    maxClaims: int
    claimedCount: int
    createdAt: Optional[int] = None
    createdBy: Optional[str] = None
    batchId: Optional[str] = None
    batchTitle: Optional[str] = None
    isActive: bool = True
    expiresAt: Optional[int] = None
    status: str


class AdminCreditCodeStatusSummaryItem(BaseModel):
    status: str
    codeCount: int
    totalCredits: float = 0.0
    averageCredits: float = 0.0


class AdminCreditCodeListResponse(BaseModel):
    codes: List[AdminCreditCodeItem]
    total: int
    summaries: List[AdminCreditCodeStatusSummaryItem] = Field(default_factory=list)


class AdminCreditCodeBatchItem(BaseModel):
    batchId: str
    title: str
    credits: float
    totalCodes: int
    claimedCodes: int
    activeCodes: int
    status: str
    createdAt: Optional[int] = None


class AdminCreditCodeBatchStatusSummaryItem(BaseModel):
    status: str
    codeCount: int
    totalCredits: float = 0.0
    averageCredits: float = 0.0


class AdminCreditCodeBatchListResponse(BaseModel):
    batches: List[AdminCreditCodeBatchItem]
    total: int
    summaries: List[AdminCreditCodeBatchStatusSummaryItem] = Field(default_factory=list)


class AdminGenerationJobItem(BaseModel):
    id: str
    uid: str
    status: str
    prompt: str
    requestedOutputs: List[str]
    reservedCost: float = 0.0
    capturedCost: float = 0.0
    refundedCost: float = 0.0
    failureReason: Optional[str] = None
    createdAt: Optional[int] = None
    updatedAt: Optional[int] = None
    completedAt: Optional[int] = None


class AdminGenerationJobListResponse(BaseModel):
    jobs: List[AdminGenerationJobItem]
    total: int
    status: str = ""


class AdminAuditLogItem(BaseModel):
    id: str
    adminUid: Optional[str] = None
    adminEmail: str
    action: str
    targetType: str
    targetId: str
    reason: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
    createdAt: Optional[int] = None


class AdminAuditLogListResponse(BaseModel):
    logs: List[AdminAuditLogItem]
    total: int
    adminUid: str = ""
    action: str = ""
    targetType: str = ""
    targetId: str = ""


class DashboardNewsItemResponse(BaseModel):
    id: str
    badge: str = ""
    when: str = ""
    title: str
    description: str = ""
    linkLabel: str = ""
    linkHref: str = "/studio"
    tone: str = "blue"
    sortOrder: int = 0
    isActive: bool = True
    createdAt: Optional[int] = None
    updatedAt: Optional[int] = None


class DashboardNewsListResponse(BaseModel):
    items: List[DashboardNewsItemResponse]
    total: int


class DashboardNewsUpsertRequest(BaseModel):
    badge: Literal["AI News", "Platform Updates", "New Features"] = "AI News"
    title: str = Field(..., min_length=1, max_length=160)
    description: str = Field(default="", max_length=600)
    linkLabel: str = Field(default="", max_length=80)
    linkHref: str = Field(default="/studio", max_length=255)
    tone: Literal["blue", "purple", "slate"] = "blue"
    sortOrder: int = Field(default=0, ge=0, le=999)
    isActive: bool = True

    @field_validator("title", "description", "linkLabel", "linkHref")
    @classmethod
    def normalize_text_fields(cls, value: str) -> str:
        return str(value or "").strip()


class AdminAuthFailureSummaryItem(BaseModel):
    username: str
    isActive: bool = True
    wrongPasswordFailures: int = 0
    windowSeconds: int = 0
    lockoutThreshold: int = 0
    deactivationThreshold: int = 0
    isLockedOut: bool = False


class AdminAuthFailureSummaryResponse(BaseModel):
    summaries: List[AdminAuthFailureSummaryItem]
    total: int


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
