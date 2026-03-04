// frontend/src/app/page.tsx
"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "../services/api";
import { GenerateRequest, UISchemaItem, OutputType } from "../types";
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
import type { CreditsDisplayHandle } from "../components/CreditsDisplay";
import { deductCredits } from "../lib/credits";
import { addHistoryEntry, getHistory, HistoryEntry } from "../lib/history";

type Step = "INPUT" | "REVIEW" | "RESULT";

interface Toast {
  message: string;
  type: "error" | "success";
}

export default function Home() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const creditsRef = useRef<CreditsDisplayHandle>(null);

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

  // Available Models (Loaded from Backend)
  const [imageModels, setImageModels] = useState<string[]>([]);
  const [captionModels, setCaptionModels] = useState<string[]>([]);

  // Model Catalog (with costs)
  const [modelCatalog, setModelCatalog] = useState<Record<string, Record<string, { cost?: number }>>>({});

  // Current credit balance (synced from CreditsDisplay)
  const [currentCredits, setCurrentCredits] = useState<number | null>(null);

  // Review & Result State
  const [uiSchema, setUiSchema] = useState<Record<string, Record<string, UISchemaItem>>>({});
  const [finalResults, setFinalResults] = useState<Record<string, string>>({});
  const [contentPrompts, setContentPrompts] = useState<Record<string, string>>({});

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
      const imgMods = Object.keys(cfg.model_catalog.image || {});
      setImageModels(imgMods);
      if (imgMods.length > 0) setSelectedImageModel(imgMods[0]);

      const capMods = Object.keys(cfg.model_catalog.caption || {});
      setCaptionModels(capMods);
      if (capMods.length > 0) setSelectedCaptionModel(capMods[0]);

      // Store full catalog for cost lookup
      setModelCatalog(cfg.model_catalog || {});
    }).catch(() => {
      showToast("Could not load configuration. Is the backend running?");
    });
  }, []);

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

  const handleCreditsChange = useCallback((credits: number | null) => {
    setCurrentCredits(credits);
  }, []);

  // --- Helpers ---
  const toggleOutput = (type: OutputType) => {
    setSelectedOutputs((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  // --- Handlers ---
  const handleAnalyze = async () => {
    setLoading(true);
    try {
      const payload: GenerateRequest = {
        user_text: userText,
        requested_outputs: selectedOutputs,
        user_preferences: {
          image_model: selectedImageModel,
          caption_model: selectedCaptionModel,
        },
        status: "processing",
      };

      const response = await api.generate(payload);

      if (response.status === "awaiting_review" && response.ui_schema) {
        setUiSchema(response.ui_schema);
        setContentPrompts(response.content_prompts || {});
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
      const corrections: Record<string, any> = {};
      Object.values(uiSchema).forEach((fields) => {
        Object.entries(fields).forEach(([key, item]) => {
          corrections[key] = item.value;
        });
      });

      const payload: GenerateRequest = {
        user_text: userText,
        requested_outputs: selectedOutputs,
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

        // Deduct credits based on total_cost from backend
        const cost = response.meta?.total_cost ?? 0;
        if (cost > 0 && user) {
          const success = await deductCredits(user.uid, cost);
          if (!success) {
            showToast("Insufficient credits for this generation.");
          }
          creditsRef.current?.refresh();
        }

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
    setStep("INPUT");
    setFinalResults({});
    setUserText("");
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
    <main className="min-h-screen flex items-start justify-center px-4 py-12 sm:py-20">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8 animate-fade-in relative">
          <button
            onClick={async () => { await signOutUser(); router.replace("/auth"); }}
            className="absolute right-0 top-2 flex items-center gap-1.5 text-sm text-gray-400 hover:text-red-400 transition-colors px-4 py-2 rounded-full border border-white/10 hover:border-red-500/30 bg-white/5 hover:bg-red-500/10"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sign Out
          </button>
          <h1 className="text-4xl sm:text-5xl font-extrabold gradient-text tracking-tight">
            NovaNode AI Studio
          </h1>
          <p className="mt-3 text-sm text-gray-500">
            Create stunning content with AI-powered generation
          </p>
        </div>

        {/* Credits */}
        <CreditsDisplay ref={creditsRef} uid={user.uid} onCreditsChange={handleCreditsChange} />

        {/* Step Indicator */}
        <StepIndicator currentStep={step} />

        {/* Main Glass Card */}
        <div className="glass-card p-6 sm:p-8">

          {/* ─── STEP 1: INPUT ─── */}
          {step === "INPUT" && (
            <div className="space-y-7 stagger-children">

              {/* Output Type Selection */}
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
                  I want to generate
                </label>
                <div className="flex gap-3">
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

              {/* Model Configuration */}
              <div className="grid grid-cols-2 gap-4">
                <ModelSelector
                  label="Text Model"
                  models={captionModels}
                  selected={selectedCaptionModel}
                  onChange={setSelectedCaptionModel}
                  disabled={!selectedOutputs.includes("caption")}
                  accent="blue"
                />
                <ModelSelector
                  label="Image Model"
                  models={imageModels}
                  selected={selectedImageModel}
                  onChange={setSelectedImageModel}
                  disabled={!selectedOutputs.includes("image")}
                  accent="purple"
                />
              </div>

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
                onClick={handleAnalyze}
                disabled={loading || !userText.trim() || selectedOutputs.length === 0 || insufficientCredits}
                className="btn-primary w-full"
              >
                <span>
                  {loading ? <LoadingSpinner text="Analyzing Intent..." /> : insufficientCredits ? `Insufficient Credits (${totalCost.toFixed(2)} needed)` : `Start Creating → (${totalCost.toFixed(2)} credits)`}
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
              <div className="flex gap-3 pt-4">
                <button onClick={() => setStep("INPUT")} className="btn-secondary">
                  ← Back
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={loading}
                  className="btn-generate flex-1"
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
          Powered by NovaNode
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