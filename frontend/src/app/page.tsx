// frontend/src/app/page.tsx
"use client";

import { useState, useEffect, useRef, useMemo, useCallback, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { api } from "../services/api";
import { GenerateRequest, UISchemaItem, OutputType, ModelCatalogEntry } from "../types";
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
  data: string;
  previewUrl: string;
  size: number;
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_PROXY_IMAGE_DIMENSION = 1536;
const MAX_PROXY_IMAGE_BYTES = 1_800_000;

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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read the selected file."));
        return;
      }
      const base64 = result.split(",")[1];
      if (!base64) {
        reject(new Error("Could not parse the uploaded image."));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
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

  // Input State
  const [userText, setUserText] = useState("");
  const [selectedOutputs, setSelectedOutputs] = useState<OutputType[]>(["caption", "image"]);

  // Model Selections
  const [selectedImageModel, setSelectedImageModel] = useState("");
  const [selectedCaptionModel, setSelectedCaptionModel] = useState("");

  // Model Catalog (with costs)
  const [modelCatalog, setModelCatalog] = useState<Record<string, Record<string, ModelCatalogEntry>>>({});
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

  // Fetch history on auth
  const fetchHistory = useCallback(async () => {
    if (!user) return;
    setHistoryLoading(true);
    try {
      const entries = await getHistory(user.uid);
      setHistory(entries);
    } catch (e) {
      console.error("Failed to load history:", e);
    } finally {
      setHistoryLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) fetchHistory();
  }, [user, fetchHistory]);

  // --- Toast helper ---
  const showToast = (message: string, type: "error" | "success" = "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // --- Load Config on Mount ---
  useEffect(() => {
    api.getConfig().then((cfg) => {
      setModelCatalog(cfg.model_catalog || {});
      const imgMods = Object.keys(cfg.model_catalog.image || {});
      const capMods = Object.keys(cfg.model_catalog.caption || {});
      if (imgMods.length > 0) setSelectedImageModel(imgMods[0]);
      if (capMods.length > 0) setSelectedCaptionModel(capMods[0]);
    }).catch(() => {
      showToast("Could not load configuration. Is the backend running?");
    });
  }, []);

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

    if (keepalive && typeof window !== "undefined" && user) {
      const token = await user.getIdToken();
      fetch(`https://aistudio.ouni.space/api/analyze-sessions/${sessionId}/abandon`, {
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
      const data = await fileToBase64(file);
      setInputImage((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return {
          name: file.name,
          mimeType: file.type,
          data,
          previewUrl: URL.createObjectURL(file),
          size: file.size,
        };
      });
      if (file.size < originalFile.size) {
        showToast("Image optimized for upload.", "success");
      }
    } catch (error) {
      console.error("Image upload error:", error);
      showToast("Could not process that image.");
    } finally {
      event.target.value = "";
    }
  }, []);

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
      const payload: GenerateRequest = {
        user_text: effectiveText,
        requested_outputs: selectedOutputs,
        input_image: inputImage ? {
          name: inputImage.name,
          mime_type: inputImage.mimeType,
          data: inputImage.data,
        } : null,
        user_preferences: {
          image_model: selectedImageModel,
          caption_model: selectedCaptionModel,
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
    } catch {
      showToast("Error contacting backend. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setLoading(true);
    try {
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
        input_image: inputImage ? {
          name: inputImage.name,
          mime_type: inputImage.mimeType,
          data: inputImage.data,
        } : null,
        status: "generating",
        user_preferences: {
          image_model: selectedImageModel,
          caption_model: selectedCaptionModel,
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
              imageUrl: response.results.image || undefined,
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
    } catch {
      showToast("Generation failed. Please try again.");
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
  };

  const handlePresetClick = (prompt: string) => {
    setUserText(prompt);
  };

  // --- Render ---
  if (authLoading || !user) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="auth-loader" />
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
        <CreditsDisplay ref={creditsRef} uid={user.uid} onCreditsChange={handleCreditsChange} />

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
                onClick={() => handleAnalyze()}
                disabled={loading || !userText.trim() || selectedOutputs.length === 0 || insufficientCredits || missingRequiredModel}
                className="btn-primary w-full"
              >
                <span>
                  {loading ? <LoadingSpinner text="Analyzing Intent..." /> : insufficientCredits ? `Insufficient Credits (${totalCost.toFixed(2)} needed)` : missingRequiredModel ? "Select a valid model to continue" : `Start Creating → (${totalCost.toFixed(2)} credits)`}
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
                    The AI suggests these settings for your content. Adjust if needed.
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
                  ← Back
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={loading}
                  className="btn-generate w-full flex-1"
                >
                  {loading ? <LoadingSpinner text="Generating Assets..." /> : "Confirm & Generate ✨"}
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
    </main>
  );
}
