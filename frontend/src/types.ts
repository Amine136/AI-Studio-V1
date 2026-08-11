// frontend/src/types.ts

export type OutputType = "caption" | "image";
export type GenerationMode = "quick" | "smart";
export type GenerationStatus = "processing" | "generating";

export interface InputImagePayload {
  file_id?: string;
  name?: string;
  mime_type?: string;
  url: string;
}

export interface UploadedImageResult {
  id: string;
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
  inputModalities?: string[];
  outputModalities?: string[];
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
  totalCostRawCredits?: number;
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
  quality?: string;
  sampleImageSize?: string;
  aspectRatio?: string;
  sampleCount?: number;
  seed?: number;
  addWatermark?: boolean;
  enhancePrompt?: boolean;
  outputMimeType?: string;
  promptCacheKey?: string;
  styleType?: string;
  stylePreset?: string;
  strength?: number;
  colors?: string[];
  backgroundColor?: string;
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

export interface AdminModelVisibilityItem {
  id: string;
  displayName: string;
  provider: string;
  description?: string;
  inputModalities: string[];
  outputModalities: string[];
  enabled: boolean;
  disabledByProvider?: boolean;
}

export interface AdminModelVisibilityProvider {
  id: string;
  displayName: string;
  total: number;
  enabled: boolean;
  disabled: number;
}

export interface AdminModelVisibilityTask {
  task: string;
  models: AdminModelVisibilityItem[];
}

export interface AdminModelVisibilityResponse {
  tasks: AdminModelVisibilityTask[];
  providers: AdminModelVisibilityProvider[];
  disabledModelIds: string[];
  disabledProviderIds: string[];
  total: number;
  enabled: number;
  disabled: number;
}

export interface CurrentUserProfile {
  uid: string;
  email: string;
  displayName: string;
  username?: string;
  requiresProfileSetup?: boolean;
  bio?: string;
  emailGeneralNewsEnabled?: boolean;
  emailPlatformUpdatesEnabled?: boolean;
  emailLifecycleEnabled?: boolean;
  preferredLanguage?: string | null;
  needsPreferencesSetup?: boolean;
  credits?: number;
  reservedCredits?: number;
  totalCredits?: number;
  /** Owed after a reversed payment. An admin grant does NOT settle it. */
  creditDebt?: number;
  createdAt?: number | null;
  updatedAt?: number | null;
  lastSeenAt?: number | null;
  isSuspended?: boolean;
  suspensionReason?: string;
  isDeactivated?: boolean;
  deactivatedAt?: number | null;
  deactivationReason?: string;
  profileChangesRemaining?: number;
  profileChangesResetAt?: number | null;
}

export interface CreditLedgerEntry {
  id: string;
  uid: string;
  deltaMinor: number;
  reason: string;
  actorUid?: string | null;
  metadata?: Record<string, any>;
  codeHash?: string | null;
  analyzeSessionId?: string | null;
  createdAt: number;
}

export interface CreditLedgerListResponse {
  entries: CreditLedgerEntry[];
}

export interface CreditActivityEntry {
  id: string;
  createdAt: number;
  activityType: string;
  activity: string;
  status: string;
  deltaMinor: number;
  /* Provider transaction reference (the Dodo payment id on card rows). A purchase
     and the reversal that undid it share the same one. Absent on rows with no
     external transaction. */
  reference?: string | null;
}

export interface CreditActivityListResponse {
  entries: CreditActivityEntry[];
}

export interface CreditPlan {
  id: string;
  name: string;
  credits: number;
  priceMinor: number;
  currency: string;
}

export interface PaymentMethodOption {
  id: string;
  group: string;
  available: boolean;
  label: string;
  icon: string;
  /** The one string a customer copies (account number / IBAN). */
  primaryLabel: string;
  primaryValue: string;
  /** Supporting line under the primary value (BIC, bank, holder). */
  meta: string[];
}

export interface CheckoutConfig {
  plans: CreditPlan[];
  /** Same packs, USD-priced for the Dodo Payments (international card) rail.
   *  priceMinor here is CENTS, not millimes — do not reuse the TND formatter. */
  plansUsd: CreditPlan[];
  methods: PaymentMethodOption[];
  whatsappNumber: string;
  maxProofFiles: number;
  maxProofBytes: number;
  noteMaxLength: number;
}

export type CreditOrderStatus = "pending" | "accepted" | "refused";

export interface CreditOrder {
  id: string;
  planId: string;
  planName: string;
  credits: number;
  priceMinor: number;
  currency: string;
  paymentMethod: string;
  note: string;
  status: CreditOrderStatus;
  /** Only present for the order's own owner, once accepted. */
  code: string;
  adminMessage: string;
  /** False on the one response that first reveals a resolved order. */
  seen: boolean;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
}

export interface CreditOrderListResponse {
  orders: CreditOrder[];
}

/** Another order carrying a receipt with the same bytes as this one's. */
export interface DuplicateProofRef {
  orderId: string;
  status: CreditOrderStatus;
  createdAt: number;
}

export interface AdminCreditOrder extends CreditOrder {
  uid: string;
  userEmail: string;
  userDisplayName: string;
  resolvedByEmail: string;
  proofFileIds: string[];
  proofUrls?: string[];
  /** Admin-only: the buyer's own CreditOrder never carries this. */
  duplicateProofs: DuplicateProofRef[];
}

export interface AdminCreditOrderListResponse {
  orders: AdminCreditOrder[];
  total: number;
}

export interface UserProfileUpdateRequest {
  username: string;
  bio: string;
}

export interface ProfileCompletionRequest {
  fullName: string;
  username: string;
}

export interface UserNotificationPreferencesUpdateRequest {
  // All optional: a partial update leaves omitted fields unchanged server-side.
  emailGeneralNewsEnabled?: boolean;
  emailPlatformUpdatesEnabled?: boolean;
  emailLifecycleEnabled?: boolean;
  // First-run preferences card: chosen UI language + a flag marking the
  // one-time card answered (Save or Skip).
  preferredLanguage?: string;
  preferencesPrompted?: boolean;
}

export type FeedbackCategory = "bug" | "idea" | "other";
export type FeedbackStatus = "new" | "handled";

export interface FeedbackItem {
  id: string;
  uid?: string | null;
  email: string;
  category: FeedbackCategory;
  message: string;
  route: string;
  language: string;
  userAgent: string;
  status: FeedbackStatus;
  createdAt?: number | null;
  updatedAt?: number | null;
}

export interface FeedbackListResponse {
  items: FeedbackItem[];
  total: number;
}

export interface FeedbackSubmitRequest {
  category: FeedbackCategory;
  message: string;
  route?: string;
  language?: string;
}

// Step 1: What we send to start
export interface GenerateRequest {
  user_text: string;
  requested_outputs: OutputType[];
  mode?: GenerationMode;
  input_image?: InputImagePayload | null;
  input_images?: InputImagePayload[] | null;
  user_preferences?: Record<string, string>; // e.g. { "image_model": "dalle-3" }
  user_corrections?: Record<string, any>;    // e.g. { "lighting": "Natural" }
  model_parameters?: Record<string, Record<string, string | number | boolean | string[]>>;
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
  token?: string;
}

export interface AdminUserListItem {
  uid: string;
  email: string;
  displayName: string;
  credits: number;
  reservedCredits: number;
  totalCredits: number;
  /** Owed after a reversed payment. An admin grant does NOT settle it. */
  creditDebt?: number;
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
  validitySeconds?: number | null;
  status: string;
}

export interface CreditGiftLot {
  credits: number;
  expiresAt: number;
  source: string;
}

export interface CreditBreakdown {
  available: number;
  own: number;
  reserved: number;
  /** Owed back after a reversed card payment. NOT subtracted from `available` —
   *  it is taken off the top of the next purchase or redeemed code instead. */
  debt: number;
  gifts: CreditGiftLot[];
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

// ---------------------------------------------------------------------------
// Template / Use-Case Packs
// ---------------------------------------------------------------------------
export type PackCapability =
  | "photoreal"
  | "edit-from-reference"
  | "text-in-image"
  | "vector-graphic"
  | "calligraphy";

export interface PackCard {
  id: string;
  sector: string;
  capability: PackCapability;
  title: string;
  promise: string;
  thumbnail_url: string;
  requires_image_input: boolean;
  kind?: "structured" | "freeform";
  tags: string[];
}

export interface PackListResponse {
  sector: string | null;
  lang: string;
  packs: PackCard[];
}

export interface PackSlotOption {
  value: string;
  label: string;
}

export interface PackSlot {
  key: string;
  type: "text" | "select" | "image_ref";
  label: string;
  required: boolean;
  options?: PackSlotOption[];
  placeholder?: string;
  multiline?: boolean;
}

export interface PackVariant {
  id: string;
  title: string;
  scene: string;
  thumbnail_url: string;
  hero_example_url: string;
  // Editable example text that pre-fills the studio composer for this mockup.
  example?: string;
}

export interface PackModelOption {
  id: string;
  label: string;
  quality_options?: string[];
  // The size/ratio values THIS model accepts (grok ratio strings vs gpt-image
  // pixel sizes). The confirm pop-up's aspect-ratio options follow the selected
  // model; falls back to the pack-level list when absent.
  aspect_ratios?: string[];
}

export interface PackDetail extends PackCard {
  hero_example_url: string;
  slots: PackSlot[];
  aspect_ratios: string[];
  default_n: number;
  models?: PackModelOption[];
  mockup_models?: PackModelOption[];
  variants?: PackVariant[];
  // Pack-level example that pre-fills the studio composer (variant example wins).
  example?: string;
}

export interface PackEstimate {
  available: boolean;
  model: string | null;
  unit: number;
  n: number;
  total: number;
}

export interface PackTile {
  index: number;
  status: "success" | "blocked" | "skipped" | "error";
  image: string | null;
  charged_cost: number;
  error?: string;
  reason?: string;
}

export interface PackGenerateResponse {
  pack_id: string;
  requested: number;
  tiles: PackTile[];
  summary: {
    succeeded: number;
    charged_total: number;
    current_balance: number | null;
  };
}

export interface PackGenerateBody {
  slot_values?: Record<string, string>;
  n?: number;
  aspect_ratio?: string;
  image_refs?: InputImagePayload[];
  model?: string;
  quality?: string;
  prompt_override?: string;
}

// ---- Planning agent (the free step between studio and image model) ----
export interface PackChatTurn {
  role: "user" | "assistant";
  text: string;
}

// ---- Saved studio sessions (reopenable gallery + memory) ----
export interface PackSessionData {
  results?: { image: string; prompt?: string }[];
  history?: PackChatTurn[];
  mockup?: InputImagePayload | null;
}

export interface PackSessionMeta {
  id: string;
  pack_id: string;
  variant_id: string | null;
  title: string;
  created_at: number;
  updated_at: number;
  thumbnail: string | null;
  count: number;
}

export interface PackSessionFull extends PackSessionMeta {
  data: PackSessionData;
}

export interface PackPlanBody {
  text?: string;
  image_refs?: InputImagePayload[];
  lang?: string;
  variant_id?: string;
  round?: number;
  mockup_first?: boolean;
  history?: PackChatTurn[];
}

export interface PackPlan {
  final_prompt: string;
  model: string | null;
  aspect_ratio: string | null;
  quality: string | null;
  image_usage: string;
  summary: string;
}

export interface PackPlanResponse {
  status: "ok" | "needs_clarification" | "moderation_unavailable";
  clarification?: string;
  plan?: PackPlan;
  estimate?: PackEstimate | null;
  round: number;
  max_rounds: number;
}
