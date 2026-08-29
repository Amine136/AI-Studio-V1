// frontend/src/services/api.ts
import axios from 'axios';
import {
  AdminSession,
  AdminAuditLogListResponse,
  AdminAuthFailureSummaryResponse,
  AdminCreditCodeBatchListResponse,
  AdminCreditCodeListResponse,
  AdminGenerationJobListResponse,
  AdminModelVisibilityResponse,
  AdminUserListResponse,
  GenerateRequest,
  GenerationResult,
  PlainChatConversationCreateRequest,
  PlainChatConversationItem,
  PlainChatConversationListResponse,
  PlainChatConversationMessageCreateRequest,
  PlainChatConversationMessagesResponse,
  PlainChatConversationTurnResponse,
  PlainChatConversationUpdateRequest,
  PlainChatModelListResponse,
  SystemConfig,
  CurrentUserProfile,
  CreditActivityListResponse,
  CreditBreakdown,
  CreditLedgerListResponse,
  CheckoutConfig,
  CreditOrder,
  CreditOrderListResponse,
  CreditOrderStatus,
  AdminCreditOrder,
  AdminCreditOrderListResponse,
  UserNotificationPreferencesUpdateRequest,
  UserProfileUpdateRequest,
  ProfileCompletionRequest,
  UploadedImageResult,
  PackListResponse,
  PackDetail,
  PackEstimate,
  PackGenerateResponse,
  PackGenerateBody,
  PackPlanBody,
  PackPlanResponse,
  PackSessionData,
  PackSessionFull,
  PackSessionMeta,
  FeedbackItem,
  FeedbackListResponse,
  FeedbackSubmitRequest,
  FeedbackStatus,
} from '../types';
import { auth } from '../lib/firebase';
import { signOutUser } from '../lib/auth';
import { getAdminCsrfToken, isAdminHost } from '../lib/admin';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api-proxy';
export const R2_PUBLIC_BASE = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || 'https://pub-64bf9ef2292c49f0a2053981c85e16d9.r2.dev';
const ADMIN_TOKEN_STORAGE_KEY = 'vibecraft_admin_token';

const NETWORK_ERROR_MESSAGE = 'Connection interrupted. Check your internet connection and try again.';

// Sentinel message + typed error for requests rejected by the content-moderation
// gate (HTTP 403 with detail.error.code === 'CONTENT_BLOCKED'). The UI special-cases
// this to show a distinct warning with a link to the content policy, leaking no category.
export const CONTENT_BLOCKED_MESSAGE = 'Content blocked by safety filters.';

export class ContentBlockedError extends Error {
  readonly code = 'CONTENT_BLOCKED';
  constructor(message: string = CONTENT_BLOCKED_MESSAGE) {
    super(message);
    this.name = 'ContentBlockedError';
  }
}

export function isContentBlockedError(error: unknown): boolean {
  return error instanceof ContentBlockedError;
}

// True for a dropped/interrupted connection (no HTTP response). Callers can give
// such errors a short grace + retry instead of failing instantly on a blip.
export function isNetworkError(error: unknown): boolean {
  return error instanceof Error && error.message === NETWORK_ERROR_MESSAGE;
}

// The response interceptor normalizes every failure into a plain Error, which
// loses the HTTP status. Callers that must distinguish "this resource is gone"
// (404/403 — stop, clear state) from "the server is busy or unreachable"
// (429/5xx/no response — retry) need the status, so carry it through.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Transient: worth retrying. A 429 here is usually Cloud Run's own
// "no available instance" abort or a slowapi burst rejection, not a permanent
// refusal; 5xx and connection drops are likewise momentary.
export function isRetryableApiError(error: unknown): boolean {
  if (isNetworkError(error)) return true;
  if (error instanceof ApiError) {
    return error.status === 429 || error.status === undefined || error.status >= 500;
  }
  return false;
}

