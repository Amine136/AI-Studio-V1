// Shared expected-latency budgets (seconds) for image generation, used to pace
// the chat waiting timer AND to surface an "expected time" next to prices.
//
// Derived from real staging latency (generation_jobs, completed text→image jobs
// with no input images and no caption request — the true chat-equivalent slice)
// at the ~p50 MEDIAN, i.e. the TYPICAL wait. The countdown should target the
// expected time, not a near-worst-case: anchoring at p90 (as this table did
// originally) made every estimate run 9-20s long, because a median generation
// finishes well before a p90 clock reaches zero — past the estimate the UI
// already switches to a graceful "overtime" state, so a median anchor is the
// honest target. `default` covers models with no quality param or an unlisted
// quality value; `byQuality` keys are the uppercased quality/size token (e.g.
// "1K", "4K", "LOW", "512"). Models the admin adds later without an entry fall
// back to the global median. Re-measured from staging 2026-07-02; sparse models
// keep quality-step scaling. See memory `vibecraft-chat-latency-timer`.

export const LATENCY_FALLBACK_SECONDS = 18;

export const MODEL_LATENCY_BUDGETS: Record<string, { default: number; byQuality?: Record<string, number> }> = {
  // p50: (none)=12, 1K=20, 2K=33 measured; 512 scaled below 1K.
  "gemini-3.1-flash-image-preview": { default: 20, byQuality: { "512": 12, "1K": 20, "2K": 33 } },
  // No chat samples for pro; scaled ~15% down from the old p90 guess to match the
  // flash correction until we have data.
  "gemini-3-pro-image-preview": { default: 22, byQuality: { "1K": 26, "4K": 44 } },
  "gemini-2.5-flash-image": { default: 20 }, // p50 20 (n=29)
  // gpt-image is genuinely slow: measured p50 for LOW sits ~22-30s (edit+chat
  // rows), so these are left near their observed values rather than cut — they
  // were NOT the source of the overshoot.
  "gpt-image-2": { default: 28, byQuality: { LOW: 22, MEDIUM: 30, HIGH: 45 } },
  "gpt-image-1.5": { default: 25, byQuality: { LOW: 20, MEDIUM: 25, HIGH: 33 } },
  "gpt-image-1-mini": { default: 22, byQuality: { LOW: 22, MEDIUM: 24, HIGH: 30 } }, // LOW p50 20
  "imagen-4.0-fast-generate-001": { default: 11 }, // p50 10
  "imagen-4.0-generate-001": { default: 24 }, // p50 23
  "imagen-4.0-ultra-generate-001": { default: 17 }, // p50 16
  "grok-imagine-image": { default: 11 }, // p50 10
  "grok-imagine-image-quality": { default: 9 },
  "ideogram-v3-generate": { default: 10 },
};

// Expected end-to-end seconds for a model at an (optional) quality/size token.
export function latencyBudgetForModel(
  modelId: string | null | undefined,
  qualityToken?: string | number | null,
): number {
  if (!modelId) return LATENCY_FALLBACK_SECONDS;
  const entry = MODEL_LATENCY_BUDGETS[modelId];
  if (!entry) return LATENCY_FALLBACK_SECONDS;
  if (entry.byQuality && qualityToken != null) {
    // Normalise: uppercase, and drop a leading "SAMPLE " prefix used by some
    // pricing rows (e.g. "Sample 1K" -> "1K").
    const token = String(qualityToken).trim().toUpperCase().replace(/^SAMPLE\s+/, "");
    const match = entry.byQuality[token];
    if (match != null) return match;
  }
  return entry.default;
}

// Whether we have a real (non-fallback) budget for this model — lets callers hide
// the estimate for models we haven't measured yet rather than show a guess.
export function hasLatencyBudget(modelId: string | null | undefined): boolean {
  return Boolean(modelId && MODEL_LATENCY_BUDGETS[modelId]);
}

// Short human label, e.g. 18 -> "~18s", 75 -> "~1m15s".
export function formatLatencyEstimate(seconds: number): string {
  if (seconds < 60) return `~${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s === 0 ? `~${m}m` : `~${m}m${s}s`;
}
