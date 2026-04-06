// frontend/src/types.ts

export type OutputType = "caption" | "image";

export interface InputImagePayload {
  name?: string;
  mime_type: string;
  data: string;
}

// Step 1: What we send to start
export interface GenerateRequest {
  user_text: string;
  requested_outputs: OutputType[];
  input_image?: InputImagePayload | null;
  user_preferences?: Record<string, string>; // e.g. { "image_model": "dalle-3" }
  user_corrections?: Record<string, any>;    // e.g. { "lighting": "Natural" }
  status?: "processing" | "generating";
}

// Step 2: What the UI Dropdowns look like
export interface UISchemaItem {
  label: string;
  value: any;      // The current selected value (e.g. "Neon")
  options: string[]; // The list of choices
  category?: "obligatory" | "ai_suggestion"; // Field category for display grouping
}

// Step 3: The Backend Response
export interface GenerationMeta {
  settings_used?: Record<string, any>;
  total_cost?: number;
  analyze_session_id?: string;
  analyze_abandon_fee?: number;
  charged_cost?: number;
  current_balance?: number;
}

export interface GenerationResult {
  status: "success" | "awaiting_review" | "error";
  ui_schema?: Record<OutputType, Record<string, UISchemaItem>>; // Grouped by output type
  content_prompts?: Record<string, string>;  // Per-content AI prompts: {image_prompt, caption_prompt}
  results?: Record<string, string>;         // Present if success
  meta?: GenerationMeta;
}

export interface ModelCatalogEntry {
  cost?: number;
  display_name?: string;
  provider?: string;
  model_id?: string;
  description?: string;
  input_modalities?: string[];
  output_modalities?: string[];
  type?: string;
}

export interface SystemConfig {
  field_options: Record<string, any>;
  model_catalog: Record<OutputType, Record<string, ModelCatalogEntry>>;
}