// Sentinel for requests blocked because the moderation backend was unreachable
// (HTTP 503 detail.error.code === 'MODERATION_UNAVAILABLE'). This is NOT a user
// violation — show a neutral, transient "try again" message, never the
// content-policy warning, and it never counts toward an account ban.
export const MODERATION_UNAVAILABLE_MESSAGE =
  'Safety checks are temporarily unavailable, so this request could not be processed. No credits were charged — please try again in a moment.';

// Create axios instance with default headers
const client = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || '',
  },
});

client.interceptors.request.use(async (config) => {
  if (isAdminHost() && typeof window !== 'undefined') {
    const adminToken = localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
    if (adminToken) {
      config.headers = config.headers ?? {};
      config.headers.Authorization = `Bearer ${adminToken}`;
    }
  } else {
    const user = auth.currentUser;
    if (user) {
      const token = await user.getIdToken();
      config.headers = config.headers ?? {};
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  const method = (config.method || 'get').toLowerCase();
  if (isAdminHost() && !['get', 'head', 'options'].includes(method)) {
    const csrfToken = getAdminCsrfToken();
    if (csrfToken) {
      config.headers = config.headers ?? {};
      config.headers['X-CSRF-Token'] = csrfToken;
    }
  }
  return config;
});

function extractErrorMessage(error: unknown): string | undefined {
  if (!axios.isAxiosError(error)) return undefined;

  if (!error.response && (error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED' || error.message.toLowerCase().includes('timeout'))) {
    return NETWORK_ERROR_MESSAGE;
  }

  const payload = error.response?.data;
  if (payload?.detail?.error?.code === 'CONTENT_BLOCKED') return CONTENT_BLOCKED_MESSAGE;
  if (payload?.detail?.error?.code === 'MODERATION_UNAVAILABLE') return MODERATION_UNAVAILABLE_MESSAGE;
  if (typeof payload?.detail === 'string') return payload.detail;
  if (typeof payload?.message === 'string') return payload.message;
  if (typeof payload?.error === 'string') return payload.error;
  if (typeof payload?.meta?.error_message === 'string') return payload.meta.error_message;
  return undefined;
}

function normalizeApiError(error: unknown): Error {
  if (
    axios.isAxiosError(error) &&
    error.response?.data?.detail?.error?.code === 'CONTENT_BLOCKED'
  ) {
    return new ContentBlockedError();
  }
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  const detail = extractErrorMessage(error);
  if (detail) return new ApiError(detail, status);
  if (error instanceof TypeError) return new ApiError(NETWORK_ERROR_MESSAGE);
  if (error instanceof Error) return error;
  return new ApiError('Request failed. Please try again.', status);
}

// A suspended/deactivated account gets a 403 with a plain-string `detail` from the
// auth dependency (and from the moderation auto-ban response). Detect it globally so
// the user is ejected to sign-in the instant any request comes back inactive — no
// page refresh required — instead of lingering on a now-locked page.
function detectInactiveAccount(error: unknown): 'suspended' | 'deactivated' | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 403) return null;
  const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
  const message =
    typeof detail === 'string'
      ? detail
      : detail && typeof detail === 'object' && typeof (detail as { message?: unknown }).message === 'string'
        ? (detail as { message: string }).message
        : '';
  const lower = message.toLowerCase();
  if (lower.includes('deactivated')) return 'deactivated';
  if (lower.includes('suspended')) return 'suspended';
  return null;
}

let inactiveRedirectInFlight = false;
function ejectInactiveAccount(reason: 'suspended' | 'deactivated') {
  if (typeof window === 'undefined' || inactiveRedirectInFlight) return;
  const path = window.location.pathname;
  // /auth would loop; /credits keeps its own in-app suspension lock (code redemption).
  if (path.startsWith('/auth') || path.startsWith('/credits')) return;
  inactiveRedirectInFlight = true;
  void signOutUser()
    .catch(() => undefined)
    .finally(() => {
      window.location.replace(`/auth?reason=${reason}`);
    });
}

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const inactive = detectInactiveAccount(error);
    if (inactive) ejectInactiveAccount(inactive);
    return Promise.reject(normalizeApiError(error));
  },
);

