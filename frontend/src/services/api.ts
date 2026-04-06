// frontend/src/services/api.ts
import axios from 'axios';
import { GenerateRequest, GenerationResult, SystemConfig } from '../types';
import { auth } from '../lib/firebase';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

// Create axios instance with default headers
const client = axios.create({
  baseURL: API_BASE,
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
  return config;
});

export const api = {
  /**
   * Fetches the valid models and options (for the "Cold Start" UI)
   */
  getConfig: async (): Promise<SystemConfig> => {
    const res = await client.get('/config');
    return res.data;
  },

  getProfile: async () => {
    const res = await client.get('/me');
    return res.data;
  },

  getHistory: async (limit = 20) => {
    const res = await client.get('/history', { params: { limit } });
    return res.data;
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
    const res = await client.post('/credits/redeem', { code });
    return res.data;
  },

  completeAnalyzeSession: async (sessionId: string) => {
    const res = await client.post(`/analyze-sessions/${sessionId}/complete`);
    return res.data;
  },

  abandonAnalyzeSession: async (sessionId: string) => {
    const res = await client.post(`/analyze-sessions/${sessionId}/abandon`);
    return res.data;
  },

  getAdminUsers: async () => {
    const res = await client.get('/admin/users');
    return res.data;
  },

  adjustUserCredits: async (uid: string, delta: number, reason = 'admin_adjustment') => {
    const res = await client.post(`/admin/users/${uid}/credits`, { delta, reason });
    return res.data;
  },

  getAdminCodes: async () => {
    const res = await client.get('/admin/codes');
    return res.data;
  },

  createAdminCode: async (credits: number, maxClaims: number) => {
    const res = await client.post('/admin/codes', { credits, maxClaims });
    return res.data;
  },

  /**
   * The Main Engine. 
   * Calls /generate. 
   * Handles both "Analyze" (Step 1) and "Execute" (Step 2).
   */
  generate: async (payload: GenerateRequest): Promise<GenerationResult> => {
    try {
      const res = await client.post('/generate', payload);
      return res.data;
    } catch (error) {
      console.error("API Error:", error);
      if (axios.isAxiosError(error)) {
        const detail = typeof error.response?.data?.detail === 'string'
          ? error.response?.data?.detail
          : undefined;
        if (detail) {
          throw new Error(detail);
        }
      }
      throw error;
    }
  }
};
