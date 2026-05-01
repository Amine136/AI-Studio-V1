from typing import TypedDict, Any, Dict, List, Literal, Optional

# ---------------------------
# 1. Type Definitions
# ---------------------------

# The flexible dictionary for the generation parameters (merged result)
ContentSpec = Dict[str, Any]

# The valid output types supported by the system
OutputType = Literal["caption", "image"]


class InputImage(TypedDict, total=False):
    file_id: str
    name: str
    mime_type: str
    url: str

# ---------------------------
# 2. The Graph State
# ---------------------------

class StudioState(TypedDict, total=False):
    """
    The Single Source of Truth for a Generation Run.
    This dict is passed between all nodes in the LangGraph workflow.
    """
    
    # --- Input Layer (From User) ---
    user_text: str                       # Raw input: "Futuristic city in rain"
    owner_uid: str                       # Authenticated owner for private file access
    requested_outputs: List[OutputType]  # What to generate: ["image", "caption"]
    input_image: Optional[InputImage]    # Optional uploaded image used as multimodal input
    
    # Official tracking of user model choices
    user_preferences: Dict[str, str]     # e.g. {"image_model": "imagen-4.0-fast-generate-001"}
    model_parameters: Dict[str, Dict[str, Any]]  # e.g. {"image": {"aspectRatio": "16:9"}}
    
    # --- Interaction Layer (UI Feedback) ---
    # Corrections from the "Smart Dropdowns" (e.g., {"lighting": "Natural"})
    user_corrections: Dict[str, Any]     
    
    # The extracted JSON plan from the AI (Obligatory vs Suggestions)
    extracted_intent: Dict[str, Any]     
    
    # Data prepared for the Frontend UI (Dropdown options + Pre-selections)
    ui_schema: Dict[str, Any]            

    # --- Control Flow ---
    # processing: AI is analyzing text
    # awaiting_review: Paused for user to check dropdowns
    # generating: User approved, running generation requests through ApiKeyManager
    status: Literal["processing", "awaiting_review", "generating", "complete", "error"]

    # --- Execution Layer ---
    # Which specific models were selected for this run
    assigned_models: Dict[str, str]      
    
    # The Final Contract: Flattened, validated parameters
    content_spec: ContentSpec            

    # The actual API payloads ready to be sent
    model_requests: List[Dict[str, Any]] 

    # --- Output Layer ---
    # Raw generation results (URLs, text)
    generated_assets: Dict[str, Any]     
    
    # Per-content AI-generated prompts (editable by user)
    content_prompts: Dict[str, str]

    # Total credit cost accumulated during generation
    total_cost: float

    # The final formatted response object
    final_response: Dict[str, Any]

    # Friendly error surfaced back to the API layer/front-end
    error_message: str

    # Technical failure detail kept for debugging/job tracking
    failure_reason: str