function shouldLogApiError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return true;
  const status = error.response?.status;
  return status !== 401 && status !== 403 && status !== 429;
}

export const api = {
  adminLogin: async (username: string, password: string): Promise<AdminSession> => {
    try {
      const res = await client.post('/admin-auth/login', { username, password });
      if (!res.data?.token || typeof res.data.token !== 'string') {
        throw new Error('The server did not return an admin session token. Please contact support.');
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, res.data.token);
      }
      return res.data;
    } catch (error) {
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw error;
    }
  },

  adminLogout: async () => {
    try {
      const res = await client.post('/admin-auth/logout');
      return res.data;
    } finally {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
      }
    }
  },

  getAdminSession: async (): Promise<AdminSession> => {
    try {
      const res = await client.get('/admin-auth/me');
      return res.data;
    } catch (error) {
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw error;
    }
  },

  /**
   * Fetches the valid models and options (for the "Cold Start" UI)
   */
  getConfig: async (): Promise<SystemConfig> => {
    const res = await client.get('/config');
    return res.data;
  },

  getPlainChatModels: async (): Promise<PlainChatModelListResponse> => {
    const res = await client.get('/chat/models');
    return res.data;
  },

  getPlainChatConversations: async (limit = 20): Promise<PlainChatConversationListResponse> => {
    const res = await client.get('/chat/conversations', { params: { limit } });
    return res.data;
  },

  createPlainChatConversation: async (
    payload: PlainChatConversationCreateRequest,
  ): Promise<PlainChatConversationItem> => {
    const res = await client.post('/chat/conversations', payload);
    return res.data;
  },

  updatePlainChatConversation: async (
    conversationId: string,
    payload: PlainChatConversationUpdateRequest,
  ): Promise<PlainChatConversationItem> => {
    const res = await client.patch(`/chat/conversations/${conversationId}`, payload);
    return res.data;
  },

  deletePlainChatConversation: async (conversationId: string): Promise<void> => {
    await client.delete(`/chat/conversations/${conversationId}`);
  },

  getPlainChatConversationMessages: async (
    conversationId: string,
    limit = 100,
  ): Promise<PlainChatConversationMessagesResponse> => {
    const res = await client.get(`/chat/conversations/${conversationId}/messages`, { params: { limit } });
    return res.data;
  },

  sendPlainChatConversationMessage: async (
    conversationId: string,
    payload: PlainChatConversationMessageCreateRequest,
  ): Promise<PlainChatConversationTurnResponse> => {
    const res = await client.post(`/chat/conversations/${conversationId}/messages`, payload);
    return res.data;
  },

  getProfile: async (): Promise<CurrentUserProfile> => {
    try {
      const res = await client.get('/me');
      return res.data;
    } catch (error) {
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw error;
    }
  },

  updateProfile: async (payload: UserProfileUpdateRequest): Promise<CurrentUserProfile> => {
    try {
      const res = await client.patch('/me', payload);
      return res.data;
    } catch (error) {
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw error;
    }
  },

  completeProfile: async (payload: ProfileCompletionRequest): Promise<CurrentUserProfile> => {
    try {
      const res = await client.post('/me/complete-profile', payload);
      return res.data;
    } catch (error) {
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw error;
    }
  },

  updateNotificationPreferences: async (
    payload: UserNotificationPreferencesUpdateRequest,
  ): Promise<CurrentUserProfile> => {
    try {
      const res = await client.patch('/me/preferences', payload);
      return res.data;
    } catch (error) {
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw error;
    }
  },

  deactivateAccount: async (): Promise<CurrentUserProfile> => {
    try {
      const res = await client.post('/me/deactivate');
      return res.data;
    } catch (error) {
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw error;
    }
  },

  getHistory: async (limit = 20) => {
    try {
      const res = await client.get('/history', { params: { limit } });
      return res.data;
    } catch (error) {
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw error;
    }
  },

  getCreditLedger: async (limit = 20): Promise<CreditLedgerListResponse> => {
    try {
      const res = await client.get('/credits/ledger', { params: { limit } });
      return res.data;
    } catch (error) {
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw error;
    }
  },

  getCreditActivity: async (limit = 20): Promise<CreditActivityListResponse> => {
    try {
      const res = await client.get('/credits/activity', { params: { limit } });
      return res.data;
    } catch (error) {
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw error;
    }
  },

  getCreditBreakdown: async (): Promise<CreditBreakdown> => {
    const res = await client.get('/credits/breakdown');
    return res.data;
  },

  getCheckoutConfig: async (): Promise<CheckoutConfig> => {
    const res = await client.get('/credits/checkout-config');
    return res.data;
  },

  getCreditOrders: async (): Promise<CreditOrderListResponse> => {
    const res = await client.get('/credits/orders');
    return res.data;
  },

  placeCreditOrder: async (payload: {
    planId: string;
    paymentMethod: string;
    note: string;
    proofs: File[];
  }): Promise<CreditOrder> => {
    // Multipart, so this bypasses the axios client and re-attaches the headers by
    // hand — same shape as uploadInputImage. Do NOT set Content-Type: the browser
    // has to pick the multipart boundary itself.
    try {
      const formData = new FormData();
      formData.append('plan_id', payload.planId);
      formData.append('payment_method', payload.paymentMethod);
      formData.append('note', payload.note);
      payload.proofs.forEach((file) => formData.append('proofs', file));

      const user = auth.currentUser;
      const headers: Record<string, string> = {
        'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || '',
      };
      if (user) {
        headers.Authorization = `Bearer ${await user.getIdToken()}`;
      }

      const res = await fetch(`${API_BASE}/credits/orders`, {
        method: 'POST',
        headers,
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        const detail = typeof data?.detail === 'string' ? data.detail : 'Could not place this order';
        throw new Error(detail);
      }
      return data;
    } catch (error) {
      if (shouldLogApiError(error)) console.error("Order Error:", error);
      throw normalizeApiError(error);
    }
  },

  createDodoCheckout: async (planId: string): Promise<{ checkoutUrl: string }> => {
    try {
      const res = await client.post('/credits/checkout/dodo', { planId });
      return res.data;
    } catch (error) {
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw error;
    }
  },

  addHistoryEntry: async (payload: {
    imageUrl?: string;
    caption?: string;
    prompt: string;
    model: string;
  }) => {
    const res = await client.post('/history', payload);
    return res.data;
  },

  submitFeedback: async (payload: FeedbackSubmitRequest): Promise<FeedbackItem> => {
    try {
      const res = await client.post('/feedback', payload);
      return res.data;
    } catch (error) {
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw error;
    }
  },

  redeemCode: async (code: string) => {
    try {
      const res = await client.post('/credits/redeem', { code });
      return res.data;
    } catch (error) {
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw error;
    }
  },

  completeAnalyzeSession: async (sessionId: string) => {
    const res = await client.post(`/analyze-sessions/${sessionId}/complete`);
    return res.data;
  },

  abandonAnalyzeSession: async (sessionId: string) => {
    const res = await client.post(`/analyze-sessions/${sessionId}/abandon`);
    return res.data;
  },

  getAdminUsers: async (params?: { q?: string; limit?: number }): Promise<AdminUserListResponse> => {
    const res = await client.get('/admin/users', { params });
    return res.data;
  },

  getAdminModelVisibility: async (): Promise<AdminModelVisibilityResponse> => {
    const res = await client.get('/admin/model-visibility');
    return res.data;
  },

  updateAdminModelVisibility: async (disabledModelIds: string[], disabledProviderIds: string[]): Promise<AdminModelVisibilityResponse> => {
    const res = await client.patch('/admin/model-visibility', { disabledModelIds, disabledProviderIds });
    return res.data;
  },

  suspendAdminUser: async (uid: string, reason: string) => {
    try {
      const res = await client.post(`/admin/users/${uid}/suspend`, { reason });
      return res.data;
    } catch (error) {
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw error;
    }
  },

  unsuspendAdminUser: async (uid: string, reason: string) => {
    try {
      const res = await client.post(`/admin/users/${uid}/unsuspend`, { reason });
      return res.data;
    } catch (error) {
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw error;
    }
  },

  adjustUserCredits: async (uid: string, delta: number, reason = 'admin_adjustment') => {
    const res = await client.post(`/admin/users/${uid}/credits`, { delta, reason });
    return res.data;
  },

  getAdminCodes: async (): Promise<AdminCreditCodeListResponse> => {
    const res = await client.get('/admin/codes');
    return res.data;
  },

  getAdminCodeBatches: async (): Promise<AdminCreditCodeBatchListResponse> => {
    const res = await client.get('/admin/code-batches');
    return res.data;
  },

  getAdminJobs: async (params?: { status?: string; limit?: number }): Promise<AdminGenerationJobListResponse> => {
    const res = await client.get('/admin/jobs', { params });
    return res.data;
  },

  getAdminLogs: async (params?: {
    limit?: number;
    admin_uid?: string;
    action?: string;
    target_type?: string;
    target_id?: string;
  }): Promise<AdminAuditLogListResponse> => {
    const res = await client.get('/admin/logs', { params });
    return res.data;
  },

  getAdminAuthFailureSummaries: async (): Promise<AdminAuthFailureSummaryResponse> => {
    const res = await client.get('/admin/auth-failures');
    return res.data;
  },

  getAdminFeedback: async (status?: FeedbackStatus): Promise<FeedbackListResponse> => {
    const res = await client.get('/admin/feedback', { params: status ? { status } : undefined });
    return res.data;
  },

  updateAdminFeedbackStatus: async (itemId: string, status: FeedbackStatus): Promise<FeedbackItem> => {
    const res = await client.patch(`/admin/feedback/${itemId}`, { status });
    return res.data;
  },

  getAdminCreditOrders: async (status?: CreditOrderStatus): Promise<AdminCreditOrderListResponse> => {
    const res = await client.get('/admin/orders', { params: status ? { status } : undefined });
    return res.data;
  },

  acceptAdminCreditOrder: async (
    orderId: string,
    code: string,
    confirmMismatch = false,
  ): Promise<AdminCreditOrder> => {
    try {
      const res = await client.post(`/admin/orders/${orderId}/accept`, { code, confirmMismatch });
      return res.data;
    } catch (error) {
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw error;
    }
  },

  refuseAdminCreditOrder: async (orderId: string, reason: string): Promise<AdminCreditOrder> => {
    try {
      const res = await client.post(`/admin/orders/${orderId}/refuse`, { reason });
      return res.data;
    } catch (error) {
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw error;
    }
  },

  createAdminCode: async (credits: number, maxClaims: number, validityDays = 0, validityHours = 0) => {
    const res = await client.post('/admin/codes', { credits, maxClaims, validityDays, validityHours });
    return res.data;
  },

  createAdminCodeBatch: async (quantity: number, credits: number, title: string, validityDays = 0, validityHours = 0) => {
    try {
      const res = await client.post('/admin/codes/batch', { quantity, credits, title, validityDays, validityHours });
      return res.data;
    } catch (error) {
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw error;
    }
  },

  disableAdminCode: async (codeHash: string, reason: string) => {
    try {
      const res = await client.post(`/admin/codes/${codeHash}/disable`, { reason });
      return res.data;
    } catch (error) {
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw error;
    }
  },

  enableAdminCode: async (codeHash: string, reason: string) => {
    try {
      const res = await client.post(`/admin/codes/${codeHash}/enable`, { reason });
      return res.data;
    } catch (error) {
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw error;
    }
  },

  disableAdminCodeBatch: async (batchId: string, reason: string) => {
    try {
      const res = await client.post(`/admin/code-batches/${batchId}/disable`, { reason });
      return res.data;
    } catch (error) {
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw error;
    }
  },

  enableAdminCodeBatch: async (batchId: string, reason: string) => {
    try {
      const res = await client.post(`/admin/code-batches/${batchId}/enable`, { reason });
      return res.data;
    } catch (error) {
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw error;
    }
  },

  uploadInputImage: async (file: File): Promise<UploadedImageResult> => {
    try {
      const formData = new FormData();
      formData.append('image', file);
      const user = auth.currentUser;
      const headers: Record<string, string> = {
        'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || '',
      };
      if (user) {
        headers.Authorization = `Bearer ${await user.getIdToken()}`;
      }

      const res = await fetch(`${API_BASE}/uploads/image`, {
        method: 'POST',
        headers,
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        const detail = typeof data?.detail === 'string' ? data.detail : 'Upload failed';
        throw new Error(detail);
      }
      return data;
    } catch (error) {
      if (shouldLogApiError(error)) {
        console.error("Upload Error:", error);
      }
      throw normalizeApiError(error);
    }
  },

  /**
   * Smart content-generation engine.
   * Calls /generate for the create workflow only.
   */
  generate: async (payload: GenerateRequest): Promise<GenerationResult> => {
    try {
      const res = await client.post('/generate', payload);
      return res.data;
    } catch (error) {
      if (shouldLogApiError(error)) {
        console.error("API Error:", error);
      }
      const detail = extractErrorMessage(error);
      if (detail) {
        throw new Error(detail);
      }
      throw normalizeApiError(error);
    }
  },

  // ---- Template / Use-Case Packs ----
  listPacks: async (params?: { sector?: string; lang?: string }): Promise<PackListResponse> => {
    const res = await client.get('/packs', { params });
    return res.data;
  },

  getPack: async (packId: string, lang?: string): Promise<PackDetail> => {
    const res = await client.get(`/packs/${packId}`, { params: lang ? { lang } : undefined });
    return res.data;
  },

  estimatePack: async (
    packId: string,
    body: { slot_values?: Record<string, string>; n?: number; aspect_ratio?: string; has_image?: boolean; model?: string; quality?: string },
  ): Promise<PackEstimate> => {
    const res = await client.post(`/packs/${packId}/estimate`, body);
    return res.data;
  },

  planPack: async (packId: string, body: PackPlanBody): Promise<PackPlanResponse> => {
    try {
      const res = await client.post(`/packs/${packId}/plan`, body);
      return res.data;
    } catch (error) {
      if (shouldLogApiError(error)) {
        console.error('Pack plan error:', error);
      }
      throw normalizeApiError(error);
    }
  },

  // ---- saved studio sessions ----
  listPackSessions: async (packId?: string): Promise<PackSessionMeta[]> => {
    const res = await client.get('/pack-sessions', { params: packId ? { pack_id: packId } : undefined });
    return res.data.sessions ?? [];
  },
  getPackSession: async (id: string): Promise<PackSessionFull> => {
    const res = await client.get(`/pack-sessions/${id}`);
    return res.data;
  },
  createPackSession: async (body: { pack_id: string; variant_id?: string | null; title?: string; data?: PackSessionData }): Promise<PackSessionFull> => {
    const res = await client.post('/pack-sessions', body);
    return res.data;
  },
  updatePackSession: async (id: string, body: { title?: string; data?: PackSessionData }): Promise<PackSessionFull> => {
    const res = await client.patch(`/pack-sessions/${id}`, body);
    return res.data;
  },
  deletePackSession: async (id: string): Promise<void> => {
    await client.delete(`/pack-sessions/${id}`);
  },

  generatePack: async (packId: string, body: PackGenerateBody): Promise<PackGenerateResponse> => {
    try {
      const res = await client.post(`/packs/${packId}/generate`, body);
      return res.data;
    } catch (error) {
      if (shouldLogApiError(error)) {
        console.error('Pack generate error:', error);
      }
      throw normalizeApiError(error);
    }
  },
};
