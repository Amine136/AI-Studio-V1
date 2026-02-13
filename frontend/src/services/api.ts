// frontend/src/services/api.ts
import axios from 'axios';
import { GenerateRequest, GenerationResult } from '../types';

const API_BASE = 'http://127.0.0.1:8000';

// Create axios instance with default headers
const client = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || '',
  },
});

export const api = {
  /**
   * Fetches the valid models and options (for the "Cold Start" UI)
   */
  getConfig: async () => {
    const res = await client.get('/config');
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
      throw error;
    }
  }
};