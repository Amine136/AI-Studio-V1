// frontend/src/types.ts

export type OutputType = "caption" | "image";

// Step 1: What we send to start
export interface GenerateRequest {
  user_text: string;
  requested_outputs: OutputType[];
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
export interface GenerationResult {
  status: "success" | "awaiting_review" | "error";
  ui_schema?: Record<OutputType, Record<string, UISchemaItem>>; // Grouped by output type
  results?: Record<string, string>;         // Present if success
  meta?: any;
}