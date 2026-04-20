// frontend/src/app/page.tsx
"use client";

import { useState, useEffect, useRef, useMemo, useCallback, type ChangeEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "../../../services/api";
import { GenerateRequest, UISchemaItem, OutputType, ModelCatalogEntry, SystemConfig } from "../../../types";
import { useAuth } from "../../../context/AuthContext";

import StepIndicator from "../../../components/StepIndicator";
import ReviewCard from "../../../components/ReviewCard";
import ResultCard from "../../../components/ResultCard";
import LoadingSpinner from "../../../components/LoadingSpinner";
import CreditsDisplay from "../../../components/CreditsDisplay";
import type { CreditsDisplayHandle } from "../../../components/CreditsDisplay";
import { addHistoryEntry } from "../../../lib/history";

type Step = "INPUT" | "REVIEW" | "RESULT";

interface Toast {
  message: string;
  type: "error" | "success";
}

interface UploadedImageState {
  name: string;
  mimeType: string;
  url: string;
  previewUrl: string;
  size: number;
}

interface SuspensionState {
  reason: string;
  endsAt: string | null;
  endsAtLabel: string | null;
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_PROXY_IMAGE_DIMENSION = 1536;
const MAX_PROXY_IMAGE_BYTES = 1_800_000;

function isRenderableImageUrl(value?: string): boolean {
  if (!value) return false;
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/");
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
  const { user, loading: authLoading } = useAuth();
  const selectedMode = "smart" as const;
  const creditsRef = useRef<CreditsDisplayHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Model Catalog (with costs)
  const [modelCatalog, setModelCatalog] = useState<Record<string, Record<string, ModelCatalogEntry>>>({});
  const [smartAnalysisFee, setSmartAnalysisFee] = useState<number>(0.05);
  const [inputImage, setInputImage] = useState<UploadedImageState | null>(null);

  // Current credit balance (synced from CreditsDisplay)
  const [currentCredits, setCurrentCredits] = useState<number | null>(null);

  // Review & Result State
  const [uiSchema, setUiSchema] = useState<Record<string, Record<string, UISchemaItem>>>({});
  const [finalResults, setFinalResults] = useState<Record<string, string>>({});
  const [contentPrompts, setContentPrompts] = useState<Record<string, string>>({});
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

  // --- Cost Calculation ---
  const totalCost = useMemo(() => {
    let cost = 0;
    if (selectedOutputs.includes("caption") && selectedCaptionModel) {
      cost += modelCatalog.caption?.[selectedCaptionModel]?.cost ?? 0;
    }
    if (selectedOutputs.includes("image") && selectedImageModel) {
      cost += modelCatalog.image?.[selectedImageModel]?.cost ?? 0;
    }
    return parseFloat(cost.toFixed(2));
  }, [selectedOutputs, selectedCaptionModel, selectedImageModel, modelCatalog]);

  const selectedCaptionModelEntry = selectedCaptionModel ? modelCatalog.caption?.[selectedCaptionModel] : undefined;
  const selectedImageModelEntry = selectedImageModel ? modelCatalog.image?.[selectedImageModel] : undefined;
  const captionGenerationCost = selectedOutputs.includes("caption")
    ? Number((selectedCaptionModelEntry?.cost ?? 0).toFixed(2))
    : 0;
  const imageGenerationCost = selectedOutputs.includes("image")
    ? Number((selectedImageModelEntry?.cost ?? 0).toFixed(2))
    : 0;
  const smartTotalCost = Number((totalCost + smartAnalysisFee).toFixed(2));
  const insufficientSmartCredits = currentCredits !== null && smartTotalCost > currentCredits;

  const insufficientCredits = currentCredits !== null && totalCost > currentCredits;
  const missingRequiredModel =
    (selectedOutputs.includes("caption") && !selectedCaptionModel) ||
    (selectedOutputs.includes("image") && !selectedImageModel);
  const usesSharedNanoBanana = Boolean(inputImage && selectedOutputs.includes("caption") && selectedOutputs.includes("image"));

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
          name: uploaded.name || file.name,
          mimeType: uploaded.mime_type || file.type,
          url: uploaded.url,
          previewUrl: URL.createObjectURL(file),
          size: uploaded.size || file.size,
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
  const handleAnalyze = async (ideaOverride?: string) => {
    const effectiveText = (ideaOverride ?? userText).trim();
    if (!effectiveText) return;

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

      const payload: GenerateRequest = {
        user_text: effectiveText,
        requested_outputs: selectedOutputs,
        mode: "smart",
        input_image: inputImage ? {
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
      };

      const response = await api.generate(payload);

      if (response.status === "success" && response.results) {
        setFinalResults(response.results);
        setStep("RESULT");

        creditsRef.current?.refresh();

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

  const handleReset = () => {
    clearAnalyzeSession();
    setIsModePickerOpen(false);
    setStep("INPUT");
    setFinalResults({});
    setUserText("");
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
    if (!userText.trim() || selectedOutputs.length === 0 || insufficientCredits || missingRequiredModel || loading) {
      return;
    }
    setIsModePickerOpen(true);
  };

  const handleSmartStart = async () => {
    setIsModePickerOpen(false);
    await handleAnalyze();
  };

  const handleModeContinue = async () => {
    await handleSmartStart();
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
    <section className={step === "INPUT" ? "h-[calc(100vh-4rem)] overflow-hidden" : "min-h-[calc(100vh-4rem)] overflow-visible"}>
      <div className="hidden">
        <CreditsDisplay
          ref={creditsRef}
          uid={user.uid}
          onCreditsChange={handleCreditsChange}
          onSuspensionDetected={handleSuspensionMessage}
        />
      </div>

      <div className={`mx-auto flex max-w-6xl flex-col px-8 py-6 ${step === "INPUT" ? "h-full justify-between" : "min-h-full justify-start"}`}>
        {step !== "INPUT" && (
          <div className="mx-auto mb-8 max-w-3xl">
            <StepIndicator currentStep={step} />
          </div>
        )}

        {step === "INPUT" && (
          <>
            <header className="mb-6">
              <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-[#adc6ff]/20 bg-[#adc6ff]/10 px-2 py-0.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#adc6ff]" />
                <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-[#adc6ff]">
                  Stage 1: Canvas Setup
                </span>
              </div>
              <h1 className="font-headline text-[32px] font-bold leading-tight tracking-tighter text-white">
                Architect your{" "}
                <span className="bg-gradient-to-r from-[#adc6ff] via-[#d0bcff] to-[#4d8eff] bg-clip-text text-transparent">
                  visual identity.
                </span>
              </h1>
              <p className="mt-2 max-w-xl text-sm font-light leading-snug text-[#c2c6d6]">
                Define core parameters and select your output medium for our neural engine.
              </p>
            </header>

            <section className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
              {[
                {
                  key: "caption",
                  title: "Caption Only",
                  description: "Textual narratives engineered for engagement.",
                  icon: "notes",
                  active: selectedOutputs.length === 1 && selectedOutputs.includes("caption"),
                  onClick: () => setSelectedOutputs(["caption"]),
                },
                {
                  key: "image",
                  title: "Image Only",
                  description: "Cinematic visuals and textures at 8K resolution.",
                  icon: "image",
                  active: selectedOutputs.length === 1 && selectedOutputs.includes("image"),
                  onClick: () => setSelectedOutputs(["image"]),
                },
                {
                  key: "both",
                  title: "Both",
                  description: "Synthesized campaigns with unified direction.",
                  icon: "auto_fix_high",
                  active: selectedOutputs.includes("caption") && selectedOutputs.includes("image"),
                  onClick: () => setSelectedOutputs(["caption", "image"]),
                },
              ].map((option) => (
                <button key={option.key} type="button" onClick={option.onClick} className="group relative cursor-pointer text-left">
                  <div className={`absolute -inset-0.5 rounded-xl bg-gradient-to-br from-[#adc6ff] to-[#d0bcff] transition duration-500 ${option.active ? "opacity-20" : "opacity-0 group-hover:opacity-10"}`} />
                  <div className={`relative flex flex-col items-start gap-3 rounded-xl border p-4 transition-all duration-300 ${option.active ? "border-[#adc6ff]/40 bg-[#151b2de6]" : "border-white/5 bg-[rgba(21,27,45,0.7)] backdrop-blur-[20px]"}`}>
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${option.active ? "bg-[#adc6ff] text-[#002e6a]" : "bg-[#2e3447] text-[#adc6ff]"}`}>
                      <span className="material-symbols-outlined text-base" style={option.active ? { fontVariationSettings: "'FILL' 1" } : undefined}>
                        {option.icon}
                      </span>
                    </div>
                    <div>
                      <h3 className="mb-0.5 text-sm font-bold text-white">{option.title}</h3>
                      <p className="text-[11px] leading-tight text-[#c2c6d6]">{option.description}</p>
                    </div>
                    <div className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-[#191f31]">
                      <div className={`h-full bg-[#adc6ff] transition-all duration-700 ${option.active ? "w-full" : "w-0 group-hover:w-full"}`} />
                    </div>
                  </div>
                </button>
              ))}
            </section>

            <div className="mb-6 grid min-h-0 flex-grow grid-cols-1 items-start gap-6 lg:grid-cols-5">
              <div className="flex h-full flex-col lg:col-span-3">
                <div className="mb-1.5 flex items-end justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#c2c6d6]">Creative Brief</label>
                  <span className="text-[8px] text-[#adc6ff]/60">AI Optimized Processing</span>
                </div>
                <div className="group relative min-h-[140px] flex-grow">
                  <div className="absolute inset-0 rounded-xl bg-[#adc6ff]/5 opacity-0 blur-lg transition-opacity group-focus-within:opacity-100" />
                  <textarea
                    className="relative h-full min-h-[140px] w-full resize-none rounded-xl border-0 bg-[#070d1f] p-6 text-sm font-light text-white transition-all placeholder:text-slate-600 focus:ring-1 focus:ring-[#adc6ff]/40"
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
                  className="group relative min-h-[140px] flex-grow cursor-pointer"
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
                  <div className="relative flex h-full flex-col items-center justify-center p-4 text-center">
                    <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[#23293c] transition-transform group-hover:scale-105">
                      <span className="material-symbols-outlined text-xl text-[#c2c6d6] transition-colors group-hover:text-[#adc6ff]">
                        {inputImage ? "image" : "cloud_upload"}
                      </span>
                    </div>
                    {inputImage ? (
                      <>
                        <p className="max-w-full truncate text-[11px] font-medium text-white">{inputImage.name}</p>
                        <p className="mt-1 text-[10px] text-[#c2c6d6]">
                          {(inputImage.size / (1024 * 1024)).toFixed(2)} MB • {inputImage.mimeType}
                        </p>
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
                        ? `This generation costs ${totalCost.toFixed(2)} credits, but this account currently has ${currentCredits?.toFixed(2) ?? "0.00"}.`
                        : "A valid model is not currently available for one of the selected outputs."}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <footer className="flex flex-row items-center justify-between gap-4 border-t border-white/5 pt-4">
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
                disabled={loading || !userText.trim() || selectedOutputs.length === 0 || insufficientCredits || missingRequiredModel}
                className="group flex items-center gap-3 rounded-md bg-gradient-to-r from-[#adc6ff] to-[#4d8eff] px-8 py-2.5 font-headline text-sm font-bold text-[#00285d] transition-all hover:shadow-[0_0_20px_rgba(77,142,255,0.2)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span>
                  {loading
                    ? "Preparing..."
                    : insufficientCredits
                      ? `Insufficient Credits (${totalCost.toFixed(2)} needed)`
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
            <div className="animate-fade-in-up space-y-8 pb-32">
              <header className="flex items-center justify-between rounded-xl border border-white/5 bg-[#0c1324]/80 px-6 py-4 backdrop-blur-xl">
                <div className="flex items-center gap-4">
                  <span className="material-symbols-outlined text-[#4d8eff]">psychology</span>
                  <div>
                    <h2 className="font-headline text-2xl font-bold tracking-tighter text-slate-100">Analyze Intent</h2>
                    <p className="mt-1 text-sm text-[#c2c6d6]">Refine the AI suggestions before final generation.</p>
                  </div>
                </div>
                <div className="rounded-full border border-[#4d8eff]/20 bg-[#4d8eff]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#adc6ff]">
                  Smart Review
                </div>
              </header>

              <section>
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[#c2c6d6]">
                  <span className="material-symbols-outlined text-sm">edit_note</span>
                  ORIGINAL INPUT
                </div>
                <div className="rounded-xl border border-white/10 bg-[#070d1f] p-6 shadow-2xl">
                  <p className="font-headline text-2xl font-light tracking-tight text-slate-100">
                    &quot;{userText || "Your creative direction will appear here."}&quot;
                  </p>
                </div>
              </section>

              <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="space-y-6 lg:col-span-8">
                  {selectedOutputs.includes("image") && uiSchema.image && (
                    <div className="space-y-6 rounded-xl bg-[#151b2d] p-6">
                      <div className="flex items-center justify-between">
                        <h3 className="font-headline text-xl font-bold text-slate-100">Image Direction</h3>
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#4d8eff]/70">AI Suggested</span>
                      </div>
                      <div>
                        <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-[#c2c6d6]">Optimized image prompt</label>
                        <textarea
                          className="w-full rounded-xl border border-white/10 bg-[#070d1f] p-4 text-sm leading-relaxed text-white outline-none transition placeholder:text-slate-600 focus:border-[#4d8eff66]"
                          rows={4}
                          value={contentPrompts.image_prompt || ""}
                          onChange={(e) => setContentPrompts((prev) => ({ ...prev, image_prompt: e.target.value }))}
                          placeholder="Visual description for the image..."
                        />
                      </div>
                      <div className="grid gap-6 md:grid-cols-2">
                        {Object.entries(uiSchema.image).map(([key, item]) => (
                          <div key={key} className="rounded-xl bg-[#191f31] p-5">
                            <div className="mb-4 flex items-center justify-between">
                              <h4 className="font-headline text-base font-bold text-slate-100">{item.label}</h4>
                              {item.category === "ai_suggestion" && (
                                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#4d8eff]/70">AI</span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {item.options.map((opt) => {
                                const active = item.value === opt;
                                return (
                                  <button
                                    key={opt}
                                    type="button"
                                    onClick={() => handleSchemaChange("image", key, opt)}
                                    className={`rounded-full px-4 py-1.5 text-xs font-medium transition-all ${
                                      active
                                        ? "bg-[#4d8eff] font-bold text-[#00285d] ring-2 ring-[#adc6ff]/20"
                                        : "bg-[#2e3447] text-[#c2c6d6] hover:border-[#4d8eff]/30 hover:text-white"
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
                    </div>
                  )}

                  {selectedOutputs.includes("caption") && uiSchema.caption && (
                    <div className="space-y-6 rounded-xl bg-[#151b2d] p-6">
                      <div className="flex items-center justify-between">
                        <h3 className="font-headline text-xl font-bold text-slate-100">Caption Direction</h3>
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#4d8eff]/70">AI Suggested</span>
                      </div>
                      <div>
                        <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-[#c2c6d6]">Optimized caption prompt</label>
                        <textarea
                          className="w-full rounded-xl border border-white/10 bg-[#070d1f] p-4 text-sm leading-relaxed text-white outline-none transition placeholder:text-slate-600 focus:border-[#4d8eff66]"
                          rows={4}
                          value={contentPrompts.caption_prompt || ""}
                          onChange={(e) => setContentPrompts((prev) => ({ ...prev, caption_prompt: e.target.value }))}
                          placeholder="Marketing context for the caption..."
                        />
                      </div>
                      <div className="grid gap-6 md:grid-cols-2">
                        {Object.entries(uiSchema.caption).map(([key, item]) => (
                          <div key={key} className="rounded-xl bg-[#191f31] p-5">
                            <div className="mb-4 flex items-center justify-between">
                              <h4 className="font-headline text-base font-bold text-slate-100">{item.label}</h4>
                              {item.category === "ai_suggestion" && (
                                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#4d8eff]/70">AI</span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {item.options.map((opt) => {
                                const active = item.value === opt;
                                return (
                                  <button
                                    key={opt}
                                    type="button"
                                    onClick={() => handleSchemaChange("caption", key, opt)}
                                    className={`rounded-full px-4 py-1.5 text-xs font-medium transition-all ${
                                      active
                                        ? "bg-[#4d8eff] font-bold text-[#00285d] ring-2 ring-[#adc6ff]/20"
                                        : "bg-[#2e3447] text-[#c2c6d6] hover:border-[#4d8eff]/30 hover:text-white"
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
                    </div>
                  )}
                </div>

                <aside className="space-y-6 lg:col-span-4">
                  <div className="rounded-xl bg-[#151b2d] p-6">
                    <h3 className="font-headline text-xl font-bold text-slate-100">Active Setup</h3>
                    <div className="mt-4 space-y-3 text-sm text-[#c2c6d6]">
                      {selectedOutputs.includes("image") && (
                        <div className="flex items-center justify-between gap-3 rounded-lg bg-[#2e3447] px-4 py-3">
                          <span>Image model</span>
                          <span className="font-medium text-white">{selectedImageModelEntry?.display_name || selectedImageModel || "None"}</span>
                        </div>
                      )}
                      {selectedOutputs.includes("caption") && (
                        <div className="flex items-center justify-between gap-3 rounded-lg bg-[#2e3447] px-4 py-3">
                          <span>Text model</span>
                          <span className="font-medium text-white">{selectedCaptionModelEntry?.display_name || selectedCaptionModel || "None"}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-3 rounded-lg bg-[#2e3447] px-4 py-3">
                        <span>Method</span>
                        <span className="font-medium text-white">Smart</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-lg bg-[#2e3447] px-4 py-3">
                        <span>Analysis fee</span>
                        <span className="font-medium text-white">{smartAnalysisFee.toFixed(2)} credits</span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl bg-[#151b2d] p-6">
                    <h3 className="font-headline text-xl font-bold text-slate-100">Estimated Cost</h3>
                    <div className="mt-4 space-y-3">
                      {selectedOutputs.includes("image") && (
                        <div className="flex items-center justify-between text-sm text-[#c2c6d6]">
                          <span>Image generation</span>
                          <span className="font-medium text-white">{imageGenerationCost.toFixed(2)} credits</span>
                        </div>
                      )}
                      {selectedOutputs.includes("caption") && (
                        <div className="flex items-center justify-between text-sm text-[#c2c6d6]">
                          <span>Caption generation</span>
                          <span className="font-medium text-white">{captionGenerationCost.toFixed(2)} credits</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-sm text-[#c2c6d6]">
                        <span>Analyze and optimize</span>
                        <span className="font-medium text-white">{smartAnalysisFee.toFixed(2)} credits</span>
                      </div>
                      <div className="border-t border-white/10 pt-3">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white">Total</span>
                          <span className="font-headline text-lg font-bold text-[#adc6ff]">{smartTotalCost.toFixed(2)} credits</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {inputImage && (
                    <div className="rounded-xl bg-[#151b2d] p-6">
                      <h3 className="font-headline text-xl font-bold text-slate-100">Reference Asset</h3>
                      <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-[#070d1f]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={inputImage.previewUrl} alt={inputImage.name} className="h-52 w-full object-cover" />
                      </div>
                    </div>
                  )}
                </aside>
              </section>

              <footer className="fixed bottom-0 left-0 right-0 z-40 p-6 md:left-64">
                <div className="mx-auto max-w-5xl">
                  <div className="flex flex-col gap-6 rounded-2xl border border-[#4d8eff]/10 bg-[rgba(25,31,49,0.7)] p-4 shadow-2xl backdrop-blur-[16px] md:flex-row md:items-center">
                    <div className="flex-1">
                      <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-[#4d8eff]/80">Optimized Prompt Preview</label>
                      <div className="overflow-x-auto whitespace-nowrap rounded-xl border border-white/10 bg-[rgba(7,13,31,0.8)] p-4 font-mono text-sm leading-relaxed text-[#adc6ff] md:whitespace-normal">
                        <span className="font-bold text-[#4d8eff]">/generate </span>
                        <span className="text-white">
                          {selectedOutputs.includes("image")
                            ? contentPrompts.image_prompt || userText
                            : contentPrompts.caption_prompt || userText}
                        </span>
                      </div>
                    </div>
                    <div className="flex w-full flex-col gap-3 md:w-auto">
                      <button onClick={handleBackFromReview} className="rounded-xl border border-white/10 bg-[#151b2d] px-6 py-3 text-sm font-semibold text-[#c2c6d6] transition hover:bg-[#23293c] hover:text-white">
                        Back To Modes
                      </button>
                      <button
                        onClick={handleGenerate}
                        disabled={loading}
                        className="flex h-16 items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-[#adc6ff] to-[#4d8eff] px-10 font-headline text-base font-bold text-[#00285d] shadow-[0_0_20px_rgba(77,142,255,0.3)] transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {loading ? <LoadingSpinner text="Generating..." /> : <>
                          GENERATE
                          <span className="material-symbols-outlined text-2xl">auto_awesome</span>
                        </>}
                      </button>
                    </div>
                  </div>
                </div>
              </footer>
            </div>
          )}

          {/* ─── STEP 3: RESULT ─── */}
          {step === "RESULT" && (
            <div className="animate-scale-in space-y-10">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <nav className="mb-2 flex items-center gap-2 text-sm text-[#c2c6d6]">
                    <span>Generator</span>
                    <span className="material-symbols-outlined text-xs">chevron_right</span>
                    <span className="font-medium text-[#adc6ff]">Result</span>
                  </nav>
                  <h1 className="font-headline text-4xl font-bold tracking-tight text-white">
                    {userText.trim() ? userText.trim().slice(0, 42) : "Generated Content"}
                  </h1>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#23293c] px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#33394c]"
                  >
                    <span className="material-symbols-outlined text-sm">arrow_back</span>
                    Back to Studio
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#adc6ff] to-[#4d8eff] px-6 py-2.5 text-sm font-bold text-[#00285d] shadow-lg shadow-[#adc6ff]/10 transition-all hover:brightness-110"
                  >
                    <span className="material-symbols-outlined text-sm">refresh</span>
                    Create Again
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
                <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#070d1f] lg:col-span-8">
                  <div className={`${finalResults.image ? "relative aspect-[4/5] w-full md:aspect-[16/10]" : "flex min-h-[420px] items-center justify-center p-12"}`}>
                    {finalResults.image ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={finalResults.image}
                          alt="Generated result"
                          className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.02]"
                        />
                        <div className="absolute right-6 top-6">
                          <span className="rounded-full border border-[#adc6ff]/20 bg-[rgba(25,31,49,0.7)] px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[#adc6ff] backdrop-blur-[16px]">
                            Smart Result
                          </span>
                        </div>
                        <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-white/10 bg-[rgba(25,31,49,0.7)] p-2 opacity-0 backdrop-blur-[16px] transition-opacity duration-300 group-hover:opacity-100">
                          <a
                            href={finalResults.image}
                            download
                            className="rounded-xl p-3 text-white transition-colors hover:bg-white/10"
                            title="Download"
                          >
                            <span className="material-symbols-outlined">download</span>
                          </a>
                          <div className="mx-1 h-6 w-px bg-white/10" />
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(finalResults.image);
                                showToast("Image link copied.", "success");
                              } catch {
                                showToast("Could not copy image link.");
                              }
                            }}
                            className="rounded-xl p-3 text-white transition-colors hover:bg-white/10"
                            title="Copy Link"
                          >
                            <span className="material-symbols-outlined">link</span>
                          </button>
                          <div className="mx-1 h-6 w-px bg-white/10" />
                          <button
                            type="button"
                            onClick={handleReset}
                            className="rounded-xl p-3 text-white transition-colors hover:bg-white/10"
                            title="Create again"
                          >
                            <span className="material-symbols-outlined">autorenew</span>
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="text-center">
                        <span className="material-symbols-outlined text-5xl text-[#4d8eff]">notes</span>
                        <p className="mt-4 font-headline text-2xl font-bold text-white">Caption Result Ready</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-6 lg:col-span-4">
                  {finalResults.caption && (
                    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[rgba(25,31,49,0.7)] p-8 backdrop-blur-[16px]">
                      <div className="absolute right-0 top-0 p-4 opacity-10">
                        <span className="material-symbols-outlined text-4xl">format_quote</span>
                      </div>
                      <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-[#adc6ff]">AI Generated Caption</h3>
                      <p className="mb-8 text-lg font-light italic leading-relaxed text-[#dce1fb]">
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
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#adc6ff]/30 bg-[rgba(25,31,49,0.7)] px-4 py-3 font-bold text-[#adc6ff] transition-colors hover:bg-[#adc6ff]/10"
                      >
                        <span className="material-symbols-outlined text-sm">content_copy</span>
                        Copy Caption
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    {selectedOutputs.includes("image") && (
                      <div className="rounded-xl border border-white/5 bg-[#151b2d] p-4">
                        <p className="mb-1 text-[10px] uppercase tracking-widest text-[#c2c6d6]">Image Model</p>
                        <p className="font-headline font-medium text-white">{selectedImageModelEntry?.display_name || selectedImageModel || "N/A"}</p>
                      </div>
                    )}
                    {selectedOutputs.includes("caption") && (
                      <div className="rounded-xl border border-white/5 bg-[#151b2d] p-4">
                        <p className="mb-1 text-[10px] uppercase tracking-widest text-[#c2c6d6]">Text Model</p>
                        <p className="font-headline font-medium text-white">{selectedCaptionModelEntry?.display_name || selectedCaptionModel || "N/A"}</p>
                      </div>
                    )}
                    <div className="rounded-xl border border-white/5 bg-[#151b2d] p-4">
                      <p className="mb-1 text-[10px] uppercase tracking-widest text-[#c2c6d6]">Method</p>
                      <p className="font-headline font-medium text-white">Smart</p>
                    </div>
                    <div className="rounded-xl border border-white/5 bg-[#151b2d] p-4">
                      <p className="mb-1 text-[10px] uppercase tracking-widest text-[#c2c6d6]">Estimated Cost</p>
                      <p className="font-headline font-medium text-white">
                        {smartTotalCost.toFixed(2)} credits
                      </p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-[#2e34474d] p-6">
                    <h4 className="mb-4 text-xs font-bold uppercase tracking-widest text-[#c2c6d6]">Post to Feed</h4>
                    <div className="flex gap-2">
                      <button className="flex-1 rounded-lg border border-white/10 bg-[rgba(25,31,49,0.7)] py-2 text-xs font-bold text-white">
                        PUBLIC
                      </button>
                      <button className="flex-1 rounded-lg border border-[#adc6ff]/30 bg-[#adc6ff]/20 py-2 text-xs font-bold text-[#adc6ff]">
                        PRIVATE
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-12">
                <details className="group overflow-hidden rounded-2xl border border-white/10 bg-[#151b2d]">
                  <summary className="flex cursor-pointer list-none items-center justify-between p-5 transition-colors hover:bg-[#23293c]">
                    <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-[#adc6ff]" style={{ fontVariationSettings: "'FILL' 1" }}>terminal</span>
                      <span className="font-headline font-bold tracking-tight text-white">Prompt Recap &amp; Settings</span>
                    </div>
                    <span className="material-symbols-outlined transition-transform duration-300 group-open:rotate-180">expand_more</span>
                  </summary>
                  <div className="grid grid-cols-1 gap-12 p-8 pt-2 md:grid-cols-2">
                    <div>
                      <h5 className="mb-3 text-[10px] uppercase tracking-[0.2em] text-[#adc6ff]">Positive Prompt</h5>
                      <p className="rounded-xl border border-white/5 bg-[#070d1f] p-4 font-mono text-sm leading-relaxed text-[#c2c6d6]">
                        {selectedOutputs.includes("image")
                          ? contentPrompts.image_prompt || userText
                          : contentPrompts.caption_prompt || userText}
                      </p>
                    </div>
                    <div className="space-y-6">
                      <div>
                        <h5 className="mb-3 text-[10px] uppercase tracking-[0.2em] text-[#adc6ff]">Style &amp; Filters</h5>
                        <div className="flex flex-wrap gap-2">
                          {[...(selectedOutputs.includes("image") && uiSchema.image ? Object.values(uiSchema.image) : []), ...(selectedOutputs.includes("caption") && uiSchema.caption ? Object.values(uiSchema.caption) : [])]
                            .map((item) => item.value)
                            .filter(Boolean)
                            .slice(0, 8)
                            .map((value, index) => (
                              <span key={`${value}-${index}`} className="rounded-full border border-white/10 bg-[#2e3447] px-3 py-1 text-xs text-white">
                                {String(value)}
                              </span>
                            ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <h5 className="mb-1 text-[10px] uppercase tracking-widest text-[#c2c6d6]">Smart Analysis</h5>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#2e3447]">
                            <div className="h-full w-[100%] bg-[#adc6ff]" />
                          </div>
                          <p className="mt-1 text-right text-[10px] text-[#c2c6d6]">On</p>
                        </div>
                        <div>
                          <h5 className="mb-1 text-[10px] uppercase tracking-widest text-[#c2c6d6]">Output Count</h5>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#2e3447]">
                            <div className={`h-full bg-[#adc6ff] ${selectedOutputs.length === 2 ? "w-[100%]" : "w-[50%]"}`} />
                          </div>
                          <p className="mt-1 text-right text-[10px] text-[#c2c6d6]">{selectedOutputs.length}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </details>
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
            onClick={() => setIsModePickerOpen(false)}
            className="absolute inset-0 h-full w-full"
          />
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute right-0 top-0 flex h-full w-full max-w-[760px] items-stretch">
              <div className="pointer-events-auto flex h-full w-full flex-col border-l border-white/5 bg-[rgba(12,19,36,0.92)] px-5 py-6 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-[20px] sm:px-6">
                <div className="flex items-center justify-between">
                  <h2 className="font-headline text-xl font-bold tracking-tight text-slate-100">Generation Settings</h2>
                  <button
                    type="button"
                    onClick={() => setIsModePickerOpen(false)}
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
                              const active = selectedImageModel === modelId && selectedCaptionModel === modelId;
                              return (
                                <button
                                  key={modelId}
                                  type="button"
                                  onClick={() => {
                                    setSelectedImageModel(modelId);
                                    setSelectedCaptionModel(modelId);
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
                                    <div className="mt-1 text-[11px] text-[#8c909f]">
                                      {(model?.provider || "catalog")} · image + text
                                    </div>
                                  </div>
                                  <div className="shrink-0 text-[11px] text-[#c2c6d6]">
                                    {Number((((modelCatalog.image?.[modelId]?.cost ?? 0) + (modelCatalog.caption?.[modelId]?.cost ?? 0)).toFixed(2)))} cr
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                          {sharedMultimodalModels.length === 0 && (
                            <p className="text-sm text-[#8c909f]">No multimodal models available.</p>
                          )}
                          {selectedImageModelEntry && selectedCaptionModelEntry && selectedImageModel === selectedCaptionModel && (
                            <div className="mt-3 flex items-center justify-between px-1 text-[11px] text-[#c2c6d6]">
                              <span>{selectedImageModelEntry.provider || selectedCaptionModelEntry.provider || "catalog"}</span>
                              <span>{(imageGenerationCost + captionGenerationCost).toFixed(2)} credits</span>
                            </div>
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
                              const active = selectedCaptionModel === modelId;
                              return (
                                <button
                                  key={modelId}
                                  type="button"
                                  onClick={() => setSelectedCaptionModel(modelId)}
                                  disabled={loading}
                                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left text-[13px] font-medium transition-all ${
                                    active
                                      ? "border border-[#4d8eff66] bg-[#4d8eff1a] font-semibold text-[#adc6ff] shadow-[0_0_0_1px_rgba(77,142,255,0.4),0_0_15px_rgba(77,142,255,0.2)]"
                                      : "border border-white/5 bg-[#151b2d] text-[#c2c6d6] hover:border-[#4d8eff40] hover:text-white"
                                  }`}
                                >
                                  <div className="min-w-0">
                                    <div className="truncate">{model?.display_name || modelId}</div>
                                    <div className="mt-1 text-[11px] text-[#8c909f]">
                                      {model?.provider || "catalog"}
                                    </div>
                                  </div>
                                  <div className="shrink-0 text-[11px] text-[#c2c6d6]">
                                    {Number((model?.cost ?? 0).toFixed(2))} cr
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                          {filteredCaptionModels.length === 0 && (
                            <p className="text-sm text-[#8c909f]">No text models available.</p>
                          )}
                          {selectedCaptionModelEntry && (
                            <div className="mt-3 flex items-center justify-between px-1 text-[11px] text-[#c2c6d6]">
                              <span>{selectedCaptionModelEntry.provider || "catalog"}</span>
                              <span>{captionGenerationCost.toFixed(2)} credits</span>
                            </div>
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
                              const active = selectedImageModel === modelId;
                              return (
                                <button
                                  key={modelId}
                                  type="button"
                                  onClick={() => setSelectedImageModel(modelId)}
                                  disabled={loading}
                                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left text-[13px] font-medium transition-all ${
                                    active
                                      ? "border border-[#4d8eff66] bg-[#4d8eff1a] font-semibold text-[#adc6ff] shadow-[0_0_0_1px_rgba(77,142,255,0.4),0_0_15px_rgba(77,142,255,0.2)]"
                                      : "border border-white/5 bg-[#151b2d] text-[#c2c6d6] hover:border-[#4d8eff40] hover:text-white"
                                  }`}
                                >
                                  <div className="min-w-0">
                                    <div className="truncate">{model?.display_name || modelId}</div>
                                    <div className="mt-1 text-[11px] text-[#8c909f]">
                                      {model?.provider || "catalog"}
                                    </div>
                                  </div>
                                  <div className="shrink-0 text-[11px] text-[#c2c6d6]">
                                    {Number((model?.cost ?? 0).toFixed(2))} cr
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                          {filteredImageModels.length === 0 && (
                            <p className="text-sm text-[#8c909f]">No image models available.</p>
                          )}
                          {selectedImageModelEntry && (
                            <div className="mt-3 flex items-center justify-between px-1 text-[11px] text-[#c2c6d6]">
                              <span>{selectedImageModelEntry.provider || "catalog"}</span>
                              <span>{imageGenerationCost.toFixed(2)} credits</span>
                            </div>
                          )}
                        </div>
                      )}
                        </>
                      )}
                    </div>
                  </section>

                  <section>
                    <label className="mb-3 block text-[13px] font-medium text-[#c2c6d6]">Creation Method</label>
                    <div className="rounded-xl border border-[#4d8eff66] bg-[rgba(46,52,71,0.4)] p-4 shadow-[0_0_0_1px_rgba(77,142,255,0.4),0_0_15px_rgba(77,142,255,0.2)]">
                      <div className="mb-3 text-[#b9c8de]">
                        <span className="material-symbols-outlined">auto_awesome</span>
                      </div>
                      <h3 className="font-headline text-sm font-bold text-white">Smart Content Creation</h3>
                      <p className="mt-1 text-[11px] leading-relaxed text-[#c2c6d6]">
                        Analyze the idea first, review the prompt direction, then generate with more control.
                      </p>
                    </div>
                  </section>

                  <section className="space-y-3">
                    <label className="block text-[13px] font-medium text-[#c2c6d6]">Cost Estimate</label>
                    <div className="rounded-lg bg-[rgba(7,13,31,0.4)] p-4">
                      <div className="space-y-3">
                        {selectedOutputs.includes("caption") && (
                          <div className="flex items-center justify-between gap-3 text-[13px]">
                            <span className="text-[#c2c6d6]">
                              Caption generation · {selectedCaptionModelEntry?.display_name || selectedCaptionModel || "selected model"}
                            </span>
                            <span className="font-medium text-white">{captionGenerationCost.toFixed(2)} credits</span>
                          </div>
                        )}
                        {selectedOutputs.includes("image") && (
                          <div className="flex items-center justify-between gap-3 text-[13px]">
                            <span className="text-[#c2c6d6]">
                              Image generation · {selectedImageModelEntry?.display_name || selectedImageModel || "selected model"}
                            </span>
                            <span className="font-medium text-white">{imageGenerationCost.toFixed(2)} credits</span>
                          </div>
                        )}
                        <div className="h-px bg-white/10" />
                        <div className="flex items-center justify-between gap-3 text-[13px]">
                          <span className="text-[#c2c6d6]">Smart analysis</span>
                          <span className="font-medium text-white">{smartAnalysisFee.toFixed(2)} credits</span>
                        </div>
                        <div className="h-px bg-white/10" />
                        <div className="flex items-center justify-between">
                          <span className="text-[13px] font-bold text-white">Total</span>
                          <span className="text-[13px] font-bold text-[#adc6ff]">
                            {smartTotalCost.toFixed(2)} credits
                          </span>
                        </div>
                      </div>
                    </div>
                    {insufficientSmartCredits && (
                      <p className="text-sm leading-6 text-[#ffb4ab]">
                        You need {smartTotalCost.toFixed(2)} credits for Smart mode.
                      </p>
                    )}
                  </section>
                </div>

                <div className="mt-8">
                  <button
                    type="button"
                    onClick={handleModeContinue}
                    disabled={loading || insufficientSmartCredits}
                    className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#adc6ff] to-[#4d8eff] py-4 text-sm font-bold tracking-wide text-[#002e6a] shadow-[0_8px_20px_rgba(77,142,255,0.3)] transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? (
                      <LoadingSpinner text="Preparing..." />
                    ) : insufficientSmartCredits ? (
                      `Insufficient Credits (${smartTotalCost.toFixed(2)} needed)`
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
