// frontend/src/types.ts

export type OutputType = "caption" | "image";
export type GenerationMode = "quick" | "smart";
export type GenerationStatus = "processing" | "generating";

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

export type PlainChatRole = "user" | "assistant";
export type PlainChatPartType = "text" | "image_url";

export interface PlainChatPart {
  type: PlainChatPartType;
  text?: string;
  url?: string;
  mimeType?: string;
}

export interface PlainChatMessage {
  id: string;
  conversationId: string;
  uid: string;
  role: PlainChatRole;
  parts: PlainChatPart[];
  createdAt: number;
}

export interface PlainChatParameterSchemaEntry {
  type?: string;
  createFlowCategory?: "image" | "text";
  min?: number;
  max?: number;
  minExclusive?: number;
  maxExclusive?: number;
  default?: string | number | boolean;
  recommendedDefault?: string | number | boolean;
  values?: Array<string | number>;
  value?: string | number | boolean;
  configurable?: boolean;
  note?: string;
  [key: string]: unknown;
}

export interface PlainChatModelItem {
  id: string;
  displayName: string;
  description?: string;
  provider: string;
  supportsImageInput: boolean;
  parameterSchema?: Record<string, PlainChatParameterSchemaEntry>;
  pricing?: ModelPricingSummary;
}

export interface PlainChatModelListResponse {
  models: PlainChatModelItem[];
}

export interface PlainChatConversationItem {
  id: string;
  model: string;
  title: string;
  system: PlainChatPart[];
  createdAt: number;
  updatedAt: number;
  lastMessageAt?: number | null;
  promptTokensTotal?: number;
  completionTokensTotal?: number;
  totalTokens?: number;
  totalCostCredits?: number;
}

export interface PlainChatConversationListResponse {
  conversations: PlainChatConversationItem[];
}

export interface PlainChatConversationCreateRequest {
  model: string;
  title?: string;
  system?: PlainChatPart[];
}

export interface PlainChatConversationUpdateRequest {
  title: string;
}

export interface PlainChatConversationMessagesResponse {
  conversation: PlainChatConversationItem;
  messages: PlainChatMessage[];
}

export interface PlainChatOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  thinkingBudget?: number;
  thinkingLevel?: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";
  presencePenalty?: number;
  frequencyPenalty?: number;
  candidateCount?: number;
  mediaResolution?: "low" | "medium" | "high" | "ultra_high";
  imageSize?: string;
  sampleImageSize?: string;
  aspectRatio?: string;
  sampleCount?: number;
  seed?: number;
  addWatermark?: boolean;
  enhancePrompt?: boolean;
  outputMimeType?: string;
  promptCacheKey?: string;
}

export interface PlainChatConversationMessageCreateRequest {
  parts: PlainChatPart[];
  options?: PlainChatOptions;
}

export interface PlainChatConversationTurnResponse {
  status: "success" | "error";
  conversation?: PlainChatConversationItem;
  userMessage?: PlainChatMessage;
  assistantMessage?: PlainChatMessage;
  usage?: BillingUsage;
  meta?: PlainChatTurnMeta;
}

export interface BillingUsage {
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  totalTokens?: number;
  [key: string]: any;
}

export interface BillingBreakdown {
  currency?: string;
  components?: Record<string, any>;
  formula?: string[];
  [key: string]: any;
}

export interface PlainChatTurnMeta {
  provider?: string;
  model?: string;
  latencyMs?: number;
  charged_cost?: number;
  current_balance?: number;
  billingMode?: string;
  resolvedCost?: string | number;
  billing?: BillingBreakdown;
  error_message?: string;
  failure_reason?: string;
  provider_error?: Record<string, any>;
  [key: string]: any;
}

// Step 1: What we send to start
export interface GenerateRequest {
  user_text: string;
  requested_outputs: OutputType[];
  mode?: GenerationMode;
  input_image?: InputImagePayload | null;
  user_preferences?: Record<string, string>; // e.g. { "image_model": "dalle-3" }
  user_corrections?: Record<string, any>;    // e.g. { "lighting": "Natural" }
  model_parameters?: Record<string, Record<string, string | number | boolean>>;
  status?: GenerationStatus;
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
  billing_components?: Array<Record<string, any>>;
  analyze_session_id?: string;
  analyze_abandon_fee?: number;
  smart_analysis_fee?: number;
  charged_cost?: number;
  current_balance?: number;
  mode?: GenerationMode;
  error_message?: string;
}

export interface GenerationResult {
  status: "success" | "awaiting_review" | "error";
  ui_schema?: Record<OutputType, Record<string, UISchemaItem>>; // Grouped by output type
  content_prompts?: Record<string, string>;  // Per-content AI prompts: {image_prompt, caption_prompt}
  results?: Record<string, string>;         // Present if success
  meta?: GenerationMeta;
}

export interface ModelExpectedPricingDetails {
  type?: string;
  amount?: number;
  label?: string;
  basePrice?: number;
  imageSizePrices?: Record<string, number>;
  sampleImageSizePrices?: Record<string, number>;
  [key: string]: unknown;
}

export interface ModelPricingSummary {
  minimum: number;
  expected?: number | ModelExpectedPricingDetails;
}

export interface ModelCatalogEntry {
  billing?: Record<string, unknown> | null;
  display_name?: string;
  provider?: string;
  model_id?: string;
  description?: string;
  input_modalities?: string[];
  output_modalities?: string[];
  type?: string;
  parameterSchema?: Record<string, PlainChatParameterSchemaEntry>;
  pricing?: ModelPricingSummary;
}

export interface CatalogWarningItem {
  type: string;
  task: string;
  model: string;
  display_name: string;
  configured_cost: number;
  minimum_cost: number;
  message: string;
}

export interface SystemConfig {
  field_options: Record<string, any>;
  model_catalog: Record<OutputType, Record<string, ModelCatalogEntry>>;
  smart_analysis_fee: number;
  minimum_text_generation_cost: number;
  minimum_image_generation_cost: number;
  catalog_warnings: CatalogWarningItem[];
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

export interface AdminAuthFailureSummaryItem {
  username: string;
  isActive: boolean;
  wrongPasswordFailures: number;
  windowSeconds: number;
  lockoutThreshold: number;
  deactivationThreshold: number;
  isLockedOut: boolean;
}

export interface AdminAuthFailureSummaryResponse {
  summaries: AdminAuthFailureSummaryItem[];
  total: number;
}
