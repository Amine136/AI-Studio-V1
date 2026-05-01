// frontend/src/app/page.tsx
"use client";

import { useState, useEffect, useRef, useMemo, useCallback, type ChangeEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../../services/api";
import { GenerateRequest, GenerationMeta, UISchemaItem, OutputType, ModelCatalogEntry, PlainChatParameterSchemaEntry, SystemConfig } from "../../../types";
import { useAuth } from "../../../context/AuthContext";

import StepIndicator from "../../../components/StepIndicator";
import ReviewCard from "../../../components/ReviewCard";
import ResultCard from "../../../components/ResultCard";
import LoadingSpinner from "../../../components/LoadingSpinner";
import CreditsDisplay from "../../../components/CreditsDisplay";
import InteractiveAuthenticatedImage from "../../../components/InteractiveAuthenticatedImage";
import type { CreditsDisplayHandle } from "../../../components/CreditsDisplay";
import { addHistoryEntry } from "../../../lib/history";

type Step = "INPUT" | "REVIEW" | "RESULT";

interface Toast {
  message: string;
  type: "error" | "success";
}

interface UploadedImageState {
  fileId: string;
  name: string;
  mimeType: string;
  url: string;
  previewUrl: string;
  size: number;
  originalSize: number;
}

interface SuspensionState {
  reason: string;
  endsAt: string | null;
  endsAtLabel: string | null;
}

type ParameterValue = string | number | boolean;
type ParameterState = Record<string, ParameterValue>;
type OutputParameterValues = Record<OutputType, ParameterState>;

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_PROXY_IMAGE_DIMENSION = 1536;
const MAX_PROXY_IMAGE_BYTES = 1_800_000;

function isRenderableImageUrl(value?: string): boolean {
  if (!value) return false;
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/");
}

function getParameterStep(entry: PlainChatParameterSchemaEntry) {
  return entry.type === "integer" ? 1 : 0.01;
}

function getNumericBounds(entry: PlainChatParameterSchemaEntry) {
  const fallbackMin = 0;
  const fallbackMax = fallbackMin + 100;
  const step = getParameterStep(entry);
  const epsilon = step;

  const rawMin = typeof entry.min === "number"
    ? entry.min
    : typeof entry.minExclusive === "number"
      ? entry.minExclusive + epsilon
      : fallbackMin;

  const rawMax = typeof entry.max === "number"
    ? entry.max
    : typeof entry.maxExclusive === "number"
      ? entry.maxExclusive - epsilon
      : rawMin + 100;

  const min = Number(rawMin.toFixed(entry.type === "integer" ? 0 : 2));
  const max = Number(Math.max(rawMax, rawMin).toFixed(entry.type === "integer" ? 0 : 2));
  return { min, max };
}

function getDefaultParameterValue(entry: PlainChatParameterSchemaEntry): ParameterValue | null {
  if (entry.recommendedDefault !== undefined) {
    return entry.recommendedDefault;
  }
  if (entry.value !== undefined) {
    return entry.value;
  }
  return null;
}

function isParameterValueCompatible(entry: PlainChatParameterSchemaEntry, value: ParameterValue | undefined) {
  if (value === undefined) return false;

  if (entry.type === "boolean") {
    return typeof value === "boolean";
  }

  if (entry.type === "enum") {
    return (typeof value === "string" || typeof value === "number")
      && Array.isArray(entry.values)
      && entry.values.some((option) => String(option) === String(value));
  }

  if (entry.type === "float" || entry.type === "integer") {
    if (typeof value !== "number" || Number.isNaN(value)) return false;
    const { min, max } = getNumericBounds(entry);
    return value >= min && value <= max;
  }

  return false;
}

function isRenderableParameterEntry(entry: PlainChatParameterSchemaEntry) {
  return entry.type === "enum" || entry.type === "boolean" || entry.type === "float" || entry.type === "integer";
}

function getVisibleModelParameters(schema?: Record<string, PlainChatParameterSchemaEntry>) {
  return Object.entries(schema || {})
    .filter(([key, entry]) => key !== "modelId" && typeof entry === "object" && entry !== null && isRenderableParameterEntry(entry))
    .sort(([a], [b]) => a.localeCompare(b));
}

function getCreateVisibleModelParameters(
  schema: Record<string, PlainChatParameterSchemaEntry> | undefined,
  category: "image" | "text",
) {
  return getVisibleModelParameters(schema).filter(([, entry]) => entry.createFlowCategory === category);
}

function createParameterState(schema?: Record<string, PlainChatParameterSchemaEntry>): ParameterState {
  return getVisibleModelParameters(schema).reduce<ParameterState>((acc, [key, entry]) => {
    const defaultValue = getDefaultParameterValue(entry);
    if (defaultValue !== null) {
      acc[key] = defaultValue;
    }
    return acc;
  }, {});
}

function syncParameterState(
  schema?: Record<string, PlainChatParameterSchemaEntry>,
  previous?: ParameterState,
): ParameterState {
  const defaults = createParameterState(schema);
  const next = { ...defaults };

  for (const [key, entry] of getVisibleModelParameters(schema)) {
    const previousValue = previous?.[key];
    if (isParameterValueCompatible(entry, previousValue)) {
      next[key] = previousValue as ParameterValue;
    }
  }

  return next;
}

function getSchemaDisplayDefault(
  schema: Record<string, PlainChatParameterSchemaEntry> | undefined,
  key: string,
): string | null {
  const entry = schema?.[key];
  if (!entry) return null;
  const value = getDefaultParameterValue(entry);
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function formatParameterLabel(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getModelMinimumCost(model?: ModelCatalogEntry) {
  const minimum = model?.pricing?.minimum;
  if (typeof minimum === "number" && Number.isFinite(minimum)) {
    return minimum;
  }
  return 0;
}

function formatExpectedPricing(model?: ModelCatalogEntry) {
  const expected = model?.pricing?.expected;
  if (typeof expected === "number") {
    return `${expected.toFixed(2)} credits`;
  }
  if (!expected || typeof expected !== "object") {
    const minimum = getModelMinimumCost(model);
    return minimum > 0 ? `${minimum.toFixed(2)} credits` : "Usage-based";
  }

  const parts: string[] = [];
  const imageSizePrices = expected.imageSizePrices;
  if (imageSizePrices && typeof imageSizePrices === "object") {
    for (const [label, value] of Object.entries(imageSizePrices)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        parts.push(`${label} ${value.toFixed(2)}`);
      }
    }
  }
  const sampleImageSizePrices = expected.sampleImageSizePrices;
  if (sampleImageSizePrices && typeof sampleImageSizePrices === "object") {
    for (const [label, value] of Object.entries(sampleImageSizePrices)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        parts.push(`${label} ${value.toFixed(2)}`);
      }
    }
  }
  if (parts.length > 0) {
    return parts.join(" · ");
  }
  if (typeof expected.amount === "number" && Number.isFinite(expected.amount)) {
    return `${expected.amount.toFixed(2)} credits`;
  }
  if (typeof expected.basePrice === "number" && Number.isFinite(expected.basePrice)) {
    return `from ${expected.basePrice.toFixed(2)} credits`;
  }
  return "Usage-based";
}

function normalizePricingOptionKey(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const lowered = raw.toLowerCase().replace(/\s+/g, "");
  if (lowered === "512" || lowered === "0.5k" || lowered === "512px") return "0.5k";
  if (lowered === "1024" || lowered === "1k" || lowered === "1024px") return "1k";
  if (lowered === "2048" || lowered === "2k" || lowered === "2048px") return "2k";
  if (lowered === "4096" || lowered === "4k" || lowered === "4096px") return "4k";
  return lowered;
}

function resolveExpectedVariantPrice(priceMap: Record<string, number> | undefined, value: unknown) {
  if (!priceMap || typeof priceMap !== "object") return null;
  const target = normalizePricingOptionKey(value);
  if (!target) return null;
  for (const [key, price] of Object.entries(priceMap)) {
    if (normalizePricingOptionKey(key) === target && typeof price === "number" && Number.isFinite(price)) {
      return price;
    }
  }
  return null;
}

function getExpectedModelCost(
  model: ModelCatalogEntry | undefined,
  task: OutputType,
  values?: ParameterState,
) {
  const expected = model?.pricing?.expected;
  if (typeof expected === "number" && Number.isFinite(expected)) {
    return expected;
  }
  if (!expected || typeof expected !== "object") {
    return getModelMinimumCost(model);
  }
  if (typeof expected.amount === "number" && Number.isFinite(expected.amount)) {
    return expected.amount;
  }
  if (task === "image") {
    const sampleImageVariant = resolveExpectedVariantPrice(expected.sampleImageSizePrices, values?.sampleImageSize);
    if (sampleImageVariant !== null) return sampleImageVariant;
    const imageVariant = resolveExpectedVariantPrice(expected.imageSizePrices, values?.imageSize);
    if (imageVariant !== null) return imageVariant;
    if (typeof expected.basePrice === "number" && Number.isFinite(expected.basePrice)) {
      return expected.basePrice;
    }
  }
  return getModelMinimumCost(model);
}

function toResolvedCostNumber(value: string | number | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatBillingComponentLabel(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatSuspensionEndsAt(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

function parseSuspensionState(message: string): SuspensionState | null {
  if (!message.toLowerCase().includes("your account is suspended")) {
    return null;
  }

  const endsAtMatch = message.match(/Suspension ends at\s+([^.]+)\./i);
  const endsAt = endsAtMatch?.[1]?.trim() || null;
  const reasonText = message
    .replace(/^Your account is suspended:\s*/i, "")
    .replace(/^Your account is suspended\.?\s*/i, "")
    .replace(/\s*Suspension ends at\s+([^.]+)\./i, "")
    .trim();

  return {
    reason: reasonText || "Access to this account has been restricted.",
    endsAt,
    endsAtLabel: endsAt ? formatSuspensionEndsAt(endsAt) : null,
  };
}

function isGeminiTextModel(model?: ModelCatalogEntry) {
  if (!model || model.provider !== "google-gemini") return false;
  const outputModalities = new Set(model.output_modalities || []);
  return outputModalities.has("TEXT");
}

function parseRequestedOutputs(value: string | null): OutputType[] | null {
  if (!value) return null;
  const outputs = value
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is OutputType => item === "caption" || item === "image");

  if (outputs.length === 0) return null;
  return Array.from(new Set(outputs));
}

function isGeminiTextOnlyModel(model?: ModelCatalogEntry) {
  if (!model || model.provider !== "google-gemini") return false;
  const outputModalities = new Set(model.output_modalities || []);
  return outputModalities.has("TEXT") && !outputModalities.has("IMAGE");
}

function isGeminiImageModel(model?: ModelCatalogEntry) {
  return model?.provider === "google-gemini" && model?.type === "gemini-image";
}

function isImageCapableModel(model?: ModelCatalogEntry) {
  const outputModalities = new Set(model?.output_modalities || []);
  return outputModalities.has("IMAGE");
}

function loadImageFromUrl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode the selected image."));
    image.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not encode the selected image."));
        return;
      }
      resolve(blob);
    }, mimeType, quality);
  });
}

