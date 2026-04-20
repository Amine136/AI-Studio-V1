// frontend/src/services/api.ts
import axios from 'axios';
import {
  AdminSession,
  AdminAuditLogListResponse,
  AdminAuthFailureSummaryResponse,
  AdminCreditCodeBatchListResponse,
  AdminCreditCodeListResponse,
  AdminGenerationJobListResponse,
  AdminUserListResponse,
  GenerateRequest,
  GenerationResult,
  PlainChatConversationCreateRequest,
  PlainChatConversationItem,
  PlainChatConversationListResponse,
  PlainChatConversationMessageCreateRequest,
  PlainChatConversationMessagesResponse,
  PlainChatConversationTurnResponse,
  PlainChatModelListResponse,
  SystemConfig,
  UploadedImageResult,
} from '../types';
import { auth } from '../lib/firebase';
import { getAdminCsrfToken, isAdminHost } from '../lib/admin';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

// Create axios instance with default headers
const client = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || '',
  },
});

client.interceptors.request.use(async (config) => {
  const user = auth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
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

  const payload = error.response?.data;
  if (typeof payload?.detail === 'string') return payload.detail;
  if (typeof payload?.message === 'string') return payload.message;
  if (typeof payload?.error === 'string') return payload.error;
  if (typeof payload?.meta?.error_message === 'string') return payload.meta.error_message;
  return undefined;
}

function shouldLogApiError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return true;
  const status = error.response?.status;
  return status !== 401 && status !== 403 && status !== 429;
}

export const api = {
  adminLogin: async (username: string, password: string): Promise<AdminSession> => {
    try {
      const res = await client.post('/admin-auth/login', { username, password });
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
    const res = await client.post('/admin-auth/logout');
    return res.data;
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

  getProfile: async () => {
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

  addHistoryEntry: async (payload: {
    imageUrl?: string;
    caption?: string;
    prompt: string;
    model: string;
  }) => {
    const res = await client.post('/history', payload);
    return res.data;
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

  createAdminCode: async (credits: number, maxClaims: number) => {
    const res = await client.post('/admin/codes', { credits, maxClaims });
    return res.data;
  },

  createAdminCodeBatch: async (quantity: number, credits: number, title: string) => {
    try {
      const res = await client.post('/admin/codes/batch', { quantity, credits, title });
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
      throw error;
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
      throw error;
    }
  }
};
