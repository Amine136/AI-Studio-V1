// frontend/src/app/page.tsx
"use client";

import { useState, useEffect, useRef, useMemo, useCallback, type ChangeEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "../services/api";
import { GenerateRequest, UISchemaItem, OutputType, ModelCatalogEntry, SystemConfig } from "../types";
import { useAuth } from "../context/AuthContext";
import { signOutUser } from "../lib/auth";

import StepIndicator from "../components/StepIndicator";
import OutputToggle from "../components/OutputToggle";
import ModelSelector from "../components/ModelSelector";
import ReviewCard from "../components/ReviewCard";
import ResultCard from "../components/ResultCard";
import LoadingSpinner from "../components/LoadingSpinner";
import CreditsDisplay from "../components/CreditsDisplay";
import HistoryGrid from "../components/HistoryGrid";
import AnimatedLogo from "../components/AnimatedLogo";
import type { CreditsDisplayHandle } from "../components/CreditsDisplay";
import { addHistoryEntry, getHistory, HistoryEntry } from "../lib/history";

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

const IDEA_PRESETS = [
  {
    title: "Coffee Launch",
    description: "Launch post for a cozy specialty coffee drink with warm visuals.",
    prompt: "Create a launch campaign for a new signature iced coffee drink in a cozy specialty cafe, with a premium but friendly vibe.",
  },
  {
    title: "Skincare Promo",
    description: "Luxury beauty content for a clean skincare product.",
    prompt: "Create content for a luxury skincare serum launch with clean minimal visuals, soft lighting, and a high-end beauty brand tone.",
  },
  {
    title: "Restaurant Reel",
    description: "Short-form social content for a dish promotion.",
    prompt: "Create a viral social media promo for a restaurant's best-selling burger with cinematic food visuals and energetic copy.",
  },
  {
    title: "Tech Product",
    description: "Modern campaign for a sleek device announcement.",
    prompt: "Create a product announcement campaign for a sleek wireless headset on a modern desk setup with futuristic but clean branding.",
  },
];

export default function Home() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
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
  const [selectedMode, setSelectedMode] = useState<"quick" | "smart">("quick");

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
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
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
    setHistory([]);
    setHistoryLoading(false);
    return true;
  }, []);

  const handleSuspensionMessage = useCallback((message: string) => {
    const nextSuspension = parseSuspensionState(message);
    if (!nextSuspension) return;
    setSuspension(nextSuspension);
    setStep("INPUT");
    setLoading(false);
    setHistory([]);
    setHistoryLoading(false);
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

  // Fetch history on auth
  const fetchHistory = useCallback(async () => {
    if (!user || suspension) return;
    setHistoryLoading(true);
    try {
      const entries = await getHistory(user.uid);
      setHistory(entries);
    } catch (error) {
      if (captureSuspension(error)) {
        return;
      }
      setHistory([]);
      showToast(getErrorMessage(error, "Could not load history."), "error");
    } finally {
      setHistoryLoading(false);
    }
  }, [user, suspension, captureSuspension]);

  useEffect(() => {
    if (user && accountReady && !suspension) {
      fetchHistory();
    }
  }, [user, accountReady, suspension, fetchHistory]);

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
  const toggleOutput = (type: OutputType) => {
    setSelectedOutputs((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

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
            fetchHistory();
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

  const handlePresetClick = (prompt: string) => {
    setUserText(prompt);
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
      fetchHistory();
    } catch (e) {
      console.error("Failed to save history:", e);
    }
  }, [fetchHistory, selectedCaptionModel, selectedImageModel, user]);

  const handleOpenModePicker = () => {
    if (!userText.trim() || selectedOutputs.length === 0 || insufficientCredits || missingRequiredModel || loading) {
      return;
    }
    setSelectedMode("quick");
    setIsModePickerOpen(true);
  };

  const handleQuickGenerate = async () => {
    const effectiveText = userText.trim();
    if (!effectiveText) return;

    setIsModePickerOpen(false);
    setLoading(true);
    try {
      const { imageModel, captionModel } = await getEffectiveModels();

      const payload: GenerateRequest = {
        user_text: effectiveText,
        requested_outputs: selectedOutputs,
        mode: "quick",
        input_image: inputImage ? {
          name: inputImage.name,
          mime_type: inputImage.mimeType,
          url: inputImage.url,
        } : null,
        user_preferences: {
          image_model: imageModel,
          caption_model: captionModel,
        },
        status: "generating",
      };

      const response = await api.generate(payload);

      if (response.status === "success" && response.results) {
        setFinalResults(response.results);
        setStep("RESULT");
        creditsRef.current?.refresh();
        await saveResultToHistory(response.results, effectiveText);
      } else if (response.status === "awaiting_review") {
        throw new Error("Quick mode unexpectedly entered review.");
      } else {
        throw new Error(response.meta?.error_message || "Generation failed. Please try again.");
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

  const handleSmartStart = async () => {
    setIsModePickerOpen(false);
    await handleAnalyze();
  };

  const handleModeContinue = async () => {
    if (selectedMode === "quick") {
      await handleQuickGenerate();
      return;
    }
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
      <main className="min-h-screen flex items-start justify-center px-3 py-8 sm:px-4 sm:py-20">
        <div className="w-full max-w-2xl">
          <div className="mb-8 animate-fade-in">
            <div className="flex justify-end mb-4 sm:mb-0">
              <button
                onClick={async () => { await signOutUser(); router.replace("/auth"); }}
                className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-red-400 transition-colors px-4 py-2 rounded-full border border-white/10 hover:border-red-500/30 bg-white/5 hover:bg-red-500/10"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Sign Out
              </button>
            </div>
            <div className="text-center">
              <div className="mb-4 flex justify-center">
                <AnimatedLogo sizeClassName="h-32 w-32" imageClassName="h-24 w-24" />
              </div>
              <h1 className="text-4xl sm:text-5xl font-extrabold gradient-text tracking-tight">
                Vibecraft
              </h1>
            </div>
          </div>

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
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-start justify-center px-3 py-8 sm:px-4 sm:py-20">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-8 animate-fade-in">
          <div className="flex justify-end mb-4 sm:mb-0">
            <button
              onClick={async () => { await signOutUser(); router.replace("/auth"); }}
              className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-red-400 transition-colors px-4 py-2 rounded-full border border-white/10 hover:border-red-500/30 bg-white/5 hover:bg-red-500/10"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Sign Out
            </button>
          </div>
          <div className="text-center">
          <div className="mb-4 flex justify-center">
            <AnimatedLogo sizeClassName="h-32 w-32" imageClassName="h-24 w-24" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold gradient-text tracking-tight">
            Vibecraft
          </h1>
          <p className="mt-3 text-sm text-gray-500">
            Create stunning content with AI-powered generation
          </p>
          </div>
        </div>

        {/* Credits */}
        <CreditsDisplay
          ref={creditsRef}
          uid={user.uid}
          onCreditsChange={handleCreditsChange}
          onSuspensionDetected={handleSuspensionMessage}
        />

        {/* Step Indicator */}
        <StepIndicator currentStep={step} />

        {/* Main Glass Card */}
        <div className="glass-card p-4 sm:p-8">

          {/* ─── STEP 1: INPUT ─── */}
          {step === "INPUT" && (
            <div className="space-y-7 stagger-children">

              {/* Output Type Selection */}
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
                  I want to generate
                </label>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <OutputToggle
                    type="caption"
                    isSelected={selectedOutputs.includes("caption")}
                    onToggle={() => toggleOutput("caption")}
                  />
                  <OutputToggle
                    type="image"
                    isSelected={selectedOutputs.includes("image")}
                    onToggle={() => toggleOutput("image")}
                  />
                </div>
              </div>

              {/* User Text Input */}
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
                  My Idea
                </label>
                <textarea
                  className="glass-input w-full p-4 text-sm leading-relaxed resize-none"
                  rows={4}
                  maxLength={2000}
                  placeholder="Describe your content idea here..."
                  value={userText}
                  onChange={(e) => setUserText(e.target.value)}
                />
                <p className={`text-[11px] mt-1.5 text-right transition-colors ${userText.length > 1800 ? "text-red-400" : "text-gray-600"
                  }`}>
                  {userText.length}/2000
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-widest">
                      Reference Image
                    </label>
                    <p className="mt-1 text-xs text-gray-500">
                      Optional. Upload an image if you want Gemini to analyze or transform it.
                    </p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={handleImageUpload}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="btn-secondary w-full sm:w-auto"
                    disabled={loading}
                  >
                    {inputImage ? "Replace Image" : "Upload Image"}
                  </button>
                </div>

                {inputImage ? (
                  <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.03] p-4 sm:flex-row sm:items-center">
                    <img
                      src={inputImage.previewUrl}
                      alt={inputImage.name}
                      className="h-24 w-24 rounded-2xl border border-white/10 object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{inputImage.name}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {(inputImage.size / (1024 * 1024)).toFixed(2)} MB • {inputImage.mimeType}
                      </p>
                      <p className="mt-2 text-xs text-cyan-300/80">
                        Upload active. Text analysis is limited to Gemini-family models and image output is limited to Gemini image models.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={clearInputImage}
                      className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/10 hover:text-white"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-[#0c1529] px-4 py-5 text-xs text-slate-500">
                    No image uploaded. All text and image generation models remain available.
                  </div>
                )}
              </div>

              <div>
                <div className="flex flex-col items-start gap-1.5 mb-3 sm:flex-row sm:items-center sm:gap-2.5">
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-widest">
                    Quick Ideas
                  </label>
                  <span className="text-[10px] text-gray-600">
                    Tap one to fill the idea, then adjust models before starting
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {IDEA_PRESETS.map((idea) => (
                    <button
                      key={idea.title}
                      onClick={() => handlePresetClick(idea.prompt)}
                      disabled={loading || insufficientCredits}
                      className="text-left p-4 rounded-xl border border-white/8 bg-white/[0.02] hover:border-blue-500/25 hover:bg-blue-500/[0.04] transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-white">{idea.title}</div>
                          <div className="text-xs text-gray-500 mt-1 leading-relaxed">{idea.description}</div>
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-sm text-gray-400">
                          →
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Model Configuration */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <ModelSelector
                  label="Text Model"
                  models={filteredCaptionModels}
                  selected={selectedCaptionModel}
                  onChange={setSelectedCaptionModel}
                  disabled={!selectedOutputs.includes("caption") || filteredCaptionModels.length === 0 || usesSharedNanoBanana}
                  accent="blue"
                  modelLabels={Object.fromEntries(
                    Object.entries(modelCatalog.caption || {}).map(([id, data]) => [id, data.display_name || id])
                  )}
                />
                <ModelSelector
                  label="Image Model"
                  models={filteredImageModels}
                  selected={selectedImageModel}
                  onChange={setSelectedImageModel}
                  disabled={!selectedOutputs.includes("image") || filteredImageModels.length === 0}
                  accent="purple"
                  modelLabels={Object.fromEntries(
                    Object.entries(modelCatalog.image || {}).map(([id, data]) => [id, data.display_name || id])
                  )}
                />
              </div>

              {inputImage && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <p className="text-xs text-slate-500">
                    Text-only output uses Gemini text models. When an uploaded image also needs image output, Nano Banana handles the full context.
                  </p>
                  <p className="text-xs text-slate-500">
                    Text-to-image uses Nano Banana or Imagen. Image-plus-text output with an uploaded image uses one shared Nano Banana model for both outputs.
                  </p>
                </div>
              )}

              {/* Insufficient Credits Warning */}
              {insufficientCredits && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/5 border border-red-500/20">
                  <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400 text-sm flex-shrink-0 mt-0.5">
                    ⚠
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-red-300">Insufficient Credits</h3>
                    <p className="text-xs text-red-400/70 mt-0.5">
                      This generation costs <strong>{totalCost.toFixed(2)}</strong> credits, but you only have <strong>{currentCredits?.toFixed(2)}</strong>. Please add more credits or select cheaper models.
                    </p>
                  </div>
                </div>
              )}

              {/* Submit Button */}
              <button
                onClick={handleOpenModePicker}
                disabled={loading || !userText.trim() || selectedOutputs.length === 0 || insufficientCredits || missingRequiredModel}
                className="btn-primary w-full"
              >
                  <span>
                  {loading ? <LoadingSpinner text="Preparing..." /> : insufficientCredits ? `Insufficient Credits (${totalCost.toFixed(2)} needed)` : missingRequiredModel ? "Select a valid model to continue" : "Next →"}
                  </span>
              </button>

              {/* Generation History */}
              <HistoryGrid entries={history} loading={historyLoading} />
            </div>
          )}

          {/* ─── STEP 2: REVIEW ─── */}
          {step === "REVIEW" && (
            <div className="space-y-5 animate-fade-in-up">
              {/* Info banner */}
              <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-500/5 border border-blue-500/15">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 text-sm flex-shrink-0 mt-0.5">
                  ◎
                </div>
                <div>
                  <h2 className="text-sm font-bold text-blue-300">Optimization Check</h2>
                  <p className="text-xs text-blue-400/70 mt-0.5">
                    Smart mode prepared these settings for your content. Adjust anything before generating.
                  </p>
                </div>
              </div>

              {/* ─── CAPTION SECTION ─── */}
              {selectedOutputs.includes("caption") && (
                <div className="rounded-2xl border border-blue-500/15 bg-blue-500/[0.02] p-1 space-y-1 animate-fade-in-up" style={{ borderLeft: "3px solid rgba(59, 130, 246, 0.5)" }}>
                  {/* Caption Header */}
                  <div className="flex items-center gap-2.5 px-4 pt-3 pb-1">
                    <div className="w-7 h-7 rounded-lg bg-blue-500/15 flex items-center justify-center text-sm">📝</div>
                    <h3 className="text-xs font-bold uppercase tracking-widest text-blue-400">Caption</h3>
                    <div className="flex-1 h-px bg-blue-500/10" />
                  </div>

                  {/* Caption Prompt */}
                  <div className="px-4 pb-2">
                    <label className="block text-[11px] font-medium text-gray-500 mb-1.5">Generation Prompt</label>
                    <textarea
                      className="glass-input w-full p-3 text-sm leading-relaxed resize-none"
                      rows={3}
                      value={contentPrompts.caption_prompt || ""}
                      onChange={(e) => setContentPrompts(prev => ({ ...prev, caption_prompt: e.target.value }))}
                      placeholder="Marketing context for the caption..."
                    />
                    <p className="text-[10px] text-gray-600 mt-1">
                      Includes marketing context, pricing, and call-to-action.
                    </p>
                  </div>

                  {/* Caption Settings */}
                  {uiSchema.caption && (
                    <ReviewCard
                      outputType="caption"
                      fields={uiSchema.caption}
                      onFieldChange={(key, value) => handleSchemaChange("caption", key, value)}
                    />
                  )}
                </div>
              )}

              {/* ─── IMAGE SECTION ─── */}
              {selectedOutputs.includes("image") && (
                <div className="rounded-2xl border border-purple-500/15 bg-purple-500/[0.02] p-1 space-y-1 animate-fade-in-up" style={{ borderLeft: "3px solid rgba(168, 85, 247, 0.5)" }}>
                  {/* Image Header */}
                  <div className="flex items-center gap-2.5 px-4 pt-3 pb-1">
                    <div className="w-7 h-7 rounded-lg bg-purple-500/15 flex items-center justify-center text-sm">🎨</div>
                    <h3 className="text-xs font-bold uppercase tracking-widest text-purple-400">Image</h3>
                    <div className="flex-1 h-px bg-purple-500/10" />
                  </div>

                  {/* Image Prompt */}
                  <div className="px-4 pb-2">
                    <label className="block text-[11px] font-medium text-gray-500 mb-1.5">Generation Prompt</label>
                    <textarea
                      className="glass-input w-full p-3 text-sm leading-relaxed resize-none"
                      rows={3}
                      value={contentPrompts.image_prompt || ""}
                      onChange={(e) => setContentPrompts(prev => ({ ...prev, image_prompt: e.target.value }))}
                      placeholder="Visual description for the image..."
                    />
                    <p className="text-[10px] text-gray-600 mt-1">
                      Visual-only description. No prices, text, or marketing language.
                    </p>
                  </div>

                  {/* Image Settings */}
                  {uiSchema.image && (
                    <ReviewCard
                      outputType="image"
                      fields={uiSchema.image}
                      onFieldChange={(key, value) => handleSchemaChange("image", key, value)}
                    />
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex flex-col-reverse gap-3 pt-4 sm:flex-row">
                <button onClick={handleBackFromReview} className="btn-secondary w-full sm:w-auto">
                  ← Back To Modes
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={loading}
                  className="btn-generate w-full flex-1"
                >
                  {loading ? <LoadingSpinner text="Generating Assets..." /> : "Generate With Smart Mode ✨"}
                </button>
              </div>
            </div>
          )}

          {/* ─── STEP 3: RESULT ─── */}
          {step === "RESULT" && (
            <div className="space-y-8 animate-scale-in">
              {/* Success banner */}
              <div className="flex items-center gap-3 p-4 rounded-xl bg-green-500/5 border border-green-500/15">
                <div className="w-8 h-8 rounded-full bg-green-500/15 flex items-center justify-center text-green-400 text-sm font-bold">
                  ✓
                </div>
                <h3 className="font-bold text-green-300 text-sm">Content Generated Successfully!</h3>
              </div>

              {/* Results Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {finalResults.caption && (
                  <ResultCard type="caption" content={finalResults.caption} model={selectedCaptionModel} />
                )}
                {finalResults.image && (
                  <ResultCard type="image" content={finalResults.image} model={selectedImageModel} />
                )}
              </div>

              {/* New Project button */}
              <button onClick={handleReset} className="btn-dark w-full">
                Start New Project
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-gray-600 mt-6">
          Powered by Vibecraft
        </p>
      </div>

      {/* Toast notifications */}
      {toast && (
        <div className={`toast ${toast.type === "error" ? "toast-error" : "toast-success"}`}>
          {toast.message}
        </div>
      )}

      {isModePickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#030712]/80 px-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#07111f] p-5 shadow-2xl sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-white">
                  How do you want to create this?
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsModePickerOpen(false)}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setSelectedMode("quick")}
                disabled={loading}
                className={`rounded-3xl border p-5 text-left transition disabled:opacity-50 ${
                  selectedMode === "quick"
                    ? "border-emerald-300/50 bg-emerald-400/[0.10] shadow-[0_0_0_1px_rgba(52,211,153,0.25)]"
                    : "border-emerald-400/25 bg-emerald-400/[0.05] hover:border-emerald-300/40 hover:bg-emerald-400/[0.08]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-lg font-bold text-white">Quick</span>
                  <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200">
                    Recommended
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  Send your idea directly with Vibecraft prompt protection and get the result immediately.
                </p>
                <p className="mt-4 text-xs font-medium uppercase tracking-[0.18em] text-emerald-200/80">
                  Fastest path · base generation cost
                </p>
                <p className="mt-3 text-sm font-semibold text-white">
                  {totalCost.toFixed(2)} credits
                </p>
              </button>

              <button
                type="button"
                onClick={() => setSelectedMode("smart")}
                disabled={loading}
                className={`rounded-3xl border p-5 text-left transition disabled:opacity-50 ${
                  selectedMode === "smart"
                    ? "border-cyan-300/50 bg-cyan-400/[0.10] shadow-[0_0_0_1px_rgba(103,232,249,0.25)]"
                    : "border-cyan-400/25 bg-cyan-400/[0.05] hover:border-cyan-300/40 hover:bg-cyan-400/[0.08]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-lg font-bold text-white">Smart</span>
                  <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                    Review
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  Analyze the intent, review suggested settings, then generate with more control.
                </p>
                <p className="mt-4 text-xs font-medium uppercase tracking-[0.18em] text-cyan-200/80">
                  Better control · generation cost + optimization fee
                </p>
                <p className="mt-3 text-sm font-semibold text-white">
                  {smartTotalCost.toFixed(2)} credits
                </p>
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-slate-400">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Estimated Cost
              </p>
              <div className="mt-3 space-y-2 text-sm">
                {selectedOutputs.includes("caption") && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-300">
                      Text generation using {selectedCaptionModelEntry?.display_name || selectedCaptionModel || "selected model"}
                    </span>
                    <span className="font-semibold text-white">{captionGenerationCost.toFixed(2)} credits</span>
                  </div>
                )}
                {selectedOutputs.includes("image") && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-300">
                      Image generation using {selectedImageModelEntry?.display_name || selectedImageModel || "selected model"}
                    </span>
                    <span className="font-semibold text-white">{imageGenerationCost.toFixed(2)} credits</span>
                  </div>
                )}
                {selectedMode === "smart" && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-300">Analyze and optimize</span>
                    <span className="font-semibold text-white">{smartAnalysisFee.toFixed(2)} credits</span>
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
                <span className="text-sm font-semibold text-slate-200">Total</span>
                <span className="text-sm font-bold text-white">
                  {selectedMode === "quick" ? totalCost.toFixed(2) : smartTotalCost.toFixed(2)} credits
                </span>
              </div>
              {selectedMode === "smart" && insufficientSmartCredits && (
                <p className="mt-3 leading-5 text-red-300">
                  You need {smartTotalCost.toFixed(2)} credits for Smart mode.
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={handleModeContinue}
              disabled={loading || (selectedMode === "smart" && insufficientSmartCredits)}
              className="btn-primary mt-5 w-full"
            >
              {loading ? <LoadingSpinner text="Preparing..." /> : selectedMode === "quick" ? "Continue With Quick →" : insufficientSmartCredits ? `Insufficient Credits (${smartTotalCost.toFixed(2)} needed)` : "Continue With Smart →"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