async function normalizeUploadImage(file: File): Promise<File> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageFromUrl(objectUrl);
    const scale = Math.min(1, MAX_PROXY_IMAGE_DIMENSION / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      return file;
    }
    context.drawImage(image, 0, 0, width, height);

    const shouldReencode = scale < 1 || file.size > MAX_PROXY_IMAGE_BYTES || file.type === "image/png";
    if (!shouldReencode) {
      return file;
    }

    const outputType = file.type === "image/png" ? "image/webp" : file.type;
    let quality = outputType === "image/webp" ? 0.86 : 0.82;
    let blob = await canvasToBlob(canvas, outputType, quality);

    while (blob.size > MAX_PROXY_IMAGE_BYTES && quality && quality > 0.5) {
      quality -= 0.08;
      blob = await canvasToBlob(canvas, outputType, quality);
    }

    if (blob.size >= file.size) {
      return file;
    }

    const nextName = file.name.replace(/\.(png|jpg|jpeg|webp)$/i, outputType === "image/webp" ? ".webp" : "$&");
    return new File([blob], nextName, { type: outputType });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const selectedMode = "smart" as const;
  const creditsRef = useRef<CreditsDisplayHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasAppliedTemplatePrefill = useRef(false);

  // --- Auth Gate ---
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/auth");
    }
  }, [authLoading, user, router]);

  // --- State ---
  const [step, setStep] = useState<Step>("INPUT");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [isModePickerOpen, setIsModePickerOpen] = useState(false);

  // Input State
  const [userText, setUserText] = useState("");
  const [selectedOutputs, setSelectedOutputs] = useState<OutputType[]>(["caption", "image"]);

  // Model Selections
  const [selectedImageModel, setSelectedImageModel] = useState("");
  const [selectedCaptionModel, setSelectedCaptionModel] = useState("");
  const [draftImageModel, setDraftImageModel] = useState("");
  const [draftCaptionModel, setDraftCaptionModel] = useState("");

  // Model Catalog (with costs)
  const [modelCatalog, setModelCatalog] = useState<Record<string, Record<string, ModelCatalogEntry>>>({});
  const [smartAnalysisFee, setSmartAnalysisFee] = useState<number>(0.05);
  const [inputImage, setInputImage] = useState<UploadedImageState | null>(null);

  // Current credit balance (synced from CreditsDisplay)
  const [currentCredits, setCurrentCredits] = useState<number | null>(null);

  // Review & Result State
  const [uiSchema, setUiSchema] = useState<Record<string, Record<string, UISchemaItem>>>({});
  const [finalResults, setFinalResults] = useState<Record<string, string>>({});
  const [finalMeta, setFinalMeta] = useState<GenerationMeta | null>(null);
  const [contentPrompts, setContentPrompts] = useState<Record<string, string>>({});
  const [modelParameterValues, setModelParameterValues] = useState<OutputParameterValues>({ image: {}, caption: {} });
  const [hoveredLockedOption, setHoveredLockedOption] = useState<string | null>(null);
  const [pendingAnalyzeSessionId, setPendingAnalyzeSessionId] = useState<string | null>(null);
  const [analyzeAbandonFee, setAnalyzeAbandonFee] = useState<number>(0);
  const pendingAnalyzeSessionRef = useRef<string | null>(null);
  const analyzeFeeRef = useRef<number>(0);
  const analyzeFinalizedRef = useRef(false);

  // History State
  const [accountReady, setAccountReady] = useState(false);
  const [suspension, setSuspension] = useState<SuspensionState | null>(null);

  // --- Toast helper ---
  const showToast = (message: string, type: "error" | "success" = "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const getErrorMessage = (error: unknown, fallback: string) => {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return fallback;
  };

  const captureSuspension = useCallback((error: unknown): boolean => {
    if (!(error instanceof Error)) return false;
    const nextSuspension = parseSuspensionState(error.message);
    if (!nextSuspension) return false;
    setSuspension(nextSuspension);
    setStep("INPUT");
    setLoading(false);
    return true;
  }, []);

  const handleSuspensionMessage = useCallback((message: string) => {
    const nextSuspension = parseSuspensionState(message);
    if (!nextSuspension) return;
    setSuspension(nextSuspension);
    setStep("INPUT");
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user) {
      setAccountReady(false);
      setSuspension(null);
      return;
    }

    let cancelled = false;

    api.getProfile()
      .then(() => {
        if (cancelled) return;
        setSuspension(null);
        setAccountReady(true);
      })
      .catch((error) => {
        if (cancelled) return;
        if (captureSuspension(error)) {
          setAccountReady(true);
          return;
        }
        showToast(getErrorMessage(error, "Could not load your account."));
        setAccountReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [user, captureSuspension]);

  const applyConfig = useCallback((cfg: SystemConfig) => {
    const nextCatalog = cfg.model_catalog || {};
    setModelCatalog(nextCatalog);
    setSmartAnalysisFee(Number((cfg.smart_analysis_fee ?? 0.05).toFixed(2)));

    const nextImageModels = Object.keys(nextCatalog.image || {});
    const nextCaptionModels = Object.keys(nextCatalog.caption || {});

    setSelectedImageModel((prev) => (
      prev && nextImageModels.includes(prev) ? prev : (nextImageModels[0] || "")
    ));
    setSelectedCaptionModel((prev) => (
      prev && nextCaptionModels.includes(prev) ? prev : (nextCaptionModels[0] || "")
    ));

    return {
      imageModels: nextImageModels,
      captionModels: nextCaptionModels,
    };
  }, []);

  const refreshConfig = useCallback(async () => {
    const cfg = await api.getConfig();
    return applyConfig(cfg);
  }, [applyConfig]);

  // --- Load Config on Mount ---
  useEffect(() => {
    if (!accountReady || suspension) {
      return;
    }
    refreshConfig().catch((error) => {
      if (captureSuspension(error)) {
        return;
      }
      showToast("Could not load configuration. Is the backend running?");
    });
  }, [accountReady, suspension, refreshConfig, captureSuspension]);

  useEffect(() => {
    return () => {
      if (inputImage?.previewUrl) {
        URL.revokeObjectURL(inputImage.previewUrl);
      }
    };
  }, [inputImage]);

  useEffect(() => {
    if (hasAppliedTemplatePrefill.current) return;

    const idea = searchParams.get("idea");
    const requestedOutputs = parseRequestedOutputs(searchParams.get("outputs"));

    if (!idea && !requestedOutputs) {
      hasAppliedTemplatePrefill.current = true;
      return;
    }

    if (idea) {
      setUserText(idea);
    }
    if (requestedOutputs) {
      setSelectedOutputs(requestedOutputs);
    }

    hasAppliedTemplatePrefill.current = true;
  }, [searchParams]);

  useEffect(() => {
    pendingAnalyzeSessionRef.current = pendingAnalyzeSessionId;
  }, [pendingAnalyzeSessionId]);

  useEffect(() => {
    analyzeFeeRef.current = analyzeAbandonFee;
  }, [analyzeAbandonFee]);

  const clearAnalyzeSession = useCallback(() => {
    analyzeFinalizedRef.current = true;
    pendingAnalyzeSessionRef.current = null;
    setPendingAnalyzeSessionId(null);
    setAnalyzeAbandonFee(0);
  }, []);

  const abandonAnalyzeSession = useCallback(async (keepalive = false) => {
    const sessionId = pendingAnalyzeSessionRef.current;
    if (!sessionId || analyzeFinalizedRef.current) return;
    analyzeFinalizedRef.current = true;
    const publicApiBase = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

    if (keepalive && typeof window !== "undefined" && user) {
      const token = await user.getIdToken();
      fetch(`${publicApiBase}/analyze-sessions/${sessionId}/abandon`, {
        method: "POST",
        keepalive: true,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }).catch(() => {});
    } else {
      await api.abandonAnalyzeSession(sessionId);
      creditsRef.current?.refresh();
    }

    pendingAnalyzeSessionRef.current = null;
    setPendingAnalyzeSessionId(null);
    setAnalyzeAbandonFee(0);
  }, [user]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (step !== "REVIEW" || !pendingAnalyzeSessionRef.current || analyzeFinalizedRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };

    const handlePageHide = () => {
      if (step !== "REVIEW" || !pendingAnalyzeSessionRef.current || analyzeFinalizedRef.current) return;
      void abandonAnalyzeSession(true);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [step, abandonAnalyzeSession]);

  const selectedCaptionModelEntry = selectedCaptionModel ? modelCatalog.caption?.[selectedCaptionModel] : undefined;
  const selectedImageModelEntry = selectedImageModel ? modelCatalog.image?.[selectedImageModel] : undefined;
  const draftCaptionModelEntry = draftCaptionModel ? modelCatalog.caption?.[draftCaptionModel] : undefined;
  const draftImageModelEntry = draftImageModel ? modelCatalog.image?.[draftImageModel] : undefined;
  const selectedCaptionParameterSchema = useMemo(
    () => selectedCaptionModelEntry?.parameterSchema || {},
    [selectedCaptionModelEntry],
  );
  const selectedImageParameterSchema = useMemo(
    () => selectedImageModelEntry?.parameterSchema || {},
    [selectedImageModelEntry],
  );
  const actualChargedCost = Number((finalMeta?.charged_cost ?? finalMeta?.total_cost ?? 0).toFixed(6));
  const billingComponents = Array.isArray(finalMeta?.billing_components) ? finalMeta.billing_components : [];
  const totalTokensUsed = billingComponents.reduce((sum, component) => {
    const usage = (component?.usage || {}) as Record<string, any>;
    const total = Number(usage.totalTokens || 0);
    if (total > 0) return sum + total;
    return sum + Number(usage.promptTokens || 0) + Number(usage.completionTokens || 0);
  }, 0);
  const resultSettings = (finalMeta?.settings_used || {}) as Record<string, any>;
  const imageSettings = (resultSettings.image || {}) as Record<string, any>;
  const captionSettings = (resultSettings.caption || {}) as Record<string, any>;
  const selectedCaptionMinimumCost = selectedOutputs.includes("caption") ? getModelMinimumCost(selectedCaptionModelEntry) : 0;
  const selectedImageMinimumCost = selectedOutputs.includes("image") ? getModelMinimumCost(selectedImageModelEntry) : 0;
  const minimumRequiredCredits = Number((smartAnalysisFee + selectedCaptionMinimumCost + selectedImageMinimumCost).toFixed(2));
  const insufficientSmartCredits = currentCredits !== null && currentCredits < minimumRequiredCredits;
  const insufficientCredits = currentCredits !== null && currentCredits < minimumRequiredCredits;
  const draftCaptionMinimumCost = selectedOutputs.includes("caption") ? getModelMinimumCost(draftCaptionModelEntry) : 0;
  const draftImageMinimumCost = selectedOutputs.includes("image") ? getModelMinimumCost(draftImageModelEntry) : 0;
  const draftMinimumRequiredCredits = Number((smartAnalysisFee + draftCaptionMinimumCost + draftImageMinimumCost).toFixed(2));
  const insufficientDraftSmartCredits = currentCredits !== null && currentCredits < draftMinimumRequiredCredits;
  const missingRequiredModel =
    (selectedOutputs.includes("caption") && !selectedCaptionModel) ||
    (selectedOutputs.includes("image") && !selectedImageModel);
  const usesSharedNanoBanana = Boolean(inputImage && selectedOutputs.includes("caption") && selectedOutputs.includes("image"));
  const primaryEngineLabel = usesSharedNanoBanana && selectedImageModelEntry
    ? selectedImageModelEntry.display_name || selectedImageModel
    : (selectedImageModelEntry?.display_name || selectedCaptionModelEntry?.display_name || selectedImageModel || selectedCaptionModel || "Smart Pipeline");
  const aspectRatioValue = String(
    modelParameterValues.image.aspectRatio
    || imageSettings.aspectRatio
    || imageSettings.aspect_ratio
    || getSchemaDisplayDefault(selectedImageParameterSchema, "aspectRatio")
    || "1:1"
  );
  const resolutionValue = String(
    modelParameterValues.image.sampleImageSize
    || modelParameterValues.image.imageSize
    || imageSettings.sampleImageSize
    || imageSettings.imageSize
    || imageSettings.image_size
    || modelParameterValues.image.mediaResolution
    || getSchemaDisplayDefault(selectedImageParameterSchema, "sampleImageSize")
    || getSchemaDisplayDefault(selectedImageParameterSchema, "imageSize")
    || getSchemaDisplayDefault(selectedImageParameterSchema, "mediaResolution")
    || "1K"
  );
  const seedValue = String(
    modelParameterValues.image.seed
    || imageSettings.seed
    || getSchemaDisplayDefault(selectedImageParameterSchema, "seed")
    || "Random"
  );

  const filteredCaptionModels = useMemo(() => {
    const entries = modelCatalog.caption || {};
    return Object.entries(entries)
      .filter(([, model]) => {
        const wantsImageOutput = selectedOutputs.includes("image");
        if (inputImage && wantsImageOutput) {
          return isGeminiImageModel(model);
        }
        if (wantsImageOutput) {
          return isGeminiTextModel(model);
        }
        return isGeminiTextOnlyModel(model);
      })
      .map(([id]) => id);
  }, [inputImage, modelCatalog, selectedOutputs]);

  const filteredImageModels = useMemo(() => {
    const entries = modelCatalog.image || {};
    return Object.entries(entries)
      .filter(([, model]) => {
        if (!selectedOutputs.includes("image")) {
          return false;
        }
        if (inputImage) {
          return isGeminiImageModel(model);
        }
        return isImageCapableModel(model);
      })
      .map(([id]) => id);
  }, [inputImage, modelCatalog, selectedOutputs]);

  const sharedMultimodalModels = usesSharedNanoBanana
    ? filteredImageModels.filter((modelId) => filteredCaptionModels.includes(modelId))
    : [];
  const usesSharedModelParameters = usesSharedNanoBanana && selectedImageModel && selectedImageModel === selectedCaptionModel;
  const selectedCaptionExpectedCost = selectedOutputs.includes("caption")
    ? getExpectedModelCost(selectedCaptionModelEntry, "caption", usesSharedModelParameters ? modelParameterValues.image : modelParameterValues.caption)
    : 0;
  const selectedImageExpectedCost = selectedOutputs.includes("image")
    ? getExpectedModelCost(selectedImageModelEntry, "image", modelParameterValues.image)
    : 0;
  const expectedGenerationCredits = Number((selectedCaptionExpectedCost + selectedImageExpectedCost).toFixed(4));
  const insufficientExpectedCredits = currentCredits !== null && currentCredits < expectedGenerationCredits;
  const visibleImageParameters = useMemo(
    () => getCreateVisibleModelParameters(selectedImageParameterSchema, "image"),
    [selectedImageParameterSchema],
  );
  const visibleCaptionParameters = useMemo(
    () => getCreateVisibleModelParameters(selectedCaptionParameterSchema, "text"),
    [selectedCaptionParameterSchema],
  );

  useEffect(() => {
    if (filteredCaptionModels.length === 0) {
      if (selectedCaptionModel !== "") {
        setSelectedCaptionModel("");
      }
      return;
    }

    if (usesSharedNanoBanana) {
      const sharedModel = filteredCaptionModels.includes(selectedImageModel)
        ? selectedImageModel
        : filteredCaptionModels[0];
      if (sharedModel && selectedCaptionModel !== sharedModel) {
        setSelectedCaptionModel(sharedModel);
      }
      return;
    }

    if (!filteredCaptionModels.includes(selectedCaptionModel)) {
      const nextModel = filteredCaptionModels[0];
      if (nextModel && selectedCaptionModel !== nextModel) {
        setSelectedCaptionModel(nextModel);
      }
    }
  }, [filteredCaptionModels, selectedCaptionModel, selectedImageModel, usesSharedNanoBanana]);

  useEffect(() => {
    if (filteredImageModels.length === 0) {
      if (selectedImageModel !== "") {
        setSelectedImageModel("");
      }
      return;
    }
    if (!filteredImageModels.includes(selectedImageModel)) {
      const nextModel = filteredImageModels[0];
      if (nextModel && selectedImageModel !== nextModel) {
        setSelectedImageModel(nextModel);
      }
    }
  }, [filteredImageModels, selectedImageModel]);

  useEffect(() => {
    if (!isModePickerOpen) return;

    if (filteredImageModels.length === 0) {
      if (draftImageModel !== "") {
        setDraftImageModel("");
      }
    } else if (!filteredImageModels.includes(draftImageModel)) {
      const nextModel = filteredImageModels[0] || "";
      if (nextModel !== draftImageModel) {
        setDraftImageModel(nextModel);
      }
    }
  }, [draftImageModel, filteredImageModels, isModePickerOpen]);

  useEffect(() => {
    if (!isModePickerOpen) return;

    if (filteredCaptionModels.length === 0) {
      if (draftCaptionModel !== "") {
        setDraftCaptionModel("");
      }
      return;
    }

    if (usesSharedNanoBanana) {
      const sharedModel = filteredCaptionModels.includes(draftImageModel)
        ? draftImageModel
        : filteredCaptionModels[0];
      if (sharedModel && draftCaptionModel !== sharedModel) {
        setDraftCaptionModel(sharedModel);
      }
      return;
    }

    if (!filteredCaptionModels.includes(draftCaptionModel)) {
      const nextModel = filteredCaptionModels[0] || "";
      if (nextModel !== draftCaptionModel) {
        setDraftCaptionModel(nextModel);
      }
    }
  }, [draftCaptionModel, draftImageModel, filteredCaptionModels, isModePickerOpen, usesSharedNanoBanana]);

  useEffect(() => {
    setModelParameterValues((prev) => ({
      ...prev,
      image: syncParameterState(selectedImageParameterSchema, prev.image),
    }));
  }, [selectedImageParameterSchema]);

  useEffect(() => {
    setModelParameterValues((prev) => ({
      ...prev,
      caption: syncParameterState(selectedCaptionParameterSchema, prev.caption),
    }));
  }, [selectedCaptionParameterSchema]);

  useEffect(() => {
    if (!usesSharedModelParameters) return;
    setModelParameterValues((prev) => ({
      ...prev,
      caption: { ...prev.image },
    }));
  }, [usesSharedModelParameters, selectedImageModel]);

  const handleCreditsChange = useCallback((credits: number | null) => {
    setCurrentCredits(credits);
  }, []);

  // --- Helpers ---
  const handleImageUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const originalFile = event.target.files?.[0];
    if (!originalFile) return;

    if (!["image/png", "image/jpeg", "image/webp"].includes(originalFile.type)) {
      showToast("Only PNG, JPEG, and WEBP images are supported.");
      event.target.value = "";
      return;
    }

    if (originalFile.size > MAX_UPLOAD_BYTES) {
      showToast("Image must be 10 MB or smaller.");
      event.target.value = "";
      return;
    }

    try {
      const file = await normalizeUploadImage(originalFile);
      const uploaded = await api.uploadInputImage(file);
      setInputImage((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return {
          fileId: uploaded.id,
          name: uploaded.name || file.name,
          mimeType: uploaded.mime_type || file.type,
          url: uploaded.url,
          previewUrl: URL.createObjectURL(file),
          size: uploaded.size || file.size,
          originalSize: originalFile.size,
        };
      });
      if (file.size < originalFile.size) {
        showToast("Image optimized for upload.", "success");
      }
    } catch (error) {
      if (captureSuspension(error)) {
        return;
      }
      console.error("Image upload error:", error);
      showToast(getErrorMessage(error, "Could not process that image."));
    } finally {
      event.target.value = "";
    }
  }, [captureSuspension]);

  const clearInputImage = useCallback(() => {
    setInputImage((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  // --- Handlers ---
  const handleAnalyze = async (
    ideaOverride?: string,
    modelOverrides?: { imageModel?: string; captionModel?: string },
  ) => {
    const effectiveText = (ideaOverride ?? userText).trim();
    if (!effectiveText) return;

    setLoading(true);
    try {
      const { imageModels, captionModels } = await refreshConfig();
      const requestedImageModel = modelOverrides?.imageModel ?? selectedImageModel;
      const requestedCaptionModel = modelOverrides?.captionModel ?? selectedCaptionModel;

      if (selectedOutputs.includes("image") && requestedImageModel && !imageModels.includes(requestedImageModel)) {
        throw new Error(`The selected image model '${requestedImageModel}' is no longer available. Please choose another model.`);
      }
      if (selectedOutputs.includes("caption") && requestedCaptionModel && !captionModels.includes(requestedCaptionModel)) {
        throw new Error(`The selected caption model '${requestedCaptionModel}' is no longer available. Please choose another model.`);
      }
      const effectiveImageModel = requestedImageModel || imageModels[0] || "";
      const effectiveCaptionModel = requestedCaptionModel || captionModels[0] || "";

      const payload: GenerateRequest = {
        user_text: effectiveText,
        requested_outputs: selectedOutputs,
        mode: "smart",
        input_image: inputImage ? {
          file_id: inputImage.fileId,
          name: inputImage.name,
          mime_type: inputImage.mimeType,
          url: inputImage.url,
        } : null,
        user_preferences: {
          image_model: effectiveImageModel,
          caption_model: effectiveCaptionModel,
        },
        status: "processing",
      };

      const response = await api.generate(payload);

      if (response.status === "awaiting_review" && response.ui_schema) {
        setUserText(effectiveText);
        setUiSchema(response.ui_schema);
        setContentPrompts(response.content_prompts || {});
        analyzeFinalizedRef.current = false;
        setPendingAnalyzeSessionId(response.meta?.analyze_session_id || null);
        setAnalyzeAbandonFee(response.meta?.analyze_abandon_fee || 0);
        setStep("REVIEW");
      }
    } catch (error) {
      if (captureSuspension(error)) {
        return;
      }
      showToast(getErrorMessage(error, "Error contacting backend. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const { imageModels, captionModels } = await refreshConfig();
      if (selectedOutputs.includes("image") && selectedImageModel && !imageModels.includes(selectedImageModel)) {
        throw new Error(`The selected image model '${selectedImageModel}' is no longer available. Please choose another model.`);
      }
      if (selectedOutputs.includes("caption") && selectedCaptionModel && !captionModels.includes(selectedCaptionModel)) {
        throw new Error(`The selected caption model '${selectedCaptionModel}' is no longer available. Please choose another model.`);
      }
      const effectiveImageModel = selectedImageModel || imageModels[0] || "";
      const effectiveCaptionModel = selectedCaptionModel || captionModels[0] || "";

      if (pendingAnalyzeSessionRef.current) {
        await api.completeAnalyzeSession(pendingAnalyzeSessionRef.current);
        clearAnalyzeSession();
      }

      const corrections: Record<string, any> = {};
      Object.values(uiSchema).forEach((fields) => {
        Object.entries(fields).forEach(([key, item]) => {
          corrections[key] = item.value;
        });
      });

      const payload: GenerateRequest = {
        user_text: userText,
        requested_outputs: selectedOutputs,
        mode: "smart",
        input_image: inputImage ? {
          file_id: inputImage.fileId,
          name: inputImage.name,
          mime_type: inputImage.mimeType,
          url: inputImage.url,
        } : null,
        status: "generating",
        user_preferences: {
          image_model: effectiveImageModel,
          caption_model: effectiveCaptionModel,
        },
        user_corrections: {
          ...corrections,
          image_prompt: contentPrompts.image_prompt,
          caption_prompt: contentPrompts.caption_prompt,
        },
        model_parameters: buildGenerateModelParameters(),
      };

      const response = await api.generate(payload);

      if (response.status === "success" && response.results) {
        setFinalResults(response.results);
        setFinalMeta(response.meta || null);
        setStep("RESULT");

        creditsRef.current?.refresh();
        window.dispatchEvent(new Event("studio-credits-refresh"));

        // Save to history
        if (user) {
          try {
            await addHistoryEntry(user.uid, {
              imageUrl: isRenderableImageUrl(response.results.image) ? response.results.image : undefined,
              caption: response.results.caption || undefined,
              prompt: userText,
              model: selectedImageModel || selectedCaptionModel,
            });
          } catch (e) {
            console.error("Failed to save history:", e);
          }
        }
      } else if (response.status === "error") {
        showToast(
          response.meta?.error_message || "This generation request could not be processed. No credits were charged."
        );
      } else {
        showToast("This generation request could not be completed. Please try again.");
      }
    } catch (error) {
      if (captureSuspension(error)) {
        return;
      }
      showToast(getErrorMessage(error, "Generation failed. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const handleSchemaChange = (outputType: string, key: string, newValue: string) => {
    setUiSchema((prev) => ({
      ...prev,
      [outputType]: {
        ...prev[outputType],
        [key]: { ...prev[outputType][key], value: newValue },
      },
    }));
  };

  const handleModelParameterChange = useCallback((outputType: OutputType, key: string, value: ParameterValue) => {
    setModelParameterValues((prev) => {
      const next = {
        ...prev,
        [outputType]: {
          ...prev[outputType],
          [key]: value,
        },
      };
      if (usesSharedModelParameters) {
        next.image = { ...next.image, [key]: value };
        next.caption = { ...next.caption, [key]: value };
      }
      return next;
    });
  }, [usesSharedModelParameters]);

  const buildGenerateModelParameters = useCallback((): Record<string, Record<string, ParameterValue>> => {
    const next: Record<string, Record<string, ParameterValue>> = {};

    if (selectedOutputs.includes("image") && visibleImageParameters.length > 0) {
      next.image = visibleImageParameters.reduce<Record<string, ParameterValue>>((acc, [key]) => {
        const value = modelParameterValues.image[key];
        if (value !== undefined) {
          acc[key] = value;
        }
        return acc;
      }, {});
    }

    if (selectedOutputs.includes("caption") && visibleCaptionParameters.length > 0) {
      next.caption = visibleCaptionParameters.reduce<Record<string, ParameterValue>>((acc, [key]) => {
        const sourceValues = usesSharedModelParameters ? modelParameterValues.image : modelParameterValues.caption;
        const value = sourceValues[key];
        if (value !== undefined) {
          acc[key] = value;
        }
        return acc;
      }, {});
    }

    return next;
  }, [
    modelParameterValues.caption,
    modelParameterValues.image,
    selectedOutputs,
    usesSharedModelParameters,
    visibleCaptionParameters,
    visibleImageParameters,
  ]);

  const handleReset = () => {
    clearAnalyzeSession();
    setIsModePickerOpen(false);
    setStep("INPUT");
    setFinalResults({});
    setFinalMeta(null);
    setUserText("");
    setModelParameterValues({ image: {}, caption: {} });
    clearInputImage();
  };

  const handleBackFromReview = async () => {
    const fee = analyzeFeeRef.current || 0;
    const confirmed = window.confirm(
      `If you leave this review step now, you will lose ${fee.toFixed(2)} credits. Continue?`
    );
    if (!confirmed) return;
    await abandonAnalyzeSession(false);
    setStep("INPUT");
    setIsModePickerOpen(true);
  };

  const getEffectiveModels = useCallback(async () => {
    const { imageModels, captionModels } = await refreshConfig();
    if (selectedOutputs.includes("image") && selectedImageModel && !imageModels.includes(selectedImageModel)) {
      throw new Error(`The selected image model '${selectedImageModel}' is no longer available. Please choose another model.`);
    }
    if (selectedOutputs.includes("caption") && selectedCaptionModel && !captionModels.includes(selectedCaptionModel)) {
      throw new Error(`The selected caption model '${selectedCaptionModel}' is no longer available. Please choose another model.`);
    }

    return {
      imageModel: selectedImageModel || imageModels[0] || "",
      captionModel: selectedCaptionModel || captionModels[0] || "",
    };
  }, [refreshConfig, selectedCaptionModel, selectedImageModel, selectedOutputs]);

  const saveResultToHistory = useCallback(async (results: Record<string, string>, prompt: string) => {
    if (!user) return;
    try {
      await addHistoryEntry(user.uid, {
        imageUrl: isRenderableImageUrl(results.image) ? results.image : undefined,
        caption: results.caption || undefined,
        prompt,
        model: selectedImageModel || selectedCaptionModel,
      });
    } catch (e) {
      console.error("Failed to save history:", e);
    }
  }, [selectedCaptionModel, selectedImageModel, user]);

  const handleOpenModePicker = () => {
    if (!userText.trim() || selectedOutputs.length === 0 || loading) {
      return;
    }
    setDraftImageModel(selectedImageModel);
    setDraftCaptionModel(selectedCaptionModel);
    setIsModePickerOpen(true);
  };

  const handleCloseModePicker = () => {
    setDraftImageModel(selectedImageModel);
    setDraftCaptionModel(selectedCaptionModel);
    setIsModePickerOpen(false);
  };

  const handleSmartStart = async (modelOverrides?: { imageModel?: string; captionModel?: string }) => {
    setIsModePickerOpen(false);
    await handleAnalyze(undefined, modelOverrides);
  };

  const handleModeContinue = async () => {
    setSelectedImageModel(draftImageModel);
    setSelectedCaptionModel(draftCaptionModel);
    await handleSmartStart({ imageModel: draftImageModel, captionModel: draftCaptionModel });
  };

  const isParameterOptionAffordable = useCallback((
    outputType: OutputType,
    key: string,
    option: string | number,
    values: ParameterState,
  ) => {
    if (currentCredits === null) return true;
    if (outputType !== "image" || (key !== "imageSize" && key !== "sampleImageSize")) {
      return true;
    }

    const nextImageValues = { ...modelParameterValues.image, ...values, [key]: String(option) };
    const nextImageCost = selectedOutputs.includes("image")
      ? getExpectedModelCost(selectedImageModelEntry, "image", nextImageValues)
      : 0;
    const nextCaptionValues = usesSharedModelParameters ? nextImageValues : modelParameterValues.caption;
    const nextCaptionCost = selectedOutputs.includes("caption")
      ? getExpectedModelCost(selectedCaptionModelEntry, "caption", nextCaptionValues)
      : 0;
    const projectedTotal = Number((nextImageCost + nextCaptionCost).toFixed(4));
    return projectedTotal <= currentCredits;
  }, [
    currentCredits,
    modelParameterValues.caption,
    modelParameterValues.image,
    selectedCaptionModelEntry,
    selectedImageModelEntry,
    selectedOutputs,
    usesSharedModelParameters,
  ]);

  const renderModelParameterControls = (
    outputType: OutputType,
    schema: Record<string, PlainChatParameterSchemaEntry>,
    values: ParameterState,
    accent: "primary" | "secondary" | "tertiary" = "primary",
    category?: "image" | "text",
  ) => {
    const parameters = category ? getCreateVisibleModelParameters(schema, category) : getVisibleModelParameters(schema);
    if (parameters.length === 0) return null;

    const accentClasses = {
      primary: {
        text: "text-[#adc6ff]",
        soft: "bg-[#adc6ff]/10 text-[#adc6ff] border-[#adc6ff]/20",
        solid: "bg-[#4d8eff] text-[#00285d] border-[#4d8eff] shadow-[0_0_10px_rgba(173,198,255,0.25)]",
        focus: "focus:border-[#adc6ff]/40 focus:ring-[#adc6ff]/20",
      },
      secondary: {
        text: "text-[#d0bcff]",
        soft: "bg-[#d0bcff]/10 text-[#d0bcff] border-[#d0bcff]/20",
        solid: "bg-[#d0bcff] text-[#3c0091] border-[#d0bcff] shadow-[0_0_10px_rgba(208,188,255,0.25)]",
        focus: "focus:border-[#d0bcff]/40 focus:ring-[#d0bcff]/20",
      },
      tertiary: {
        text: "text-[#b9c8de]",
        soft: "bg-[#b9c8de]/10 text-[#b9c8de] border-[#b9c8de]/20",
        solid: "bg-[#b9c8de] text-[#233143] border-[#b9c8de] shadow-[0_0_10px_rgba(185,200,222,0.25)]",
        focus: "focus:border-[#b9c8de]/40 focus:ring-[#b9c8de]/20",
      },
    }[accent];

    return (
      <div className="space-y-4">
        {parameters.map(([key, entry]) => {
          const currentValue = values[key];

          if (entry.type === "boolean") {
            const enabled = currentValue === true;
            return (
              <div key={`${outputType}-${key}`} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                    {formatParameterLabel(key)}
                  </label>
                  {entry.note && <span className="text-[10px] text-slate-500">{entry.note}</span>}
                </div>
                <button
                  type="button"
                  onClick={() => handleModelParameterChange(outputType, key, !enabled)}
                  className={`rounded-full border px-3 py-1 text-[10px] font-bold transition ${enabled ? accentClasses.solid : accentClasses.soft}`}
                >
                  {enabled ? "Enabled" : "Disabled"}
                </button>
              </div>
            );
          }

          if (entry.type === "enum") {
            return (
              <div key={`${outputType}-${key}`} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                    {formatParameterLabel(key)}
                  </label>
                  {entry.note && <span className="text-[10px] text-slate-500">{entry.note}</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(entry.values || []).map((option) => {
                    const active = String(currentValue) === String(option);
                    const affordable = isParameterOptionAffordable(outputType, key, option, values);
                    return (
                      <div
                        key={`${outputType}-${key}-${option}`}
                        className="relative"
                        onMouseEnter={() => {
                          if (!affordable) {
                            setHoveredLockedOption(`${outputType}-${key}-${option}`);
                          }
                        }}
                        onMouseLeave={() => {
                          setHoveredLockedOption((current) =>
                            current === `${outputType}-${key}-${option}` ? null : current,
                          );
                        }}
                      >
                        <button
                          type="button"
                          disabled={!affordable}
                          onClick={() => handleModelParameterChange(outputType, key, String(option))}
                          className={`rounded-full border px-3 py-1 text-[10px] font-bold transition ${
                            !affordable
                              ? "cursor-not-allowed border-white/5 bg-white/[0.04] text-slate-600 opacity-60"
                              : active
                                ? accentClasses.solid
                                : accentClasses.soft
                          }`}
                        >
                          {String(option)}
                        </button>
                        {!affordable && hoveredLockedOption === `${outputType}-${key}-${option}` && (
                          <div className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-[#191f31]/95 px-3 py-2 text-[10px] font-medium text-slate-200 shadow-[0_10px_30px_rgba(0,0,0,0.28)] backdrop-blur-md">
                            Not enough credits for this option.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          }

          const { min, max } = getNumericBounds(entry);
          const step = getParameterStep(entry);
          const safeValue = typeof currentValue === "number" ? currentValue : min;

          return (
            <div key={`${outputType}-${key}`} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                  {formatParameterLabel(key)}
                </label>
                <span className={`text-[10px] font-bold ${accentClasses.text}`}>{safeValue}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_92px]">
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={safeValue}
                  onChange={(event) => handleModelParameterChange(outputType, key, Number(event.target.value))}
                  className="w-full accent-[#4d8eff]"
                />
                <input
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  value={safeValue}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    if (Number.isNaN(nextValue)) return;
                    handleModelParameterChange(outputType, key, Math.min(max, Math.max(min, nextValue)));
                  }}
                  className={`w-full rounded-lg border border-outline-variant/10 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none transition focus:ring-1 ${accentClasses.focus}`}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-500">
                <span>{min}</span>
                <span>{max}</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // --- Render ---
  if (authLoading || !user) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="auth-loader" />
      </main>
    );
  }

  if (!accountReady) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="auth-loader" />
      </main>
    );
  }

  if (suspension) {
    return (
      <section className="flex justify-center py-6 lg:py-12">
        <div className="w-full max-w-3xl">
          <div className="glass-card p-6 sm:p-10">
            <div className="mx-auto max-w-xl text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-red-500/25 bg-red-500/10 text-red-300">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>

              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-red-300/80">
                Account Restricted
              </p>
              <h2 className="mt-3 text-2xl font-bold text-white sm:text-3xl">
                This account is currently suspended
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                {suspension.reason}
              </p>
              {suspension.endsAtLabel ? (
                <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 text-left">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Access Restores
                  </p>
                  <p className="mt-2 text-base font-semibold text-white">
                    {suspension.endsAtLabel}
                  </p>
                </div>
              ) : (
                <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 text-left">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Status
                  </p>
                  <p className="mt-2 text-base font-semibold text-white">
                    Suspended until admin review
                  </p>
                </div>
              )}
              <div className="mt-6">
                <Link
                  href="/policy"
                  className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/10 hover:text-white"
                >
                  View Usage Policy
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-[calc(100vh-4rem)] overflow-visible">
      <div className="hidden">
        <CreditsDisplay
          ref={creditsRef}
          uid={user.uid}
          onCreditsChange={handleCreditsChange}
          onSuspensionDetected={handleSuspensionMessage}
        />
      </div>

      <div className={`mx-auto flex max-w-6xl flex-col px-8 py-6 ${step === "INPUT" ? "min-h-full justify-start" : "min-h-full justify-start"}`}>
        {step !== "INPUT" && step !== "REVIEW" && step !== "RESULT" && (
          <div className="mx-auto mb-8 max-w-3xl">
            <StepIndicator currentStep={step} />
          </div>
        )}

        {step === "INPUT" && (
          <>
            <div className="mb-10 flex items-center justify-center gap-4 overflow-x-auto">
              <div className="flex items-center gap-3 rounded-full border border-primary bg-primary/10 px-6 py-2 shadow-[0_0_20px_rgba(77,142,255,0.15)]">
                <span className="material-symbols-outlined text-sm text-primary">check_circle</span>
                <span className="font-headline text-xs font-bold uppercase tracking-widest text-white">Idea</span>
              </div>
              <div className="h-px w-12 bg-outline-variant/30" />
              <div className="flex items-center gap-3 rounded-full border border-transparent bg-surface-container-low px-6 py-2">
                <span className="material-symbols-outlined text-sm text-slate-600">settings_input_component</span>
                <span className="font-headline text-xs font-bold uppercase tracking-widest text-slate-600">Optimize</span>
              </div>
              <div className="h-px w-12 bg-outline-variant/30" />
              <div className="flex items-center gap-3 rounded-full border border-transparent bg-surface-container-low px-6 py-2">
                <span className="material-symbols-outlined text-sm text-slate-600">auto_awesome</span>
                <span className="font-headline text-xs font-bold uppercase tracking-widest text-slate-600">Results</span>
              </div>
            </div>

            <header className="mb-6">
              <h1 className="font-headline text-[32px] font-bold leading-tight tracking-tighter text-white">
                Architect your{" "}
                <span className="bg-gradient-to-r from-[#adc6ff] via-[#d0bcff] to-[#4d8eff] bg-clip-text text-transparent">
                  visual identity.
                </span>
              </h1>
            </header>

            <section className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
              {[
                {
                  key: "caption",
                  title: "Caption Only",
                  icon: "notes",
                  active: selectedOutputs.length === 1 && selectedOutputs.includes("caption"),
                  onClick: () => setSelectedOutputs(["caption"]),
                },
                {
                  key: "image",
                  title: "Image Only",
                  icon: "image",
                  active: selectedOutputs.length === 1 && selectedOutputs.includes("image"),
                  onClick: () => setSelectedOutputs(["image"]),
                },
                {
                  key: "both",
                  title: "Both",
                  icon: "auto_fix_high",
                  active: selectedOutputs.includes("caption") && selectedOutputs.includes("image"),
                  onClick: () => setSelectedOutputs(["caption", "image"]),
                },
              ].map((option) => (
                <button key={option.key} type="button" onClick={option.onClick} className="group relative cursor-pointer text-left">
                  <div className={`absolute -inset-0.5 rounded-xl bg-gradient-to-br from-[#adc6ff] to-[#d0bcff] transition duration-500 ${option.active ? "opacity-20" : "opacity-0 group-hover:opacity-10"}`} />
                  <div className={`relative flex flex-col items-start gap-2 rounded-xl border px-4 py-3 transition-all duration-300 ${option.active ? "border-[#adc6ff]/40 bg-[#151b2de6]" : "border-white/5 bg-[rgba(21,27,45,0.7)] backdrop-blur-[20px]"}`}>
                    <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${option.active ? "bg-[#adc6ff] text-[#002e6a]" : "bg-[#2e3447] text-[#adc6ff]"}`}>
                      <span className="material-symbols-outlined text-base" style={option.active ? { fontVariationSettings: "'FILL' 1" } : undefined}>
                        {option.icon}
                      </span>
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">{option.title}</h3>
                    </div>
                    <div className="mt-0.5 h-0.5 w-full overflow-hidden rounded-full bg-[#191f31]">
                      <div className={`h-full bg-[#adc6ff] transition-all duration-700 ${option.active ? "w-full" : "w-0 group-hover:w-full"}`} />
                    </div>
                  </div>
                </button>
              ))}
            </section>

            <div className="mb-5 grid min-h-0 flex-grow grid-cols-1 items-start gap-5 lg:grid-cols-5">
              <div className="flex h-full flex-col lg:col-span-3">
                <div className="mb-1.5 flex items-end justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#c2c6d6]">Creative Brief</label>
                  <span className="text-[8px] text-[#adc6ff]/60">AI Optimized Processing</span>
                </div>
                <div className="group relative min-h-[120px] flex-grow">
                  <div className="absolute inset-0 rounded-xl bg-[#adc6ff]/5 opacity-0 blur-lg transition-opacity group-focus-within:opacity-100" />
                  <textarea
                    className="relative h-full min-h-[120px] w-full resize-none rounded-xl border-0 bg-[#070d1f] p-5 text-sm font-light text-white transition-all placeholder:text-slate-600 focus:ring-1 focus:ring-[#adc6ff]/40"
                    maxLength={2000}
                    placeholder="Describe what you want to create..."
                    value={userText}
                    onChange={(e) => setUserText(e.target.value)}
                  />
                  <div className="pointer-events-none absolute bottom-3 right-4 flex items-center gap-2 opacity-40">
                    <span className="material-symbols-outlined text-[10px]">keyboard_command_key</span>
                    <span className="text-[8px] font-bold">ENTER TO GENERATE</span>
                  </div>
                </div>
              </div>

              <div className="flex h-full flex-col lg:col-span-2">
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.2em] text-[#c2c6d6]">Reference Assets</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleImageUpload}
                />
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => !loading && fileInputRef.current?.click()}
                  onKeyDown={(event) => {
                    if ((event.key === "Enter" || event.key === " ") && !loading) {
                      event.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  className="group relative min-h-[120px] flex-grow cursor-pointer"
                >
                  <div className="absolute inset-0 rounded-xl border-2 border-dashed border-[#424754]/50 transition-colors group-hover:border-[#adc6ff]/50" />
                  {inputImage ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={inputImage.previewUrl} alt={inputImage.name} className="absolute inset-2 h-[calc(100%-1rem)] w-[calc(100%-1rem)] rounded-lg object-cover opacity-50" />
                      <div className="absolute inset-0 rounded-xl bg-[linear-gradient(180deg,rgba(7,13,31,0.2),rgba(7,13,31,0.85))]" />
                    </>
                  ) : (
                    <div className="absolute inset-2 overflow-hidden rounded-lg opacity-5 transition-opacity group-hover:opacity-10">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/landing/hero-secondary.jpg" alt="Texture background" className="h-full w-full object-cover grayscale" />
                    </div>
                  )}
                  <div className="relative flex h-full flex-col items-center justify-center p-3 text-center">
                    <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-[#23293c] transition-transform group-hover:scale-105">
                      <span className="material-symbols-outlined text-xl text-[#c2c6d6] transition-colors group-hover:text-[#adc6ff]">
                        {inputImage ? "image" : "cloud_upload"}
                      </span>
                    </div>
                    {inputImage ? (
                      <>
                        <p className="max-w-full truncate text-[11px] font-medium text-white">{inputImage.name}</p>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              fileInputRef.current?.click();
                            }}
                            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-semibold text-white transition hover:bg-white/10"
                          >
                            Replace
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              clearInputImage();
                            }}
                            className="rounded-md border border-white/10 bg-[#93000a]/20 px-3 py-1.5 text-[10px] font-semibold text-[#ffdad6] transition hover:bg-[#93000a]/30"
                          >
                            Remove
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="mb-0.5 text-[11px] font-medium text-white">Drag &amp; drop image</p>
                        <p className="text-[10px] text-[#c2c6d6]">
                          or <span className="text-[#adc6ff]">browse</span>
                        </p>
                        <p className="mt-2 text-[8px] uppercase tracking-widest text-[#8c909f]">Max 10MB • JPG, PNG</p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {(insufficientCredits || missingRequiredModel) && (
              <div className="mt-8 rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-sm text-red-300">
                    ⚠
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-red-200">
                      {insufficientCredits ? "Insufficient credits" : "Model configuration unavailable"}
                    </h3>
                    <p className="mt-1 text-xs leading-6 text-red-200/75">
                      {insufficientCredits
                        ? `Minimum required credits: ${minimumRequiredCredits.toFixed(2)}. This account currently has ${currentCredits?.toFixed(2) ?? "0.00"} credits available.`
                        : "A valid model is not currently available for one of the selected outputs."}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <footer className="mt-8 flex flex-row items-center justify-between gap-4 border-t border-white/5 pt-4">
              <div className="flex items-center gap-3">
                <div className="flex -space-x-2">
                  {[
                    user.photoURL || "/landing/hero-main.png",
                    "/landing/hero-secondary.jpg",
                  ].map((src, index) => (
                    <div key={index} className="h-7 w-7 overflow-hidden rounded-full border-2 border-[#0c1324]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={`Creative ${index + 1}`} className="h-full w-full object-cover" />
                    </div>
                  ))}
                  <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#0c1324] bg-[#2e3447] text-[8px] font-bold text-white">
                    +12k
                  </div>
                </div>
                <p className="text-[10px] italic text-[#c2c6d6]">Join 12,000+ architects creating today</p>
              </div>
              <button
                onClick={handleOpenModePicker}
                disabled={loading || !userText.trim() || selectedOutputs.length === 0}
                className="group flex items-center gap-3 rounded-md bg-gradient-to-r from-[#adc6ff] to-[#4d8eff] px-8 py-2.5 font-headline text-sm font-bold text-[#00285d] transition-all hover:shadow-[0_0_20px_rgba(77,142,255,0.2)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span>
                  {loading
                    ? "Preparing..."
                    : missingRequiredModel
                        ? "Model unavailable"
                        : "Next"}
                </span>
                {!loading && <span className="material-symbols-outlined text-lg transition-transform group-hover:translate-x-1">arrow_forward</span>}
              </button>
            </footer>
          </>
        )}

        <div className={`mx-auto ${step === "REVIEW" ? "max-w-5xl" : "max-w-3xl"}`}>

          {/* ─── STEP 2: REVIEW ─── */}
          {step === "REVIEW" && (
            <div className="animate-fade-in-up pb-36">
              <div className="mb-12 flex items-center justify-center gap-4 overflow-x-auto">
                <div className="flex items-center gap-3 rounded-full border border-primary/20 bg-surface-container-high px-6 py-2">
                  <span className="material-symbols-outlined text-sm text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                  <span className="font-headline text-xs font-bold uppercase tracking-widest text-primary">Idea</span>
                </div>
                <div className="h-px w-12 bg-outline-variant/30" />
                <div className="flex items-center gap-3 rounded-full border border-primary bg-primary/10 px-6 py-2 shadow-[0_0_20px_rgba(77,142,255,0.15)]">
                  <span className="material-symbols-outlined text-sm text-primary">settings_input_component</span>
                  <span className="font-headline text-xs font-bold uppercase tracking-widest text-white">Optimize</span>
                </div>
                <div className="h-px w-12 bg-outline-variant/30" />
                <div className="flex items-center gap-3 rounded-full border border-transparent bg-surface-container-low px-6 py-2">
                  <span className="material-symbols-outlined text-sm text-slate-600">auto_awesome</span>
                  <span className="font-headline text-xs font-bold uppercase tracking-widest text-slate-600">Results</span>
                </div>
              </div>

              <section className="mb-10">
                <div className="group relative overflow-hidden rounded-[1.25rem] border border-white/5 bg-surface-container-high px-6 py-6 shadow-[0_20px_60px_rgba(0,0,0,0.2)]">
                  <div className="absolute inset-0 overflow-hidden">
                    {inputImage ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={inputImage.previewUrl}
                          alt={inputImage.name}
                          className="h-full w-full scale-105 object-cover opacity-[0.14] transition-transform duration-700 group-hover:scale-110"
                        />
                        <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(12,19,36,0.92),rgba(12,19,36,0.72)_45%,rgba(12,19,36,0.94))]" />
                      </>
                    ) : (
                      <>
                        <div className="absolute -left-24 top-0 h-56 w-56 rounded-full bg-[#4d8eff]/18 blur-3xl transition-transform duration-700 group-hover:scale-110" />
                        <div className="absolute right-[-4rem] top-[-2rem] h-64 w-64 rounded-full bg-[#d0bcff]/12 blur-3xl transition-transform duration-700 group-hover:scale-110" />
                        <div className="absolute bottom-[-5rem] left-1/3 h-44 w-44 rounded-full bg-[#8392a6]/10 blur-3xl transition-transform duration-700 group-hover:scale-105" />
                        <div className="h-full w-full bg-[linear-gradient(135deg,#11182a_0%,#0c1324_40%,#18233a_100%)]" />
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(77,142,255,0.22),transparent_28%),radial-gradient(circle_at_82%_22%,rgba(208,188,255,0.18),transparent_24%),radial-gradient(circle_at_60%_78%,rgba(185,200,222,0.1),transparent_26%)]" />
                      </>
                    )}
                  </div>

                  <div className="absolute inset-y-0 right-0 w-[38%] bg-[linear-gradient(120deg,transparent,rgba(77,142,255,0.05)_55%,transparent)] opacity-80" />
                  <div className="absolute left-6 top-6 h-px w-24 bg-gradient-to-r from-[#4d8eff] to-transparent opacity-60" />

                  <div className="relative z-10 flex flex-col gap-3.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="font-headline text-[10px] font-black uppercase tracking-[0.32em] text-primary">Original User Idea</span>
                      <span className="rounded-full border border-[#4d8eff]/15 bg-[#4d8eff]/10 px-3 py-1 font-headline text-[9px] font-bold uppercase tracking-[0.22em] text-[#adc6ff]">
                        Creative Direction
                      </span>
                    </div>

                    <h2 className="max-w-3xl font-headline text-xl font-bold leading-tight tracking-tight text-white md:text-[1.7rem]">
                      {userText || "Your creative direction will appear here."}
                    </h2>

                    <div className="flex flex-wrap gap-2 pt-1">
                      {selectedOutputs.includes("image") && (
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#c2c6d6]">
                          Image
                        </span>
                      )}
                      {selectedOutputs.includes("caption") && (
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#c2c6d6]">
                          Caption
                        </span>
                      )}
                      {inputImage && (
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#c2c6d6]">
                          Reference Image Attached
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              <div className={`grid grid-cols-1 gap-8 ${selectedOutputs.includes("image") && selectedOutputs.includes("caption") ? "xl:grid-cols-2" : "max-w-3xl"}`}>
                {selectedOutputs.includes("image") && (
                  <section className="flex flex-col gap-6">
                    <div className="flex items-baseline justify-between">
                      <h3 className="font-headline text-2xl font-bold tracking-tight text-white">Image</h3>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Asset Parameters</span>
                    </div>
                    <div className="rounded-xl border border-[rgba(140,144,159,0.1)] bg-[rgba(25,31,49,0.7)] p-6 backdrop-blur-xl">
                      <div className="flex flex-col gap-6">
                        <div className="flex flex-col gap-3">
                          <label className="font-headline text-xs font-bold uppercase tracking-widest text-slate-400">Generated Prompt for Image</label>
                          <textarea
                            className="h-36 w-full resize-none rounded-lg border border-outline-variant/10 bg-surface-container-lowest p-4 text-sm leading-relaxed text-on-surface outline-none transition focus:border-primary/40 focus:ring-1 focus:ring-primary/20"
                            value={contentPrompts.image_prompt || ""}
                            onChange={(e) => setContentPrompts((prev) => ({ ...prev, image_prompt: e.target.value }))}
                          />
                        </div>

                        <div className="flex flex-col gap-3">
                          <div className="flex items-center justify-between">
                            <label className="font-headline text-[10px] font-bold uppercase tracking-widest text-slate-500">Image Configuration</label>
                            <span className="rounded-full border border-[#4d8eff]/20 bg-[#4d8eff]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[#adc6ff]">
                              {selectedImageModelEntry?.display_name || selectedImageModel || "No model"}
                            </span>
                          </div>

                          <div className="space-y-2">
                            {uiSchema.image && Object.keys(uiSchema.image).length > 0 && (
                              <details className="group overflow-hidden rounded-lg border border-outline-variant/10 bg-surface-container-lowest transition-all duration-300 open:border-primary/40 open:shadow-[0_0_15px_rgba(173,198,255,0.08)]">
                                <summary className="flex cursor-pointer items-center justify-between p-4 hover:bg-surface-variant/30">
                                  <span className="flex items-center gap-2 font-headline text-[11px] font-bold uppercase tracking-widest text-primary">
                                    <span className="material-symbols-outlined text-lg">tune</span>
                                    Image Intent
                                  </span>
                                  <span className="material-symbols-outlined text-slate-500 transition-transform duration-300 group-open:rotate-180">expand_more</span>
                                </summary>
                                <div className="space-y-4 px-4 pb-4 pt-2">
                                  {Object.entries(uiSchema.image)
                                    .filter(([key]) => key !== "aspect_ratio")
                                    .map(([key, item]) => (
                                    <div key={key} className="space-y-2">
                                      <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{item.label}</label>
                                      <div className="flex flex-wrap gap-2">
                                        {item.options.map((opt) => {
                                          const active = item.value === opt;
                                          return (
                                            <button
                                              key={`${key}-${opt}`}
                                              type="button"
                                              onClick={() => handleSchemaChange("image", key, opt)}
                                              className={`rounded-full border px-3 py-1 text-[10px] font-bold transition ${
                                                active
                                                  ? "border-[#4d8eff] bg-[#4d8eff] text-[#00285d] shadow-[0_0_10px_rgba(173,198,255,0.3)]"
                                                  : "border-[#4d8eff]/20 bg-[#adc6ff]/10 text-[#adc6ff] hover:bg-[#4d8eff] hover:text-[#00285d]"
                                              }`}
                                            >
                                              {opt}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}

                            {(usesSharedModelParameters || selectedOutputs.includes("image")) && visibleImageParameters.length > 0 && (
                              <details className="group overflow-hidden rounded-lg border border-outline-variant/10 bg-surface-container-lowest transition-all duration-300 open:border-[#b9c8de]/40 open:shadow-[0_0_15px_rgba(185,200,222,0.08)]">
                                <summary className="flex cursor-pointer items-center justify-between p-4 hover:bg-surface-variant/30">
                                  <span className="flex items-center gap-2 font-headline text-[11px] font-bold uppercase tracking-widest text-[#b9c8de]">
                                    <span className="material-symbols-outlined text-lg">palette</span>
                                    Model Intent
                                  </span>
                                  <span className="material-symbols-outlined text-slate-500 transition-transform duration-300 group-open:rotate-180">expand_more</span>
                                </summary>
                                <div className="px-4 pb-4 pt-2">
                                  {renderModelParameterControls("image", selectedImageParameterSchema, modelParameterValues.image, "tertiary", "image")}
                                </div>
                              </details>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {selectedOutputs.includes("caption") && (
                  <section className="flex flex-col gap-6">
                    <div className="flex items-baseline justify-between">
                      <h3 className="font-headline text-2xl font-bold tracking-tight text-white">Caption</h3>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Copywriting Parameters</span>
                    </div>
                    <div className="rounded-xl border border-[rgba(140,144,159,0.1)] bg-[rgba(25,31,49,0.7)] p-6 backdrop-blur-xl">
                      <div className="flex flex-col gap-6">
                        <div className="flex flex-col gap-3">
                          <label className="font-headline text-xs font-bold uppercase tracking-widest text-slate-400">Generated Prompt for Caption</label>
                          <textarea
                            className="h-36 w-full resize-none rounded-lg border border-outline-variant/10 bg-surface-container-lowest p-4 text-sm leading-relaxed text-on-surface outline-none transition focus:border-primary/40 focus:ring-1 focus:ring-primary/20"
                            value={contentPrompts.caption_prompt || ""}
                            onChange={(e) => setContentPrompts((prev) => ({ ...prev, caption_prompt: e.target.value }))}
                          />
                        </div>

                        <div className="flex flex-col gap-3">
                          <div className="flex items-center justify-between">
                            <label className="font-headline text-[10px] font-bold uppercase tracking-widest text-slate-500">Caption Configuration</label>
                            <span className="rounded-full border border-[#d0bcff]/20 bg-[#d0bcff]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[#d0bcff]">
                              {selectedCaptionModelEntry?.display_name || selectedCaptionModel || "No model"}
                            </span>
                          </div>

                          <div className="space-y-2">
                            {uiSchema.caption && Object.keys(uiSchema.caption).length > 0 && (
                              <details className="group overflow-hidden rounded-lg border border-outline-variant/10 bg-surface-container-lowest transition-all duration-300 open:border-primary/40 open:shadow-[0_0_15px_rgba(173,198,255,0.08)]">
                                <summary className="flex cursor-pointer items-center justify-between p-4 hover:bg-surface-variant/30">
                                  <span className="flex items-center gap-2 font-headline text-[11px] font-bold uppercase tracking-widest text-primary">
                                    <span className="material-symbols-outlined text-lg">auto_mode</span>
                                    Model Intent
                                  </span>
                                  <span className="material-symbols-outlined text-slate-500 transition-transform duration-300 group-open:rotate-180">expand_more</span>
                                </summary>
                                <div className="space-y-4 px-4 pb-4 pt-2">
                                  {Object.entries(uiSchema.caption).map(([key, item]) => (
                                    <div key={key} className="space-y-2">
                                      <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{item.label}</label>
                                      <div className="flex flex-wrap gap-2">
                                        {item.options.map((opt) => {
                                          const active = item.value === opt;
                                          return (
                                            <button
                                              key={`${key}-${opt}`}
                                              type="button"
                                              onClick={() => handleSchemaChange("caption", key, opt)}
                                              className={`rounded-full border px-3 py-1 text-[10px] font-bold transition ${
                                                active
                                                  ? "border-[#4d8eff] bg-[#4d8eff] text-[#00285d] shadow-[0_0_10px_rgba(173,198,255,0.3)]"
                                                  : "border-[#4d8eff]/20 bg-[#adc6ff]/10 text-[#adc6ff] hover:bg-[#4d8eff] hover:text-[#00285d]"
                                              }`}
                                            >
                                              {opt}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}

                            {(usesSharedModelParameters || selectedOutputs.includes("caption")) && visibleCaptionParameters.length > 0 && (
                              <details className="group overflow-hidden rounded-lg border border-outline-variant/10 bg-surface-container-lowest transition-all duration-300 open:border-secondary/40 open:shadow-[0_0_15px_rgba(208,188,255,0.08)]">
                                <summary className="flex cursor-pointer items-center justify-between p-4 hover:bg-surface-variant/30">
                                  <span className="flex items-center gap-2 font-headline text-[11px] font-bold uppercase tracking-widest text-secondary">
                                    <span className="material-symbols-outlined text-lg">description</span>
                                    Caption Intent
                                  </span>
                                  <span className="material-symbols-outlined text-slate-500 transition-transform duration-300 group-open:rotate-180">expand_more</span>
                                </summary>
                                <div className="px-4 pb-4 pt-2">
                                  {renderModelParameterControls(
                                    usesSharedModelParameters ? "image" : "caption",
                                    usesSharedModelParameters ? selectedImageParameterSchema : selectedCaptionParameterSchema,
                                    usesSharedModelParameters ? modelParameterValues.image : modelParameterValues.caption,
                                    "secondary",
                                    "text",
                                  )}
                                </div>
                              </details>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                )}
              </div>

              <footer className="mt-10 px-4 pb-4 pt-2 md:px-6">
                <div className="mx-auto max-w-5xl">
                  <div className="flex flex-col items-start justify-between gap-5 rounded-[1.35rem] border border-white/10 bg-[#11182a]/92 px-6 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl lg:flex-row lg:items-center">
                    <div className="flex items-center gap-4">
                      <button type="button" onClick={handleBackFromReview} className="group flex items-center gap-2 text-slate-400 transition-colors hover:text-white">
                        <span className="material-symbols-outlined text-lg">arrow_back</span>
                        <span className="font-headline text-xs font-bold uppercase tracking-widest">Back to Concept</span>
                      </button>
                    </div>

                    <div className="flex w-full flex-col items-start gap-4 lg:w-auto lg:flex-row lg:items-center">
                      <div className="text-left lg:text-right">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Optimization Complete</p>
                        <p className="mt-1 text-xs font-medium text-on-surface-variant">
                          {`Expected generation: ${expectedGenerationCredits.toFixed(4)} credits`}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {`Analysis fee already charged: ${smartAnalysisFee.toFixed(2)} credits`}
                        </p>
                      </div>
                      <button
                        onClick={handleGenerate}
                        disabled={loading || insufficientExpectedCredits}
                        className="rounded-lg bg-gradient-to-r from-primary to-primary-container px-10 py-4 font-headline text-sm font-bold uppercase tracking-[0.2em] text-on-primary-container shadow-[0_0_30px_rgba(77,142,255,0.3)] transition-all hover:shadow-[0_0_45px_rgba(77,142,255,0.4)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {loading ? "Generating..." : insufficientExpectedCredits ? `Need ${expectedGenerationCredits.toFixed(4)} Credits` : "Generate Results"}
                      </button>
                    </div>
                  </div>
                </div>
              </footer>
            </div>
          )}

          {/* ─── STEP 3: RESULT ─── */}
          {step === "RESULT" && (
            <div className="animate-scale-in space-y-10 pb-20">
              <div className="mb-16 flex items-center justify-center gap-4 overflow-x-auto">
                <div className="flex items-center gap-3 rounded-full border border-primary/20 bg-surface-container-high px-6 py-2">
                  <span className="material-symbols-outlined text-sm text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                  <span className="font-headline text-xs font-bold uppercase tracking-widest text-primary">Idea</span>
                </div>
                <div className="h-px w-12 bg-outline-variant/30" />
                <div className="flex items-center gap-3 rounded-full border border-primary/20 bg-surface-container-high px-6 py-2">
                  <span className="material-symbols-outlined text-sm text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                  <span className="font-headline text-xs font-bold uppercase tracking-widest text-primary">Optimize</span>
                </div>
                <div className="h-px w-12 bg-outline-variant/30" />
                <div className="flex items-center gap-3 rounded-full border border-primary bg-primary/10 px-6 py-2 shadow-[0_0_20px_rgba(77,142,255,0.15)]">
                  <span className="material-symbols-outlined text-sm text-primary">auto_awesome</span>
                  <span className="font-headline text-xs font-bold uppercase tracking-widest text-white">Result</span>
                </div>
              </div>

              <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                <div className="max-w-3xl">
                  <h1 className="font-display text-4xl font-extrabold tracking-tighter text-on-surface">
                    Generated Result
                  </h1>
                  <div className="mt-4 space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-outline">Original Request:</p>
                    <p className="max-w-2xl text-lg font-medium leading-relaxed text-on-surface-variant">
                      {userText.trim() || "No original request provided."}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="flex items-center gap-2 rounded-lg border border-outline-variant/10 bg-surface-container-high px-5 py-2.5 text-sm font-medium text-on-surface transition-colors hover:bg-surface-bright"
                  >
                    <span className="material-symbols-outlined text-sm">arrow_back</span>
                    Back to Studio
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-12 items-start gap-8">
                <div className="col-span-12 space-y-6 lg:col-span-4">
                  <section className="rounded-xl border border-white/10 bg-[#151b2d] p-6 shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
                    <h3 className="mb-6 text-[10px] font-bold uppercase tracking-[0.2em] text-outline">Usage &amp; Billing</h3>
                    <div className="grid grid-cols-1 gap-4">
                      <div className="rounded-lg border border-white/5 bg-[#191f31] p-5">
                        <p className="mb-1 text-[10px] text-on-surface-variant">Generation Cost</p>
                        <p className="font-display text-lg font-bold leading-tight text-on-surface sm:text-xl lg:text-2xl">
                          {actualChargedCost > 0 ? `${actualChargedCost.toFixed(4)} credits` : "—"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-white/5 bg-[#191f31] p-5">
                        <p className="mb-1 text-[10px] text-on-surface-variant">Tokens Used</p>
                        <p className="font-display text-2xl font-bold text-on-surface">
                          {totalTokensUsed > 0 ? totalTokensUsed.toLocaleString() : "—"}
                        </p>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-xl border border-white/10 bg-[#151b2d] p-6 shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
                    <h3 className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-outline">Inference Engine</h3>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary-container/30 text-secondary">
                          <span className="material-symbols-outlined">bolt</span>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-on-surface">{primaryEngineLabel}</p>
                          <p className="text-[10px] text-on-surface-variant">Usage-based generation engine</p>
                        </div>
                      </div>
                      <span className="material-symbols-outlined text-outline">verified</span>
                    </div>
                  </section>

                  <section className="rounded-xl border border-white/10 bg-[#151b2d] p-6 shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
                    <h3 className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-outline">Technical Specifications</h3>
                    <div className="space-y-3 rounded-lg border border-white/5 bg-[#191f31] p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-on-surface-variant">Aspect Ratio</span>
                        <span className="text-xs font-bold text-on-surface">{aspectRatioValue}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-on-surface-variant">Resolution</span>
                        <span className="text-xs font-bold text-on-surface">{resolutionValue}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-on-surface-variant">Seed</span>
                        <span className="font-mono text-xs text-on-surface">{seedValue}</span>
                      </div>
                    </div>
                  </section>

                </div>

                <div className="col-span-12 space-y-8 lg:col-span-8">
                  <div className="group glass-panel relative aspect-[16/10] overflow-hidden rounded-[1.25rem]">
                    {finalResults.image ? (
                      <>
                        <InteractiveAuthenticatedImage
                          src={finalResults.image}
                          alt="Generated result"
                          wrapperClassName="h-full w-full"
                          imageClassName="h-full w-full object-cover"
                          loadingClassName="flex h-full w-full items-center justify-center bg-white/5 px-4 py-6 text-xs text-white/60"
                          errorClassName="flex h-full w-full items-center justify-center bg-white/5 px-4 py-6 text-xs text-white/60"
                        />
                        <div className="absolute left-6 top-6">
                          <span className="rounded-md border border-primary/20 bg-black/40 px-3 py-1.5 text-[10px] font-bold tracking-widest text-primary backdrop-blur-md">
                            {primaryEngineLabel}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex h-full items-center justify-center bg-surface-container-lowest">
                        <div className="text-center">
                          <span className="material-symbols-outlined text-5xl text-primary">notes</span>
                          <p className="mt-4 font-headline text-2xl font-bold text-white">Caption Result Ready</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {finalResults.caption && (
                    <div className="relative rounded-[1.25rem] border border-white/10 bg-[#151b2d] p-8 shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
                      <h3 className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-outline">AI Generated Caption</h3>
                      <p className="mb-6 max-w-3xl text-lg font-light italic leading-relaxed text-on-surface-variant">
                        &quot;{finalResults.caption}&quot;
                      </p>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(finalResults.caption);
                            showToast("Caption copied.", "success");
                          } catch {
                            showToast("Could not copy caption.");
                          }
                        }}
                        className="flex items-center gap-2 text-xs font-bold text-primary transition-colors hover:text-white"
                      >
                        <span className="material-symbols-outlined text-sm">content_copy</span>
                        Copy Caption
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Toast notifications */}
      {toast && (
        <div className={`toast ${toast.type === "error" ? "toast-error" : "toast-success"}`}>
          {toast.message}
        </div>
      )}

      {isModePickerOpen && (
        <div className="fixed inset-0 z-50 bg-[#070d1f]/70 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close workflow drawer"
            onClick={handleCloseModePicker}
            className="absolute inset-0 h-full w-full"
          />
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute right-0 top-0 flex h-full w-full max-w-[760px] items-stretch">
              <div className="pointer-events-auto flex h-full w-full flex-col border-l border-white/5 bg-[rgba(12,19,36,0.92)] px-5 py-6 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-[20px] sm:px-6">
                <div className="flex items-center justify-between">
                  <h2 className="font-headline text-xl font-bold tracking-tight text-slate-100">Generation Settings</h2>
                  <button
                    type="button"
                    onClick={handleCloseModePicker}
                    className="text-[#c2c6d6] transition-colors hover:text-white"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>

                <div className="mt-8 space-y-8 overflow-y-auto pr-1">
                  <section>
                    <label className="mb-3 block text-[13px] font-medium text-[#c2c6d6]">Model Selector</label>
                    <div className="grid gap-4 md:grid-cols-2">
                      {usesSharedNanoBanana ? (
                        <div className="rounded-xl bg-[#070d1f] p-3 md:col-span-2">
                          <div className="mb-3 flex items-center justify-between text-[11px] text-[#c2c6d6]">
                            <span>Multimodal models</span>
                            <span>{sharedMultimodalModels.length} available</span>
                          </div>
                          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                      {sharedMultimodalModels.map((modelId) => {
                              const model = modelCatalog.image?.[modelId] || modelCatalog.caption?.[modelId];
                              const active = draftImageModel === modelId && draftCaptionModel === modelId;
                              return (
                                <button
                                  key={modelId}
                                  type="button"
                                  onClick={() => {
                                    setDraftImageModel(modelId);
                                    setDraftCaptionModel(modelId);
                                  }}
                                  disabled={loading}
                                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left text-[13px] font-medium transition-all ${
                                    active
                                      ? "border border-[#4d8eff66] bg-[#4d8eff1a] font-semibold text-[#adc6ff] shadow-[0_0_0_1px_rgba(77,142,255,0.4),0_0_15px_rgba(77,142,255,0.2)]"
                                      : "border border-white/5 bg-[#151b2d] text-[#c2c6d6] hover:border-[#4d8eff40] hover:text-white"
                                  }`}
                                >
                                  <div className="min-w-0">
                                    <div className="truncate">{model?.display_name || modelId}</div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                          {sharedMultimodalModels.length === 0 && (
                            <p className="text-sm text-[#8c909f]">No multimodal models available.</p>
                          )}
                        </div>
                      ) : (
                        <>
                      {selectedOutputs.includes("caption") && (
                        <div className="rounded-xl bg-[#070d1f] p-3">
                          <div className="mb-3 flex items-center justify-between text-[11px] text-[#c2c6d6]">
                            <span>Text models</span>
                            <span>{filteredCaptionModels.length} available</span>
                          </div>
                          <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                            {filteredCaptionModels.map((modelId) => {
                              const model = modelCatalog.caption?.[modelId];
                              const active = draftCaptionModel === modelId;
                              return (
                                <button
                                  key={modelId}
                                  type="button"
                                  onClick={() => setDraftCaptionModel(modelId)}
                                  disabled={loading}
                                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left text-[13px] font-medium transition-all ${
                                    active
                                      ? "border border-[#4d8eff66] bg-[#4d8eff1a] font-semibold text-[#adc6ff] shadow-[0_0_0_1px_rgba(77,142,255,0.4),0_0_15px_rgba(77,142,255,0.2)]"
                                      : "border border-white/5 bg-[#151b2d] text-[#c2c6d6] hover:border-[#4d8eff40] hover:text-white"
                                  }`}
                                >
                                  <div className="min-w-0">
                                    <div className="truncate">{model?.display_name || modelId}</div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                          {filteredCaptionModels.length === 0 && (
                            <p className="text-sm text-[#8c909f]">No text models available.</p>
                          )}
                        </div>
                      )}
                      {selectedOutputs.includes("image") && (
                        <div className="rounded-xl bg-[#070d1f] p-3">
                          <div className="mb-3 flex items-center justify-between text-[11px] text-[#c2c6d6]">
                            <span>Image models</span>
                            <span>{filteredImageModels.length} available</span>
                          </div>
                          <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                            {filteredImageModels.map((modelId) => {
                              const model = modelCatalog.image?.[modelId];
                              const active = draftImageModel === modelId;
                              return (
                                <button
                                  key={modelId}
                                  type="button"
                                  onClick={() => setDraftImageModel(modelId)}
                                  disabled={loading}
                                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left text-[13px] font-medium transition-all ${
                                    active
                                      ? "border border-[#4d8eff66] bg-[#4d8eff1a] font-semibold text-[#adc6ff] shadow-[0_0_0_1px_rgba(77,142,255,0.4),0_0_15px_rgba(77,142,255,0.2)]"
                                      : "border border-white/5 bg-[#151b2d] text-[#c2c6d6] hover:border-[#4d8eff40] hover:text-white"
                                  }`}
                                >
                                  <div className="min-w-0">
                                    <div className="truncate">{model?.display_name || modelId}</div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                          {filteredImageModels.length === 0 && (
                            <p className="text-sm text-[#8c909f]">No image models available.</p>
                          )}
                        </div>
                      )}
                        </>
                      )}
                    </div>
                  </section>

                  <section className="space-y-3">
                    <label className="block text-[13px] font-medium text-[#c2c6d6]">Minimum Required Credits</label>
                    <div className="rounded-lg bg-[rgba(7,13,31,0.4)] p-4">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3 text-[13px]">
                          <span className="text-[#c2c6d6]">Text minimum</span>
                          <span className="font-medium text-white">{draftCaptionMinimumCost.toFixed(2)} credits</span>
                        </div>
                        <div className="h-px bg-white/10" />
                        <div className="flex items-center justify-between gap-3 text-[13px]">
                          <span className="text-[#c2c6d6]">Image minimum</span>
                          <span className="font-medium text-white">{draftImageMinimumCost.toFixed(2)} credits</span>
                        </div>
                        <div className="h-px bg-white/10" />
                        <div className="flex items-center justify-between gap-3 text-[13px]">
                          <span className="text-[#c2c6d6]">Smart analysis</span>
                          <span className="font-medium text-white">{smartAnalysisFee.toFixed(2)} credits</span>
                        </div>
                        <div className="h-px bg-white/10" />
                        <div className="flex items-center justify-between gap-3 text-[13px]">
                          <span className="font-semibold text-[#c2c6d6]">Minimum total</span>
                          <span className="font-semibold text-white">{draftMinimumRequiredCredits.toFixed(2)} credits</span>
                        </div>
                      </div>
                    </div>
                    {insufficientDraftSmartCredits && (
                      <p className="text-sm leading-6 text-[#ffb4ab]">
                        You need at least {draftMinimumRequiredCredits.toFixed(2)} credits to start Smart mode.
                      </p>
                    )}
                  </section>
                </div>

                <div className="mt-8">
                  <button
                    type="button"
                    onClick={handleModeContinue}
                    disabled={loading || insufficientDraftSmartCredits}
                    className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#adc6ff] to-[#4d8eff] py-4 text-sm font-bold tracking-wide text-[#002e6a] shadow-[0_8px_20px_rgba(77,142,255,0.3)] transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? (
                      <LoadingSpinner text="Preparing..." />
                    ) : insufficientDraftSmartCredits ? (
                      `Insufficient Credits (${draftMinimumRequiredCredits.toFixed(2)} needed)`
                    ) : (
                      <>
                        Continue with Smart
                        <span className="material-symbols-outlined text-base">arrow_forward</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
