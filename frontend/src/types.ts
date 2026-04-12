// frontend/src/types.ts

export type OutputType = "caption" | "image";

export interface InputImagePayload {
  name?: string;
  mime_type?: string;
  url: string;
}

export interface UploadedImageResult {
  name: string;
  mime_type: string;
  url: string;
  size: number;
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

export interface AdminSessionAccount {
  id: string;
  username: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
}

export interface AdminSession {
  sessionId: string;
  username: string;
  adminId: string;
  createdAt: number;
  expiresAt: number;
  account: AdminSessionAccount;
}

export interface AdminUserListItem {
  uid: string;
  email: string;
  displayName: string;
  credits: number;
  reservedCredits: number;
  totalCredits: number;
  isSuspended: boolean;
  suspensionReason: string;
  activeSuspensionUntil?: number | null;
  activeSuspensionIsPermanent?: boolean;
  lastSeenAt?: number | null;
  createdAt?: number | null;
}

export interface AdminUserListResponse {
  users: AdminUserListItem[];
  total: number;
  search: string;
}

export interface AdminCreditCodeItem {
  code: string;
  codePreview: string;
  credits: number;
  maxClaims: number;
  claimedCount: number;
  createdAt?: number | null;
  createdBy?: string | null;
  batchId?: string | null;
  batchTitle?: string | null;
  isActive: boolean;
  expiresAt?: number | null;
  status: string;
}

export interface AdminCreditCodeStatusSummaryItem {
  status: string;
  codeCount: number;
  totalCredits: number;
  averageCredits: number;
}

export interface AdminCreditCodeListResponse {
  codes: AdminCreditCodeItem[];
  total: number;
  summaries: AdminCreditCodeStatusSummaryItem[];
}

export interface AdminCreditCodeBatchItem {
  batchId: string;
  title: string;
  credits: number;
  totalCodes: number;
  claimedCodes: number;
  activeCodes: number;
  status: string;
  createdAt?: number | null;
}

export interface AdminCreditCodeBatchStatusSummaryItem {
  status: string;
  codeCount: number;
  totalCredits: number;
  averageCredits: number;
}

export interface AdminCreditCodeBatchListResponse {
  batches: AdminCreditCodeBatchItem[];
  total: number;
  summaries: AdminCreditCodeBatchStatusSummaryItem[];
}

export interface AdminGenerationJobItem {
  id: string;
  uid: string;
  status: string;
  prompt: string;
  requestedOutputs: string[];
  reservedCost: number;
  capturedCost: number;
  refundedCost: number;
  failureReason?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  completedAt?: number | null;
}

export interface AdminGenerationJobListResponse {
  jobs: AdminGenerationJobItem[];
  total: number;
  status: string;
}

export interface AdminAuditLogItem {
  id: string;
  adminUid?: string | null;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  metadata: Record<string, any>;
  createdAt?: number | null;
}

export interface AdminAuditLogListResponse {
  logs: AdminAuditLogItem[];
  total: number;
  adminUid: string;
  action: string;
  targetType: string;
  targetId: string;
}
