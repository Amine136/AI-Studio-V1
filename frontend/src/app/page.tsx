// frontend/src/app/page.tsx
"use client";

import { useState, useEffect } from "react";
import { api } from "../services/api";
import { GenerateRequest, UISchemaItem, OutputType } from "../types";

import StepIndicator from "../components/StepIndicator";
import OutputToggle from "../components/OutputToggle";
import ModelSelector from "../components/ModelSelector";
import ReviewCard from "../components/ReviewCard";
import ResultCard from "../components/ResultCard";
import LoadingSpinner from "../components/LoadingSpinner";

type Step = "INPUT" | "REVIEW" | "RESULT";

interface Toast {
  message: string;
  type: "error" | "success";
}

export default function Home() {
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

  // Review & Result State
  const [uiSchema, setUiSchema] = useState<Record<string, Record<string, UISchemaItem>>>({});
  const [finalResults, setFinalResults] = useState<Record<string, string>>({});

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
    }).catch(() => {
      showToast("Could not load configuration. Is the backend running?");
    });
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
        user_corrections: corrections,
      };

      const response = await api.generate(payload);

      if (response.status === "success" && response.results) {
        setFinalResults(response.results);
        setStep("RESULT");
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
  return (
    <main className="min-h-screen flex items-start justify-center px-4 py-12 sm:py-20">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8 animate-fade-in">
          <h1 className="text-4xl sm:text-5xl font-extrabold gradient-text tracking-tight">
            NovaNode AI Studio
          </h1>
          <p className="mt-3 text-sm text-gray-500">
            Create stunning content with AI-powered generation
          </p>
        </div>

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

              {/* Submit Button */}
              <button
                onClick={handleAnalyze}
                disabled={loading || !userText.trim() || selectedOutputs.length === 0}
                className="btn-primary w-full"
              >
                <span>
                  {loading ? <LoadingSpinner text="Analyzing Intent..." /> : "Start Creating →"}
                </span>
              </button>
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

              {/* Review Cards by Output Type */}
              {Object.entries(uiSchema).map(([outputType, fields]) => (
                <ReviewCard
                  key={outputType}
                  outputType={outputType}
                  fields={fields}
                  onFieldChange={(key, value) => handleSchemaChange(outputType, key, value)}
                />
              ))}

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
          Powered by NovaNode AI Studio • Models are served via backend API
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