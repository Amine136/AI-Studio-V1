/**
 * Per-model input-image rules for the Studio upload UI.
 *
 * Mirrors the authoritative guardrail in the ApiKeyManager gateway
 * (backend/src/lib/image-constraints.ts) so the front-end can stop bad uploads
 * at the source — before they are attached, normalized, or sent — instead of
 * surfacing a provider 400 after the fact. The gateway remains the hard
 * backstop; this is the friendly first line of defence.
 */

export interface UploadImageConstraints {
    /** Max input images per message. */
    maxImages: number;
    /** Reject uploads whose shortest side is below this (px). */
    minDim: number;
    /** Output MIME types the provider accepts (we re-encode into one of these). */
    formats: string[];
}

const DEFAULTS: UploadImageConstraints = {
    maxImages: 3,
    minDim: 16,
    formats: ["image/png", "image/jpeg", "image/webp"],
};

// Keyed by provider type. Every image-capable provider caps at 3 per message
// except Recraft, whose image-to-image endpoint takes a single source image.
const BY_PROVIDER: Record<string, Partial<UploadImageConstraints>> = {
    recraft: { maxImages: 1, minDim: 256, formats: ["image/png", "image/jpeg"] },
    grok: { maxImages: 3, minDim: 64, formats: ["image/png", "image/jpeg"] },
    "google-gemini": { maxImages: 3, minDim: 32, formats: ["image/png", "image/jpeg", "image/webp"] },
    openai: { maxImages: 3, minDim: 32, formats: ["image/png", "image/jpeg", "image/webp"] },
    anthropic: { maxImages: 3, minDim: 16, formats: ["image/png", "image/jpeg", "image/webp", "image/gif"] },
    ideogram: { maxImages: 3, minDim: 64, formats: ["image/png", "image/jpeg"] },
};

/** Friendly provider name for user-facing messages. */
const PROVIDER_LABELS: Record<string, string> = {
    recraft: "Recraft",
    grok: "Grok",
    "google-gemini": "Gemini",
    openai: "OpenAI",
    anthropic: "Claude",
    ideogram: "Ideogram",
    "google-imagen": "Imagen",
};

/** Infer the provider type from a model id (matches the AKM's inference). */
export function providerTypeForModelId(modelId?: string | null): string {
    const id = (modelId || "").trim().toLowerCase();
    if (id.startsWith("recraft")) return "recraft";
    if (id.startsWith("grok")) return "grok";
    if (id.startsWith("gemini")) return "google-gemini";
    if (id.startsWith("gpt-image") || id.startsWith("gpt-") || id.startsWith("dall")) return "openai";
    if (id.startsWith("imagen")) return "google-imagen";
    if (id.startsWith("ideogram")) return "ideogram";
    if (id.startsWith("claude")) return "anthropic";
    return "default";
}

export function getUploadConstraints(modelId?: string | null): UploadImageConstraints {
    return { ...DEFAULTS, ...(BY_PROVIDER[providerTypeForModelId(modelId)] ?? {}) };
}

export function maxInputImagesForModelId(modelId?: string | null): number {
    return getUploadConstraints(modelId).maxImages;
}

export function providerLabelForModelId(modelId?: string | null): string {
    return PROVIDER_LABELS[providerTypeForModelId(modelId)] ?? "This model";
}

/**
 * Choose the MIME type to re-encode into so the output satisfies the model.
 * Keeps an already-accepted JPEG/WebP as-is; PNG (and any disallowed format)
 * is converted — to WebP when allowed (smallest), otherwise JPEG.
 */
export function preferredOutputType(originalType: string, formats: string[]): string {
    if (originalType !== "image/png" && formats.includes(originalType)) return originalType;
    if (formats.includes("image/webp")) return "image/webp";
    return "image/jpeg";
}

/** Read an image file's natural pixel dimensions in the browser. */
export function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const dims = { width: img.naturalWidth, height: img.naturalHeight };
            URL.revokeObjectURL(url);
            resolve(dims);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Could not read the image."));
        };
        img.src = url;
    });
}
