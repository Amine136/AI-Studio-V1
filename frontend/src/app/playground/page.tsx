"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, MotionConfig, useReducedMotion, type Variants, type Transition } from "framer-motion";
import { useAuth } from "../../context/AuthContext";
import { recordRecentUpload } from "../../lib/recentUploads";
import { useLanguage } from "../../context/LanguageContext";
import InteractiveAuthenticatedImage from "../../components/InteractiveAuthenticatedImage";
import { isRenderableImageUrl } from "../../components/AuthenticatedImage";
import { ColorPickerPopover } from "../../components/ColorPickerPopover";
import { api, CONTENT_BLOCKED_MESSAGE, MODERATION_UNAVAILABLE_MESSAGE } from "../../services/api";
import { addHistoryEntry } from "../../lib/history";
import { getModelDescription } from "../../lib/modelDescriptions";
import { getUploadConstraints, maxInputImagesForModelId, preferredOutputType, providerLabelForModelId, readImageDimensions, type UploadImageConstraints } from "../../lib/imageInputConstraints";
import { LATENCY_FALLBACK_SECONDS, latencyBudgetForModel } from "../../lib/modelLatency";
import ModelPickerPopover, { type PickerGroup } from "./ModelPickerPopover";
import AspectShapePicker from "../studio/packs/AspectShapePicker";
import type { BillingBreakdown, BillingUsage, ModelPricingSummary, PlainChatModelItem, PlainChatParameterSchemaEntry, PlainChatPart, PlainChatTurnMeta, UploadedImageResult } from "../../types";

type ChatRole = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  parts?: PlainChatPart[];
}

interface UploadedImageState {
  localId: string;
  fileId?: string;
  name: string;
  mimeType: string;
  url?: string;
  previewUrl: string;
  size: number;
  originalSize: number;
  uploading?: boolean;
}

interface ChatModelOption {
  id: string;
  displayName: string;
  description?: string;
  provider: string;
  supportsImageInput: boolean;
  inputModalities: string[];
  outputModalities: string[];
  parameterSchema: Record<string, PlainChatParameterSchemaEntry>;
  pricing?: ModelPricingSummary;
}

interface ProviderGroup {
  provider: string;
  models: ChatModelOption[];
}

// v3 drops the `phase`/`selectedProvider` fields that backed the retired
// full-screen model catalogue. Bumping the key stops a stale v2 blob from
// restoring `phase: "select"` into a page that can no longer render it.
const STORAGE_KEY = "studio-simple-chat-v3";
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// Per-model image limits (count / min dimension / formats) live in
// lib/imageInputConstraints.ts, mirroring the AKM gateway guardrail.
const MAX_PROXY_IMAGE_DIMENSION = 768;
const MAX_PROXY_IMAGE_BYTES = 120_000;
const MAX_CHAT_TEXT_CHARS = 4000;
const DEFAULT_CONVERSATION_TITLE = "New Chat";
// Curated "Recommended" tab surfaced before the real providers. Models are keyed by
// slug (model.id) and rendered in this order. Gold-accented, vs. the blue providers.
const RECOMMENDED_PROVIDER = "Recommended";
const RECOMMENDED_MODEL_IDS = [
  "gemini-3.1-flash-image-preview", // Nano Banana 2
  "imagen-4.0-generate-001", // Imagen 4 Standard
  "grok-imagine-image-quality-editing", // Grok Imagine Quality Editing
  "recraftv4_1_vector", // Recraft V4.1 vector
];
const CHAT_PARAMETER_KEY_MAP = {
  temperature: "temperature",
  topP: "topP",
  maxOutputTokens: "maxTokens",
  thinkingBudget: "thinkingBudget",
  thinkingLevel: "thinkingLevel",
  presencePenalty: "presencePenalty",
  frequencyPenalty: "frequencyPenalty",
  candidateCount: "candidateCount",
  mediaResolution: "mediaResolution",
  imageSize: "imageSize",
  resolution: "resolution",
  quality: "quality",
  sampleImageSize: "sampleImageSize",
  aspectRatio: "aspectRatio",
  seed: "seed",
  addWatermark: "addWatermark",
  enhancePrompt: "enhancePrompt",
  outputMimeType: "outputMimeType",
  styleType: "styleType",
  stylePreset: "stylePreset",
  strength: "strength",
  colors: "colors",
  backgroundColor: "backgroundColor",
} as const;

// Parameters we still send (their schema defaults are seeded and posted) but no
// longer offer as a user choice in Model Controls. Filtered at render only:
// filtering getVisibleChatParameters would drop them from createParameterState
// too, and we'd silently stop sending the tuned defaults to the provider.
const HIDDEN_CHAT_PARAMETER_KEYS = new Set(["maxOutputTokens", "topP"]);

// Rendered as proportioned boxes rather than text, via the packs AspectShapePicker.
const SHAPE_PARAMETER_KEYS = new Set(["aspectRatio"]);

type ParameterValue = string | number | boolean | string[];
type ParameterState = Record<string, ParameterValue>;

// "#rrggbb" hex string used by the native color picker.
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
function normalizeHex(value: unknown): string {
  return typeof value === "string" && HEX_COLOR_RE.test(value) ? value : "";
}

function normalizeConversationTitle(value?: string | null): string {
  const normalized = (value || "").trim();
  return normalized || DEFAULT_CONVERSATION_TITLE;
}

function getImageDisplayName(name: string): string {
  return name.replace(/\.[^./\\]+$/, "");
}

function formatConversationTitle(value: string): string {
  if (value.length <= 15) return value;
  return `${value.slice(0, 15)}...`;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={`${match.index}-strong`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(<em key={`${match.index}-em`}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={`${match.index}-code`}
          className="rounded bg-black/25 px-1.5 py-0.5 font-mono text-[0.95em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function renderMarkdownBlocks(content: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  const lines = content.split("\n");
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={`block-${key += 1}`} className="overflow-x-auto rounded-xl bg-black/25 p-4 text-xs leading-6">
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const unorderedItems: string[] = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (!current.match(/^[-*]\s+/)) break;
      unorderedItems.push(current.replace(/^[-*]\s+/, ""));
      index += 1;
    }
    if (unorderedItems.length > 0) {
      blocks.push(
        <ul key={`block-${key += 1}`} className="list-disc space-y-2 pl-6">
          {unorderedItems.map((item, itemIndex) => (
            <li key={`item-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const orderedItems: string[] = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (!current.match(/^\d+\.\s+/)) break;
      orderedItems.push(current.replace(/^\d+\.\s+/, ""));
      index += 1;
    }
    if (orderedItems.length > 0) {
      blocks.push(
        <ol key={`block-${key += 1}`} className="list-decimal space-y-2 pl-6">
          {orderedItems.map((item, itemIndex) => (
            <li key={`item-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (trimmed.startsWith("### ")) {
      blocks.push(
        <h3 key={`block-${key += 1}`} className="text-base font-semibold">
          {renderInlineMarkdown(trimmed.slice(4))}
        </h3>,
      );
      index += 1;
      continue;
    }

    if (trimmed.startsWith("## ")) {
      blocks.push(
        <h2 key={`block-${key += 1}`} className="text-lg font-semibold">
          {renderInlineMarkdown(trimmed.slice(3))}
        </h2>,
      );
      index += 1;
      continue;
    }

    if (trimmed.startsWith("# ")) {
      blocks.push(
        <h1 key={`block-${key += 1}`} className="text-xl font-semibold">
          {renderInlineMarkdown(trimmed.slice(2))}
        </h1>,
      );
      index += 1;
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;
    while (index < lines.length) {
      const current = lines[index].trim();
      if (!current || current.startsWith("```") || current.match(/^[-*]\s+/) || current.match(/^\d+\.\s+/) || current.startsWith("#")) {
        break;
      }
      paragraphLines.push(current);
      index += 1;
    }

    blocks.push(
      <p key={`block-${key += 1}`} className="whitespace-pre-wrap leading-7">
        {renderInlineMarkdown(paragraphLines.join(" "))}
      </p>,
    );
  }

  return blocks.map((block, blockIndex) => <Fragment key={`fragment-${blockIndex}`}>{block}</Fragment>);
}

function MarkdownMessage({ content }: { content: string }) {
  return <div className="space-y-3 text-sm">{renderMarkdownBlocks(content)}</div>;
}

function AssistantMessageContent({ message }: { message: ChatMessage }) {
  const textParts = (message.parts || [])
    .filter((part) => part.type === "text" && typeof part.text === "string" && part.text.trim())
    .map((part) => (part.text || "").trim());
  const imageParts = (message.parts || []).filter((part) => part.type === "image_url" && typeof part.url === "string" && isRenderableImageUrl(part.url.trim()));

  if (!message.parts?.length) {
    return <MarkdownMessage content={message.content} />;
  }

  return (
    <div className="space-y-3">
      {textParts.length > 0 ? <MarkdownMessage content={textParts.join("\n\n")} /> : null}
      {imageParts.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {imageParts.map((part, index) => (
            <InteractiveAuthenticatedImage
              key={`${message.id}-image-${index}`}
              src={part.url!}
              alt={`Assistant image ${index + 1}`}
              wrapperClassName="chat-gen-image rounded-2xl"
              imageClassName="max-h-80 w-auto max-w-full object-cover"
              loadingClassName="h-56 w-56 max-w-full rounded-2xl border border-white/10 bg-white/5"
              errorClassName="flex h-40 w-56 max-w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-white/5 text-xs text-white/50"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function UserMessageContent({ message }: { message: ChatMessage }) {
  const textParts = (message.parts || [])
    .filter((part) => part.type === "text" && typeof part.text === "string" && part.text.trim())
    .map((part) => (part.text || "").trim());
  const imageParts = (message.parts || []).filter((part) => part.type === "image_url" && typeof part.url === "string" && isRenderableImageUrl(part.url.trim()));

  if (!message.parts?.length) {
    return <p className="whitespace-pre-wrap text-sm leading-7">{message.content}</p>;
  }

  return (
    <div className="space-y-3">
      {textParts.length > 0 ? (
        <p className="whitespace-pre-wrap text-sm leading-7">{textParts.join("\n\n")}</p>
      ) : null}
      {imageParts.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-3">
          {imageParts.map((part, index) => (
            <InteractiveAuthenticatedImage
              key={`${message.id}-image-${index}`}
              src={part.url!}
              alt={`User upload ${index + 1}`}
              wrapperClassName="chat-user-image rounded-xl"
              imageClassName="max-h-56 w-auto max-w-full object-contain"
              loadingClassName="h-40 w-40 rounded-xl border border-white/10 bg-white/5"
              errorClassName="flex h-40 w-40 flex-col items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/5 text-[10px] text-white/50"
              controlButtonClassName="h-8 w-8"
              controlIconClassName="text-[15px]"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Time-aware waiting indicator. We can't always know whether a multimodal model
// (e.g. Nano Banana) will answer with text, an image, or both — but elapsed time
// is a strong signal: text comes back fast, so anything still pending after a few
// seconds is almost certainly rendering an image. For image-only models we know
// up front, so the skeleton appears almost immediately.
function ChatThinkingIndicator({
  expectsImage,
  imageOnly,
  expectedSeconds,
  reducedMotion,
  t,
}: {
  expectsImage: boolean;
  imageOnly: boolean;
  expectedSeconds: number;
  reducedMotion: boolean;
  t: (key: string) => string;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => {
      setElapsed((Date.now() - started) / 1000);
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  // When the image skeleton takes over from the dots.
  const skeletonAt = imageOnly ? 2 : 6;
  const showSkeleton = expectsImage && elapsed >= skeletonAt;

  // A soft "expected time" budget so the wait feels bounded. The bar fills
  // toward this; past it we switch to an indeterminate, reassuring "overtime"
  // state instead of pretending it's done.
  const EXPECTED_SECONDS = expectedSeconds > 0 ? expectedSeconds : LATENCY_FALLBACK_SECONDS;
  const overtime = elapsed >= EXPECTED_SECONDS;
  const remaining = Math.max(1, Math.ceil(EXPECTED_SECONDS - elapsed));
  const progressPct = Math.min(elapsed / EXPECTED_SECONDS, 0.95) * 100;
  const timeLabel = overtime ? `${Math.floor(elapsed)}s` : `~${remaining}s`;

  let caption: string;
  if (showSkeleton) {
    if (elapsed >= 60) caption = t("Almost there — detailed images can take a moment.");
    else if (elapsed >= 35) caption = t("This is taking a little longer than usual…");
    else if (elapsed >= 18) caption = t("Rendering the details…");
    else caption = t("Creating your image…");
  } else if (elapsed >= 30) {
    caption = t("Still working on it…");
  } else if (elapsed >= 12) {
    caption = t("Working through it…");
  } else {
    caption = t("Thinking…");
  }

  const dots = (
    <div className="chat-thinking-row">
      <div className="chat-typing-dot" />
      <div className="chat-typing-dot" />
      <div className="chat-typing-dot" />
      <span className="chat-thinking-shimmer" />
    </div>
  );

  if (!showSkeleton) {
    return (
      <div className="chat-msg-assistant chat-msg-thinking">
        <div className="flex flex-col gap-2">
          {dots}
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={caption}
              className="chat-thinking-caption"
              initial={reducedMotion ? false : { opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -3 }}
              transition={{ duration: 0.35 }}
            >
              {caption}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      className="chat-thinking-frame"
      layout
      initial={reducedMotion ? false : { opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <span className="img-skeleton" aria-hidden="true" />
      <span className="material-symbols-outlined chat-thinking-frame__icon">image</span>
      <div className="chat-thinking-frame__caption">
        <div className="chat-thinking-frame__statusrow">
          <span className="chat-thinking-frame__pulse" aria-hidden="true" />
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={caption}
              className="chat-thinking-frame__label"
              initial={reducedMotion ? false : { opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -3 }}
              transition={{ duration: 0.35 }}
            >
              {caption}
            </motion.span>
          </AnimatePresence>
          <span className="chat-thinking-frame__time">
            <span className="material-symbols-outlined chat-thinking-frame__time-icon">schedule</span>
            {timeLabel}
          </span>
        </div>
        <div className={`chat-thinking-frame__bar${overtime ? " is-overtime" : ""}`}>
          <div className="chat-thinking-frame__bar-fill" style={overtime ? undefined : { width: `${progressPct}%` }} />
        </div>
      </div>
    </motion.div>
  );
}

function toProviderLabel(provider?: string) {
  if (!provider) return "Other";
  return provider
    .split(/[-_]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getProviderIcon(provider: string) {
  const normalized = provider.toLowerCase();
  if (normalized.includes("recommend")) return "star";
  if (normalized.includes("openai")) return "psychology";
  if (normalized.includes("google")) return "auto_awesome";
  if (normalized.includes("anthropic")) return "bolt";
  if (normalized.includes("meta")) return "language";
  return "hub";
}

function toChatModelOption(model: PlainChatModelItem): ChatModelOption {
  return {
    id: model.id,
    displayName: model.displayName,
    description: model.description,
    provider: toProviderLabel(model.provider),
    supportsImageInput: Boolean(model.supportsImageInput),
    inputModalities: Array.isArray(model.inputModalities) ? model.inputModalities : [],
    outputModalities: Array.isArray(model.outputModalities) ? model.outputModalities : [],
    parameterSchema: model.parameterSchema || {},
    pricing: model.pricing,
  };
}

function isOneShotImageModel(model: ChatModelOption | null): boolean {
  if (!model) return false;
  const outputModalities = model.outputModalities.map((value) => value.toUpperCase());
  return outputModalities.includes("IMAGE") && !outputModalities.includes("TEXT");
}

// Image-output models are surfaced first within a provider (e.g. Nano Banana Pro
// above Gemini 2.5 Flash), text-only models fall to the bottom.
function outputsImage(model: ChatModelOption): boolean {
  return model.outputModalities.some((value) => value.toUpperCase() === "IMAGE");
}

// Latency budgets live in the shared lib so pricing + chat stay in sync.
function getModelLatencyBudget(model: ChatModelOption | null, values: ParameterState): number {
  if (!model) return LATENCY_FALLBACK_SECONDS;
  const qualityRaw = values.quality ?? values.imageSize ?? values.resolution ?? values.sampleImageSize;
  return latencyBudgetForModel(model.id, qualityRaw as string | number | null | undefined);
}

function maxInputImagesForModel(model: ChatModelOption | null): number {
  return maxInputImagesForModelId(model?.id);
}

function getModelFeatureLabels(model: ChatModelOption): string[] {
  const inputModalities = model.inputModalities.map((value) => value.toUpperCase());
  const outputModalities = model.outputModalities.map((value) => value.toUpperCase());
  const labels: string[] = [];

  if (inputModalities.includes("TEXT") && inputModalities.includes("IMAGE")) {
    labels.push("Multimodal");
  }

  if (outputModalities.includes("IMAGE")) {
    labels.push("Image generation");
  }
  return labels;
}

function getChatParamPricingHint(model: ChatModelOption | null, key: string) {
  const expected = model?.pricing?.expected;
  if (!expected || typeof expected !== "object") return null;

  let priceMap: Record<string, number> | undefined;
  if (expected.imageSizePrices && typeof expected.imageSizePrices === "object" && Object.keys(expected.imageSizePrices).length > 0) {
    // OpenAI prices by quality (low/medium); Google by size (1K/2K/...). Attach the
    // hint to whichever control matches the price-map keys.
    const isQualityKeyed = Object.keys(expected.imageSizePrices).some(
      (k) => ["low", "medium", "high", "auto"].includes(k.trim().toLowerCase()),
    );
    if (key === "resolution" || key === (isQualityKeyed ? "quality" : "imageSize")) {
      priceMap = expected.imageSizePrices;
    }
  }
  if (!priceMap && key === "sampleImageSize" && expected.sampleImageSizePrices && typeof expected.sampleImageSizePrices === "object") {
    priceMap = expected.sampleImageSizePrices;
  }

  if (!priceMap || Object.keys(priceMap).length === 0) return null;

  return Object.entries(priceMap)
    .map(([label, value]) => `${label}: ${Number(value).toFixed(2)} credits`)
    .join("\n");
}

function getChatModelMinimumCost(model: ChatModelOption | null) {
  const minimum = model?.pricing?.minimum;
  if (typeof minimum === "number" && Number.isFinite(minimum)) {
    return minimum;
  }
  return 0;
}

function normalizeExpectedPricingKey(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (raw === "512" || raw === "512px" || raw === "0.5k") return "0.5k";
  if (raw === "1024" || raw === "1024px" || raw === "1k") return "1k";
  if (raw === "2048" || raw === "2048px" || raw === "2k") return "2k";
  if (raw === "4096" || raw === "4096px" || raw === "4k") return "4k";
  return raw;
}

function resolveExpectedVariantPrice(priceMap: Record<string, number> | undefined, value: unknown) {
  if (!priceMap) return null;
  const target = normalizeExpectedPricingKey(value);
  if (!target) return null;
  for (const [key, rawValue] of Object.entries(priceMap)) {
    if (normalizeExpectedPricingKey(key) !== target) continue;
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getChatModelExpectedCost(model: ChatModelOption | null, values: ParameterState) {
  const expected = model?.pricing?.expected;
  const minimum = getChatModelMinimumCost(model);

  if (typeof expected === "number" && Number.isFinite(expected)) {
    return expected;
  }
  if (!expected || typeof expected !== "object") {
    return minimum;
  }
  if (typeof expected.amount === "number" && Number.isFinite(expected.amount)) {
    return expected.amount;
  }

  const sampleVariant = resolveExpectedVariantPrice(expected.sampleImageSizePrices, values.sampleImageSize);
  if (sampleVariant !== null) {
    return sampleVariant;
  }

  const imageVariant = resolveExpectedVariantPrice(expected.imageSizePrices, values.imageSize);
  if (imageVariant !== null) {
    return imageVariant;
  }

  // Grok prices the image by resolution (1k/2k).
  const resolutionVariant = resolveExpectedVariantPrice(expected.imageSizePrices, values.resolution);
  if (resolutionVariant !== null) {
    return resolutionVariant;
  }

  if (typeof expected.basePrice === "number" && Number.isFinite(expected.basePrice)) {
    return expected.basePrice;
  }

  return minimum;
}

function toParameterLabel(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

// Display-only label for enum options. The underlying value (sent in the
// request) is unchanged; this only affects what the user sees. e.g. the
// Output Mime Type options render as "png" / "jpeg" instead of "image/png".
function toEnumOptionLabel(key: string, option: string) {
  if (key === "outputMimeType" && option.startsWith("image/")) {
    return option.slice("image/".length);
  }
  return option;
}

function toResolvedCostNumber(value: string | number | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getUsageTotalTokens(usage?: BillingUsage | null) {
  if (!usage) return 0;
  if (typeof usage.totalTokens === "number") return usage.totalTokens;
  return Number(usage.promptTokens || 0) + Number(usage.completionTokens || 0);
}

function formatBillingComponentLabel(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
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

function getDefaultParameterValue(entry: PlainChatParameterSchemaEntry, key?: string): ParameterValue | null {
  if (entry.recommendedDefault !== undefined) {
    return entry.recommendedDefault;
  }
  if (entry.default !== undefined) {
    return entry.default;
  }
  if (entry.value !== undefined) return entry.value;
  if (key === "imageSize" || key === "sampleImageSize") {
    const enumValues = Array.isArray(entry.values) ? entry.values.map((value) => String(value).trim().toUpperCase()) : [];
    if (enumValues.includes("1K")) {
      return "1K";
    }
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

  if (entry.type === "color") {
    return typeof value === "string";
  }

  if (entry.type === "colorList") {
    return Array.isArray(value);
  }

  return false;
}

function isRenderableParameterEntry(entry: PlainChatParameterSchemaEntry) {
  return entry.type === "enum" || entry.type === "boolean" || entry.type === "float" || entry.type === "integer"
    || entry.type === "color" || entry.type === "colorList";
}

function getVisibleChatParameters(schema: Record<string, PlainChatParameterSchemaEntry>) {
  return Object.entries(schema)
    .filter(([key, entry]) => key !== "modelId" && key !== "sampleCount" && typeof entry === "object" && entry !== null && isRenderableParameterEntry(entry))
    .sort(([a], [b]) => {
      const aSupported = Number(a in CHAT_PARAMETER_KEY_MAP);
      const bSupported = Number(b in CHAT_PARAMETER_KEY_MAP);
      if (aSupported !== bSupported) {
        return bSupported - aSupported;
      }
      return a.localeCompare(b);
    });
}

function createParameterState(schema: Record<string, PlainChatParameterSchemaEntry>): ParameterState {
  return getVisibleChatParameters(schema).reduce<ParameterState>((acc, [key, entry]) => {
    const defaultValue = getDefaultParameterValue(entry, key);
    if (defaultValue !== null) {
      acc[key] = defaultValue;
    }
    return acc;
  }, {});
}

function buildChatOptionsFromParameters(values: ParameterState): Record<string, number | string | boolean | string[]> {
  const options: Record<string, number | string | boolean | string[]> = {};

  for (const [schemaKey, optionKey] of Object.entries(CHAT_PARAMETER_KEY_MAP)) {
    const value = values[schemaKey];
    if (Array.isArray(value)) {
      const colors = value.filter((entry) => HEX_COLOR_RE.test(entry));
      if (colors.length > 0) options[optionKey] = colors;
      continue;
    }
    if (typeof value === "boolean") {
      options[optionKey] = value;
      continue;
    }
    if (typeof value === "number") {
      if (Number.isNaN(value)) continue;
      options[optionKey] = value;
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      options[optionKey] = schemaKey === "thinkingLevel" ? value.trim().toUpperCase() : value.trim();
    }
  }

  return options;
}

function formatMessageParts(parts: PlainChatPart[]) {
  const chunks = parts
    .map((part) => {
      if (part.type === "text") {
        return (part.text || "").trim();
      }
      if (part.type === "image_url") {
        return "[Image attached]";
      }
      return "";
    })
    .filter(Boolean);

  return chunks.join("\n\n").trim() || "[Empty message]";
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

async function normalizeUploadImage(file: File, constraints: UploadImageConstraints): Promise<File> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageFromUrl(objectUrl);
    const longest = Math.max(image.width, image.height);
    const shortest = Math.min(image.width, image.height);
    // Downscale to keep payloads small, but never shrink the shortest side below
    // the provider's minimum (originals already under it are rejected upstream).
    let scale = Math.min(1, MAX_PROXY_IMAGE_DIMENSION / longest);
    if (shortest * scale < constraints.minDim) {
      scale = constraints.minDim / shortest;
    }
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(image, 0, 0, width, height);

    // Re-encode into a format the provider accepts (e.g. PNG/WebP -> JPEG for Recraft).
    const outputType = preferredOutputType(file.type, constraints.formats);
    const shouldReencode = scale !== 1 || file.size > MAX_PROXY_IMAGE_BYTES || file.type !== outputType;
    if (!shouldReencode) return file;

    let quality = outputType === "image/webp" ? 0.86 : 0.82;
    let blob = await canvasToBlob(canvas, outputType, quality);

    while (blob.size > MAX_PROXY_IMAGE_BYTES && quality && quality > 0.35) {
      quality -= 0.08;
      blob = await canvasToBlob(canvas, outputType, quality);
    }

    if (blob.size >= file.size && file.size <= MAX_PROXY_IMAGE_BYTES && file.type === outputType) return file;

    const extension = outputType === "image/webp" ? ".webp" : ".jpg";
    const nextName = file.name.replace(/\.(png|jpg|jpeg|webp)$/i, extension);
    return new File([blob], nextName, { type: outputType });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// --- Motion design tokens (framer-motion) ---------------------------------
// A single spring shared across the chat so every element moves with the same
// rhythm. Reduced-motion is handled globally by <MotionConfig reducedMotion="user">.
const CHAT_SPRING: Transition = { type: "spring", stiffness: 420, damping: 34, mass: 0.85 };

// Messages enter with spatial meaning: user bubbles drift in from the right,
// assistant bubbles from the left — reinforcing who is speaking. They lift and
// fade a touch faster on exit (exit ~60% of enter) to feel responsive.
const messageVariants: Variants = {
  initial: (role: ChatRole) => ({ opacity: 0, y: 16, x: role === "user" ? 26 : -26, scale: 0.96 }),
  animate: { opacity: 1, y: 0, x: 0, scale: 1, transition: CHAT_SPRING },
  exit: { opacity: 0, y: -8, scale: 0.97, transition: { duration: 0.16, ease: "easeIn" } },
};

// Typing indicator bubble springs in from below and shrinks out.
const typingVariants: Variants = {
  initial: { opacity: 0, y: 12, scale: 0.9 },
  animate: { opacity: 1, y: 0, scale: 1, transition: CHAT_SPRING },
  exit: { opacity: 0, scale: 0.9, transition: { duration: 0.14, ease: "easeIn" } },
};

// Concrete creation prompts the empty state cycles through, so the blank canvas
// makes a suggestion instead of just waiting. Drawn from the studio's own world —
// posters, product shots, logos, ad frames — and phrased so they work as either a
// chat starter or a direct image prompt. Clicking one drops it into the composer.
const STARTER_IDEAS = [
  "a neon poster for a late-night coffee brand",
  "product photos of a watch on wet stone",
  "a logo that feels like citrus and static",
  "a storyboard frame for a 15-second ad",
  "a dreamy hero image for a travel blog",
];

// Ambient background motes — soft glowing sparks that drift up and twinkle.
// Positions/sizes/timings are hand-scattered (not random) so the field feels
// composed rather than noisy, and staggered delays keep motion continuous.
const CHAT_MOTES = [
  { left: "12%", top: "70%", size: 3, color: "#22d3ee", dur: 19, delay: -2, drift: "a" },
  { left: "26%", top: "55%", size: 4, color: "#8b5cf6", dur: 24, delay: -13, drift: "c" },
  { left: "39%", top: "84%", size: 3, color: "#c4b5fd", dur: 23, delay: -17, drift: "b" },
  { left: "48%", top: "62%", size: 2, color: "#67e8f9", dur: 26, delay: -3, drift: "a" },
  { left: "60%", top: "78%", size: 3, color: "#adc6ff", dur: 20, delay: -11, drift: "b" },
  { left: "71%", top: "58%", size: 2, color: "#8b5cf6", dur: 22, delay: -6, drift: "c" },
  { left: "82%", top: "74%", size: 4, color: "#22d3ee", dur: 27, delay: -15, drift: "a" },
  { left: "44%", top: "46%", size: 3, color: "#8b5cf6", dur: 30, delay: -8, drift: "c" },
];

// Empty state: icon → heading → subtitle reveal in sequence for an inviting entrance.
const emptyContainerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.04 } },
};
const emptyItemVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 26 } },
};

export default function StudioChatPage() {
  const { user, loading: authLoading } = useAuth();
  const { t, language, isRtl } = useLanguage();
  const localizeChatWindow = (win: string): string => {
    const w = win.trim();
    if (/^1\s+minutes?$/i.test(w)) return t("1 minute");
    const m = w.match(/^(\d+)\s+minutes?$/i);
    if (m) return t("{count} minutes").replace("{count}", m[1]);
    return w;
  };
  const localizeChatError = (message: string): string => {
    if (!message) return message;
    if (message === MODERATION_UNAVAILABLE_MESSAGE) return t(MODERATION_UNAVAILABLE_MESSAGE);
    const rl = message.match(/early-stage Plain Chat limit of\s+(\d+)\s+messages per\s+([^.]+)\./i);
    if (rl) {
      return t("You reached the current early-stage Plain Chat limit of {count} messages per {window}. We are still in test mode and will make these limits more flexible later.")
        .replace("{count}", rl[1])
        .replace("{window}", localizeChatWindow(rl[2]));
    }
    return t(message);
  };
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [providerGroups, setProviderGroups] = useState<ProviderGroup[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [lockedModelId, setLockedModelId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [conversationTitle, setConversationTitle] = useState(DEFAULT_CONVERSATION_TITLE);
  const [editingConversationTitle, setEditingConversationTitle] = useState(false);
  const [conversationTitleDraft, setConversationTitleDraft] = useState(DEFAULT_CONVERSATION_TITLE);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loadingReply, setLoadingReply] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [inputImages, setInputImages] = useState<UploadedImageState[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Transient, self-dismissing confirmation (currently only the model-switch fork).
  const [notice, setNotice] = useState<string | null>(null);
  const [currentCredits, setCurrentCredits] = useState<number | null>(null);
  const [conversationPromptTokens, setConversationPromptTokens] = useState(0);
  const [conversationCompletionTokens, setConversationCompletionTokens] = useState(0);
  const [conversationCostTotal, setConversationCostTotal] = useState(0);
  const [lastUsage, setLastUsage] = useState<BillingUsage | null>(null);
  const [lastBillingMeta, setLastBillingMeta] = useState<PlainChatTurnMeta | null>(null);
  const [parameterValues, setParameterValues] = useState<ParameterState>({});
  const loadingReplyRef = useRef(false);
  const messageCountRef = useRef(0);
  const suppressEmptyConversationLoadRef = useRef(false);
  const hasBootstrappedChatRef = useRef(false);
  const deletedConversationIdRef = useRef("");
  const failedConversationLoadRef = useRef("");
  const inputImagesRef = useRef<UploadedImageState[]>([]);
  const deepLinkAppliedRef = useRef(false);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const [settingsPos, setSettingsPos] = useState<{ left: number; bottom: number; width: number } | null>(null);

  const searchParams = useSearchParams();
  const forceNewSession = searchParams?.get("new") === "1";
  const requestedConversationId = searchParams?.get("conversation");
  const requestedModelParam = searchParams?.get("model") || "";
  const requestedPromptParam = searchParams?.get("prompt") || "";
  const requestedConversationIsActive =
    Boolean(requestedConversationId) && requestedConversationId !== deletedConversationIdRef.current;
  const isBootstrappingRequestedConversation = requestedConversationIsActive && requestedConversationId !== conversationId;

  // Model Controls used to be a docked right rail that auto-opened on large
  // screens. It is now a popover floating over the composer, so auto-opening
  // would cover the empty state on every visit. It opens only on request.
  //
  // Anchored above the gear button, spanning the composer's width and clamped to
  // the viewport. Portalled to <body>: the composer's overflow-hidden ancestors
  // would otherwise clip a panel that opens upward.
  useEffect(() => {
    if (!settingsPanelOpen) return;

    const place = () => {
      const btn = settingsBtnRef.current?.getBoundingClientRect();
      if (!btn) return;
      const margin = 8;
      const width = Math.min(680, window.innerWidth - 2 * margin);
      const left = Math.min(Math.max(margin, btn.right - width), window.innerWidth - width - margin);
      setSettingsPos({ left, bottom: Math.max(margin, window.innerHeight - btn.top + 10), width });
    };
    place();

    const onDocMouseDown = (event: MouseEvent) => {
      if (
        !settingsPanelRef.current?.contains(event.target as Node) &&
        !settingsBtnRef.current?.contains(event.target as Node)
      ) {
        setSettingsPanelOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsPanelOpen(false);
    };

    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [settingsPanelOpen]);

  useEffect(() => {
    loadingReplyRef.current = loadingReply;
    messageCountRef.current = messages.length;
  }, [loadingReply, messages.length]);

  useEffect(() => {
    if (forceNewSession) {
      hasBootstrappedChatRef.current = true;
      sessionStorage.removeItem(STORAGE_KEY);
      setMessages([]);
      // Leave selectedModel/lockedModelId alone: loadConfig seeds a default
      // model, and a blank one would leave the composer unable to send.
      setConversationId("");
      setConversationTitle(DEFAULT_CONVERSATION_TITLE);
      setConversationTitleDraft(DEFAULT_CONVERSATION_TITLE);
      setEditingConversationTitle(false);
      setInput("");
      clearAttachedImages();
      setError(null);
      setConversationPromptTokens(0);
      setConversationCompletionTokens(0);
      setConversationCostTotal(0);
      setLastUsage(null);
      setLastBillingMeta(null);
      return;
    }

    if (
      requestedConversationId &&
      requestedConversationId !== deletedConversationIdRef.current &&
      requestedConversationId !== failedConversationLoadRef.current
    ) {
      hasBootstrappedChatRef.current = true;
      if (requestedConversationId === conversationId) {
        return;
      }
      setMessages([]);
      // Cleared so the conversation loader can install the model the thread was
      // actually created with, rather than whatever the composer last showed.
      setSelectedModel("");
      setLockedModelId("");
      setConversationId(requestedConversationId);
      setConversationTitle(DEFAULT_CONVERSATION_TITLE);
      setConversationTitleDraft(DEFAULT_CONVERSATION_TITLE);
      setEditingConversationTitle(false);
      setInput("");
      clearAttachedImages();
      setError(null);
      setConversationPromptTokens(0);
      setConversationCompletionTokens(0);
      setConversationCostTotal(0);
      setLastUsage(null);
      setLastBillingMeta(null);
      return;
    }

    if (hasBootstrappedChatRef.current) {
      return;
    }
    hasBootstrappedChatRef.current = true;

    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as {
        messages?: ChatMessage[];
        selectedModel?: string;
        lockedModelId?: string;
        conversationId?: string;
        conversationTitle?: string;
        parameterValues?: ParameterState;
      };
      setMessages(parsed.messages || []);
      setSelectedModel(parsed.selectedModel || "");
      setLockedModelId(parsed.lockedModelId || "");
      setConversationId(parsed.conversationId || "");
      setConversationTitle(normalizeConversationTitle(parsed.conversationTitle));
      setConversationTitleDraft(normalizeConversationTitle(parsed.conversationTitle));
      setParameterValues(parsed.parameterValues || {});
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, [conversationId, forceNewSession, requestedConversationId]);

  useEffect(() => {
    if (isBootstrappingRequestedConversation) return;
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ messages, selectedModel, lockedModelId, conversationId, conversationTitle, parameterValues }),
    );
  }, [conversationId, conversationTitle, isBootstrappingRequestedConversation, lockedModelId, messages, parameterValues, selectedModel]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const effectiveConversationId =
      conversationId || (requestedConversationId !== deletedConversationIdRef.current ? requestedConversationId || "" : "");
    url.searchParams.delete("new");
    if (effectiveConversationId) {
      url.searchParams.set("conversation", effectiveConversationId);
    } else {
      url.searchParams.delete("conversation");
    }
    window.history.replaceState({}, "", url.toString());
  }, [conversationId, requestedConversationId]);

  useEffect(() => {
    let cancelled = false;

    if (authLoading) {
      return () => {
        cancelled = true;
      };
    }

    if (!user) {
      setLoadingConfig(false);
      setProviderGroups([]);
      return () => {
        cancelled = true;
      };
    }

    async function loadProfile() {
      try {
        const profile = await api.getProfile();
        if (!cancelled) {
          setCurrentCredits(profile.credits ?? 0);
        }
      } catch {
        if (!cancelled) {
          setCurrentCredits(null);
        }
      }
    }

    async function loadConfig() {
      try {
        const response = await api.getPlainChatModels();
        const entries = response.models.map(toChatModelOption);

        const grouped = entries.reduce<Record<string, ChatModelOption[]>>((acc, entry) => {
          acc[entry.provider] = acc[entry.provider] || [];
          acc[entry.provider].push(entry);
          return acc;
        }, {});

        const providerGroupsList = Object.entries(grouped)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([provider, models]) => ({
            provider,
            models: models.sort((a, b) =>
              (outputsImage(a) === outputsImage(b) ? 0 : outputsImage(a) ? -1 : 1)
              || a.displayName.localeCompare(b.displayName),
            ),
          }));

        // Prepend the curated "Recommended" tab (only models that actually exist).
        const recommendedModels = RECOMMENDED_MODEL_IDS
          .map((id) => entries.find((model) => model.id === id))
          .filter((model): model is ChatModelOption => Boolean(model));
        const nextGroups = recommendedModels.length
          ? [{ provider: RECOMMENDED_PROVIDER, models: recommendedModels }, ...providerGroupsList]
          : providerGroupsList;

        if (!cancelled) {
          setProviderGroups(nextGroups);

          const allModels = nextGroups.flatMap((group) => group.models);
          const knows = (id: string) => Boolean(id) && allModels.some((model) => model.id === id);

          // There is no catalogue screen any more, so the composer must boot with
          // a usable model: Send and the attach button are both gated on
          // lockedModelId. Prefer the first curated recommendation that actually
          // exists, then fall back to whatever the catalogue offers first.
          const defaultModelId = recommendedModels[0]?.id || allModels[0]?.id || "";

          // A conversation deep-link clears both ids on purpose and lets the
          // conversation loader install the thread's own model — don't race it.
          if (!requestedConversationIsActive) {
            const nextSelected = knows(selectedModel) ? selectedModel : defaultModelId;
            setSelectedModel(nextSelected);
            setLockedModelId((current) => (knows(current) ? current : nextSelected));
          }

          // The locked model vanished from the catalogue (disabled by an admin,
          // provider pulled). Drop the dead thread and reseed rather than
          // stranding the composer on a model the backend will reject.
          if (lockedModelId && !knows(lockedModelId)) {
            setLockedModelId(defaultModelId);
            setSelectedModel(defaultModelId);
            setConversationId("");
            setConversationTitle(DEFAULT_CONVERSATION_TITLE);
            setConversationTitleDraft(DEFAULT_CONVERSATION_TITLE);
            setEditingConversationTitle(false);
            setMessages([]);
            setConversationPromptTokens(0);
            setConversationCompletionTokens(0);
            setConversationCostTotal(0);
            setLastUsage(null);
            setLastBillingMeta(null);
          }
        }
      } catch {
        if (!cancelled) {
          setError(t("Could not load chat models."));
        }
      } finally {
        if (!cancelled) {
          setLoadingConfig(false);
        }
      }
    }

    void loadProfile();
    void loadConfig();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  // Deep-link bootstrap: open the Playground straight into a specific model with
  // an optional pre-filled prompt (/playground?model=<id>&prompt=<text>; the old
  // /studio/chat route forwards its query here). Runs once after models load.
  useEffect(() => {
    if (deepLinkAppliedRef.current) return;
    if (!requestedModelParam) return;
    if (providerGroups.length === 0) return;

    deepLinkAppliedRef.current = true;

    const match = providerGroups
      .flatMap((group) => group.models)
      .find((model) => model.id === requestedModelParam) || null;

    // Strip the deep-link params so a refresh / back nav doesn't re-trigger it.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("model");
      url.searchParams.delete("prompt");
      window.history.replaceState({}, "", url.toString());
    }

    if (!match) return; // Requested model not available — keep the seeded default.

    hasBootstrappedChatRef.current = true;
    setSelectedModel(match.id);
    setLockedModelId(match.id);
    setConversationId("");
    setConversationTitle(DEFAULT_CONVERSATION_TITLE);
    setConversationTitleDraft(DEFAULT_CONVERSATION_TITLE);
    setEditingConversationTitle(false);
    setMessages([]);
    setConversationPromptTokens(0);
    setConversationCompletionTokens(0);
    setConversationCostTotal(0);
    setLastUsage(null);
    setLastBillingMeta(null);
    setError(null);
    if (requestedPromptParam) setInput(requestedPromptParam);
  }, [providerGroups, requestedModelParam, requestedPromptParam]);

  useEffect(() => {
    let cancelled = false;

    async function loadConversation() {
      if (!user || !conversationId) return;

      try {
        setLoadingConversation(true);
        const response = await api.getPlainChatConversationMessages(conversationId, 100);
        if (cancelled) return;
        const fetchedMessages = response.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: formatMessageParts(message.parts),
          createdAt: message.createdAt,
          parts: message.parts,
        }));

        // Do not clobber the optimistic first-turn UI with an empty fetch result
        // while the first reply is still in flight for a newly created conversation.
        if (!(suppressEmptyConversationLoadRef.current && fetchedMessages.length === 0)) {
          setMessages(fetchedMessages);
        }
        setLockedModelId(response.conversation.model || lockedModelId);
        failedConversationLoadRef.current = "";
        setConversationTitle(normalizeConversationTitle(response.conversation.title));
        setConversationTitleDraft(normalizeConversationTitle(response.conversation.title));
        setEditingConversationTitle(false);
        setConversationPromptTokens(response.conversation.promptTokensTotal || 0);
        setConversationCompletionTokens(response.conversation.completionTokensTotal || 0);
        setConversationCostTotal(response.conversation.totalCostCredits || 0);
        setLastUsage(null);
        setLastBillingMeta(null);
      } catch (err) {
        if (cancelled) return;
        failedConversationLoadRef.current = conversationId;
        setError(err instanceof Error ? err.message : t("Could not load chat history."));
        setConversationId("");
        setConversationTitle(DEFAULT_CONVERSATION_TITLE);
        setConversationTitleDraft(DEFAULT_CONVERSATION_TITLE);
        setEditingConversationTitle(false);
        setMessages([]);
        setConversationPromptTokens(0);
        setConversationCompletionTokens(0);
        setConversationCostTotal(0);
        setLastUsage(null);
        setLastBillingMeta(null);
      } finally {
        if (!cancelled) {
          setLoadingConversation(false);
        }
      }
    }

    void loadConversation();

    return () => {
      cancelled = true;
    };
  }, [conversationId, user]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3200);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    inputImagesRef.current = inputImages;
  }, [inputImages]);

  useEffect(() => {
    return () => {
      inputImagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loadingReply]);

  const lockedModel = useMemo(
    () => providerGroups.flatMap((group) => group.models).find((model) => model.id === lockedModelId) || null,
    [lockedModelId, providerGroups],
  );

  // Flattened, presentation-ready view of the catalogue for the composer's model
  // picker. Everything the popover needs (labels, cost, affordability) is resolved
  // here so the picker itself stays a dumb, testable component.
  const pickerGroups = useMemo<PickerGroup[]>(
    () =>
      providerGroups.map((group) => ({
        provider: group.provider,
        label: group.provider === RECOMMENDED_PROVIDER ? t("Recommended") : toProviderLabel(group.provider),
        icon: getProviderIcon(group.provider),
        isRecommended: group.provider === RECOMMENDED_PROVIDER,
        models: group.models.map((model) => {
          const minimumCost = getChatModelMinimumCost(model);
          return {
            id: model.id,
            displayName: model.displayName,
            description: getModelDescription(model.id, language) || model.description || "",
            tags: getModelFeatureLabels(model).map((label) => t(label)),
            minimumCost,
            // currentCredits is null until the profile lands; treat unknown as
            // affordable rather than greying out the whole catalogue on load.
            affordable: currentCredits === null || currentCredits >= minimumCost,
          };
        }),
      })),
    [providerGroups, language, currentCredits, t],
  );

  const lockedModelMinimumCost = useMemo(
    () => getChatModelMinimumCost(lockedModel),
    [lockedModel],
  );

  const lockedModelExpectedCost = useMemo(
    () => getChatModelExpectedCost(lockedModel, parameterValues),
    [lockedModel, parameterValues],
  );

  const lockedModelIsOneShotImage = isOneShotImageModel(lockedModel);
  const maxInputImages = maxInputImagesForModel(lockedModel);

  // Rotating starter idea for the empty state. Pauses entirely for reduced-motion
  // users (a static suggestion, no crossfade churn).
  const prefersReducedMotion = useReducedMotion();
  const [ideaIndex, setIdeaIndex] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion || messages.length > 0) return;
    const id = setInterval(() => setIdeaIndex((i) => (i + 1) % STARTER_IDEAS.length), 3600);
    return () => clearInterval(id);
  }, [prefersReducedMotion, messages.length]);

  // Composer "charge" burst — a bright light sweeps the border for a few laps then
  // settles to the calm idle ring. Plays once on open and again on every send.
  // chargeKey bumps so the overlay remounts and the CSS animation restarts cleanly.
  const [composerCharging, setComposerCharging] = useState(false);
  const [chargeKey, setChargeKey] = useState(0);
  const chargeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runComposerCharge = () => {
    if (prefersReducedMotion) return;
    setChargeKey((k) => k + 1);
    setComposerCharging(true);
    if (chargeTimerRef.current) clearTimeout(chargeTimerRef.current);
    chargeTimerRef.current = setTimeout(() => setComposerCharging(false), 2600);
  };
  useEffect(() => {
    runComposerCharge();
    return () => {
      if (chargeTimerRef.current) clearTimeout(chargeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pause the animated background while the thread is actively scrolling. The
  // heavy blurred/blend background is paint-bound, so re-rasterizing it every
  // scroll frame causes touch/trackpad jank; freezing it lets the browser cache
  // the blurred result and scroll as cheap GPU compositing. We toggle a class via
  // direct DOM (no setState) so the scroll handler itself never triggers a render.
  const chatCanvasRef = useRef<HTMLDivElement>(null);
  const scrollIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleMessagesScroll = () => {
    const el = chatCanvasRef.current;
    if (!el) return;
    if (!el.classList.contains("is-scrolling")) el.classList.add("is-scrolling");
    if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current);
    scrollIdleTimerRef.current = setTimeout(() => {
      chatCanvasRef.current?.classList.remove("is-scrolling");
    }, 160);
  };
  useEffect(() => {
    return () => {
      if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current);
    };
  }, []);

  const insufficientLockedModelMinimumCredits = currentCredits !== null && currentCredits < lockedModelMinimumCost;
  const insufficientLockedModelExpectedCredits = currentCredits !== null && currentCredits < lockedModelExpectedCost;

  // Drives parameterValues (so hidden params keep their defaults and still ship).
  const lockedModelParameters = useMemo(
    () => (lockedModel ? getVisibleChatParameters(lockedModel.parameterSchema) : []),
    [lockedModel],
  );

  // Drives what Model Controls actually renders.
  const editableModelParameters = useMemo(
    () => lockedModelParameters.filter(([key]) => !HIDDEN_CHAT_PARAMETER_KEYS.has(key)),
    [lockedModelParameters],
  );

  useEffect(() => {
    if (!lockedModel) return;

    setParameterValues((current) => {
      const defaults = createParameterState(lockedModel.parameterSchema);
      const next: ParameterState = { ...defaults };

      for (const [key, entry] of lockedModelParameters) {
        if (isParameterValueCompatible(entry, current[key])) {
          next[key] = current[key];
        }
      }

      return next;
    });
  }, [lockedModel, lockedModelParameters]);

  // Trim attachments when switching to a model that accepts fewer images (e.g. Grok editing → 3).
  useEffect(() => {
    if (inputImagesRef.current.length > maxInputImages) {
      inputImagesRef.current.slice(maxInputImages).forEach((image) => URL.revokeObjectURL(image.previewUrl));
      setInputImages((current) => current.slice(0, maxInputImages));
      setError(`This model accepts at most ${maxInputImages} images.`);
    }
  }, [maxInputImages]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";
    const computed = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(computed.lineHeight) || 20;
    const maxHeight = lineHeight * 5;
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [input]);

  function removeAttachedImage(localId: string) {
    setInputImages((current) => current.filter((image) => {
      const keep = image.localId !== localId;
      if (!keep) URL.revokeObjectURL(image.previewUrl);
      return keep;
    }));
  }

  function clearAttachedImages() {
    setInputImages((current) => {
      current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      return [];
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function uploadInputImageFiles(selectedFiles: File[]) {
    if (selectedFiles.length === 0) return;

    const slotsAvailable = maxInputImages - inputImagesRef.current.length;
    if (slotsAvailable <= 0) {
      setError(`Attach at most ${maxInputImages} images per message.`);
      return;
    }

    const filesToUpload = selectedFiles.slice(0, slotsAvailable);
    if (selectedFiles.length > slotsAvailable) {
      setError(`Only ${maxInputImages} images can be attached.`);
    }

    try {
      setUploadingImage(true);
      if (selectedFiles.length <= slotsAvailable) {
        setError(null);
      }
      const constraints = getUploadConstraints(lockedModel?.id);
      const providerLabel = providerLabelForModelId(lockedModel?.id);
      for (const originalFile of filesToUpload) {
        if (!["image/png", "image/jpeg", "image/webp"].includes(originalFile.type)) {
          throw new Error(t("Only PNG, JPEG, and WEBP images are supported."));
        }
        if (originalFile.size > MAX_UPLOAD_BYTES) {
          throw new Error(t("Each image must be 10 MB or smaller."));
        }
        const { width, height } = await readImageDimensions(originalFile);
        if (Math.min(width, height) < constraints.minDim) {
          throw new Error(`${providerLabel} needs images at least ${constraints.minDim}px on the shortest side — "${originalFile.name}" is ${width}×${height}px.`);
        }
      }
      const pendingImages: UploadedImageState[] = filesToUpload.map((originalFile) => ({
        localId: crypto.randomUUID(),
        name: originalFile.name,
        mimeType: originalFile.type,
        previewUrl: URL.createObjectURL(originalFile),
        size: originalFile.size,
        originalSize: originalFile.size,
        uploading: true,
      }));
      setInputImages((current) => [...current, ...pendingImages].slice(0, maxInputImages));

      const nextImages: UploadedImageState[] = [];
      for (const originalFile of filesToUpload) {
        const file = await normalizeUploadImage(originalFile, constraints);
        const uploaded: UploadedImageResult = await api.uploadInputImage(file);
        recordRecentUpload(user?.uid, { file_id: uploaded.id, mime_type: uploaded.mime_type, url: uploaded.url });
        const pendingImage = pendingImages[nextImages.length];
        URL.revokeObjectURL(pendingImage.previewUrl);
        nextImages.push({
          localId: pendingImage.localId,
          fileId: uploaded.id,
          name: uploaded.name || file.name,
          mimeType: uploaded.mime_type || file.type,
          url: uploaded.url,
          previewUrl: URL.createObjectURL(file),
          size: uploaded.size || file.size,
          originalSize: originalFile.size,
        });
      }
      setInputImages((current) => current.map((image) => nextImages.find((nextImage) => nextImage.localId === image.localId) || image));
    } catch (err) {
      setInputImages((current) => current.filter((image) => {
        const keep = !image.uploading;
        if (!keep) URL.revokeObjectURL(image.previewUrl);
        return keep;
      }));
      setError(err instanceof Error ? err.message : t("Could not upload image."));
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    await uploadInputImageFiles(Array.from(event.target.files || []));
    event.target.value = "";
  }

  function handleImagePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (!lockedModel?.supportsImageInput) return;

    const pastedFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (pastedFiles.length === 0) return;
    event.preventDefault();
    void uploadInputImageFiles(pastedFiles);
  }

  // A conversation's model is fixed server-side: POST /chat/conversations/{id}/messages
  // carries no model and the backend reads conversation.model. So switching models
  // mid-thread can't be expressed — once messages exist we fork into a fresh chat
  // instead, carrying the composer's draft across. The old thread stays in history.
  function handleModelChange(nextModelId: string) {
    if (!nextModelId || !user || nextModelId === lockedModelId) return;

    const nextModel = providerGroups.flatMap((group) => group.models).find((model) => model.id === nextModelId);
    if (!nextModel) return;

    const nextMinimumCost = getChatModelMinimumCost(nextModel);
    if (currentCredits !== null && currentCredits < nextMinimumCost) {
      setError(`You need at least ${nextMinimumCost.toFixed(2)} credits to use this model.`);
      return;
    }

    setError(null);
    setSelectedModel(nextModelId);
    setLockedModelId(nextModelId);

    // Empty chat: nothing to fork, just swap the model under the composer.
    if (messages.length === 0 && !conversationId) return;

    // Same bookkeeping as handleNewChat: mark the thread we're leaving so the
    // bootstrap effect won't see a stale ?conversation= and pull us straight back
    // into it, and go through the router (a raw history.replaceState leaves
    // useSearchParams() still reporting the old id).
    suppressEmptyConversationLoadRef.current = true;
    hasBootstrappedChatRef.current = true;
    if (conversationId) {
      deletedConversationIdRef.current = conversationId;
    }
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(STORAGE_KEY);
    }
    router.replace("/playground");

    setConversationId("");
    setConversationTitle(DEFAULT_CONVERSATION_TITLE);
    setConversationTitleDraft(DEFAULT_CONVERSATION_TITLE);
    setEditingConversationTitle(false);
    setConversationPromptTokens(0);
    setConversationCompletionTokens(0);
    setConversationCostTotal(0);
    setLastUsage(null);
    setLastBillingMeta(null);
    setMessages([]);
    // `input` and the attached images survive on purpose: the user was mid-thought
    // when they reached for a different model.
    setNotice(`${t("Started a new chat with")} ${nextModel.displayName}`);
  }

  async function handleSend() {
    const text = input.trim();
    if (text.length > MAX_CHAT_TEXT_CHARS) {
      setError(`Your message is too long. Maximum ${MAX_CHAT_TEXT_CHARS} characters.`);
      return;
    }
    if ((!text && inputImages.length === 0) || !lockedModelId || loadingReply || !user) return;
    if (insufficientLockedModelMinimumCredits) {
      setError(`You need at least ${lockedModelMinimumCost.toFixed(2)} credits to use this chat model.`);
      return;
    }
    if (insufficientLockedModelExpectedCredits) {
      setError(`You need about ${lockedModelExpectedCost.toFixed(2)} credits for the selected settings.`);
      return;
    }

    const inputBeforeSend = input;
    const attachedImages = inputImages.filter((image) => image.url);
    const parts: PlainChatPart[] = [];
    if (text) {
      parts.push({ type: "text", text });
    }
    if (lockedModel?.supportsImageInput) {
      attachedImages.forEach((image) => {
        parts.push({ type: "image_url", url: image.url! });
      });
    }

    const optimisticUserMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: formatMessageParts(parts),
      createdAt: Date.now(),
      parts,
    };

    setMessages((current) => [...current, optimisticUserMessage]);
    setInput("");
    setInputImages([]);
    setLoadingReply(true);
    setError(null);

    try {
      let activeConversationId = conversationId;
      if (!activeConversationId) {
        suppressEmptyConversationLoadRef.current = true;
        const createdConversation = await api.createPlainChatConversation({
          model: lockedModelId,
          title: normalizedConversationTitle,
        });
        activeConversationId = createdConversation.id;
        setConversationId(createdConversation.id);
        setConversationTitle(normalizeConversationTitle(createdConversation.title));
        setConversationTitleDraft(normalizeConversationTitle(createdConversation.title));
        setConversationPromptTokens(createdConversation.promptTokensTotal || 0);
        setConversationCompletionTokens(createdConversation.completionTokensTotal || 0);
        setConversationCostTotal(createdConversation.totalCostCredits || 0);
      }

      const response = await api.sendPlainChatConversationMessage(activeConversationId, {
        parts,
        options: buildChatOptionsFromParameters(parameterValues),
      });

      if (response.status !== "success" || !response.userMessage || !response.assistantMessage) {
        throw new Error(typeof response.meta?.error_message === "string" ? response.meta.error_message : t("The chat model did not return a reply."));
      }

      const userMessage: ChatMessage = {
        id: response.userMessage.id,
        role: response.userMessage.role,
        content: formatMessageParts(response.userMessage.parts),
        createdAt: response.userMessage.createdAt,
        parts: response.userMessage.parts,
      };

      const assistantMessage: ChatMessage = {
        id: response.assistantMessage.id,
        role: response.assistantMessage.role,
        content: formatMessageParts(response.assistantMessage.parts),
        createdAt: response.assistantMessage.createdAt,
        parts: response.assistantMessage.parts,
      };

      setMessages((current) => [...current.slice(0, -1), userMessage, assistantMessage]);

      // Save generated images to history so they appear in Gallery
      if (user && assistantMessage.parts) {
        const imageParts = assistantMessage.parts.filter(p => p.type === "image_url" && p.url);
        for (const part of imageParts) {
          if (part.url) {
            try {
              await addHistoryEntry(user.uid, {
                imageUrl: part.url,
                caption: undefined,
                prompt: userMessage.content || "Playground Generation",
                model: `chat:${response.meta?.model || response.conversation?.model || lockedModelId || selectedModel || "Unknown"}`,
              });
            } catch (e) {
              console.error("Failed to save playground image to history:", e);
            }
          }
        }
      }

      setConversationTitle(normalizeConversationTitle(response.conversation?.title));
      setConversationTitleDraft(normalizeConversationTitle(response.conversation?.title));
      setConversationPromptTokens(response.conversation?.promptTokensTotal || 0);
      setConversationCompletionTokens(response.conversation?.completionTokensTotal || 0);
      setConversationCostTotal(response.conversation?.totalCostCredits || 0);
      setLastUsage(response.usage || null);
      setLastBillingMeta(response.meta || null);
      if (typeof response.meta?.current_balance === "number") {
        setCurrentCredits(response.meta.current_balance);
      }
      attachedImages.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      suppressEmptyConversationLoadRef.current = false;
    } catch (err) {
      suppressEmptyConversationLoadRef.current = false;
      setMessages((current) => current.slice(0, -1));
      setInput(inputBeforeSend);
      setInputImages(attachedImages);
      setError(err instanceof Error ? err.message : t("Could not get a reply."));
    } finally {
      setLoadingReply(false);
    }
  }

  const remainingChars = MAX_CHAT_TEXT_CHARS - input.length;
  const displayName = user?.displayName || user?.email?.split("@")[0] || "Studio User";
  const photoUrl = user?.photoURL || null;
  const normalizedConversationTitle = normalizeConversationTitle(conversationTitle);
  const displayConversationTitle = formatConversationTitle(normalizedConversationTitle);
  const conversationTotalTokens = conversationPromptTokens + conversationCompletionTokens;
  const lastResolvedCost = toResolvedCostNumber(lastBillingMeta?.resolvedCost);
  const lastTotalTokens = getUsageTotalTokens(lastUsage);
  const lastBillingComponents = Object.entries(lastBillingMeta?.billing?.components || {});

  async function handleNewChat() {
    if (!lockedModelId || !user) return;

    try {
      setLoadingReply(true);
      setError(null);
      hasBootstrappedChatRef.current = true;
      suppressEmptyConversationLoadRef.current = true;
      if (conversationId) {
        deletedConversationIdRef.current = conversationId;
      }
      if (typeof window !== "undefined") {
        sessionStorage.removeItem(STORAGE_KEY);
      }
      router.replace("/playground");
      setConversationId("");
      setConversationTitle(DEFAULT_CONVERSATION_TITLE);
      setConversationTitleDraft(DEFAULT_CONVERSATION_TITLE);
      setEditingConversationTitle(false);
      setConversationPromptTokens(0);
      setConversationCompletionTokens(0);
      setConversationCostTotal(0);
      setLastUsage(null);
      setLastBillingMeta(null);
      setMessages([]);
      setInput("");
      clearAttachedImages();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not start a new chat."));
    } finally {
      setLoadingReply(false);
    }
  }

  async function handleDeleteConversation() {
    if (!conversationId) return;
    const deletedConversationId = conversationId;
    if (typeof window !== "undefined" && !window.confirm(t("Delete this conversation? This action cannot be undone."))) {
      return;
    }

    try {
      setLoadingReply(true);
      setError(null);
      await api.deletePlainChatConversation(deletedConversationId);
      deletedConversationIdRef.current = deletedConversationId;
      setConversationId("");
      setConversationTitle(DEFAULT_CONVERSATION_TITLE);
      setConversationTitleDraft(DEFAULT_CONVERSATION_TITLE);
      setEditingConversationTitle(false);
      setConversationPromptTokens(0);
      setConversationCompletionTokens(0);
      setConversationCostTotal(0);
      setLastUsage(null);
      setLastBillingMeta(null);
      setMessages([]);
      setInput("");
      clearAttachedImages();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not delete this chat."));
    } finally {
      setLoadingReply(false);
    }
  }

  async function handleSaveConversationTitle() {
    const normalized = normalizeConversationTitle(conversationTitleDraft);
    if (!conversationId) {
      setConversationTitle(normalized);
      setConversationTitleDraft(normalized);
      setEditingConversationTitle(false);
      return;
    }

    try {
      setError(null);
      const updatedConversation = await api.updatePlainChatConversation(conversationId, { title: normalized });
      const nextTitle = normalizeConversationTitle(updatedConversation.title);
      setConversationTitle(nextTitle);
      setConversationTitleDraft(nextTitle);
      setEditingConversationTitle(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not rename this chat."));
    }
  }

  function renderParameterControl(key: string, entry: PlainChatParameterSchemaEntry) {
    const value = parameterValues[key];

    if (entry.type === "enum" && Array.isArray(entry.values) && entry.values.length > 0) {
      const current = typeof value === "string" || typeof value === "number" ? String(value) : "";

      const isOptionAffordable = (option: string) =>
        currentCredits === null ||
        getChatModelExpectedCost(lockedModel, { ...parameterValues, [key]: option }) <= currentCredits;

      // Aspect ratio reads as a shape, not a string: draw each option as a box in
      // its true proportions. Reuses the packs picker, which needs --accent vars.
      if (SHAPE_PARAMETER_KEYS.has(key)) {
        return (
          <div
            style={
              {
                "--accent": "#adc6ff",
                "--accent-15": "color-mix(in srgb, #adc6ff 15%, transparent)",
                "--accent-30": "color-mix(in srgb, #adc6ff 30%, transparent)",
                "--accent-60": "color-mix(in srgb, #adc6ff 60%, transparent)",
              } as CSSProperties
            }
          >
            <AspectShapePicker
              options={entry.values.map((option) => String(option))}
              value={current}
              onChange={(option) => setParameterValues((prev) => ({ ...prev, [key]: option }))}
              isOptionDisabled={(option) => !isOptionAffordable(option)}
            />
          </div>
        );
      }

      // A segmented row only survives a handful of options; aspect ratio routinely
      // ships 6+. Past that, wrap into a chip grid instead of squeezing the row.
      const segmented = entry.values.length <= 4;

      return (
        <div className={segmented ? "flex rounded-lg border border-white/[0.07] bg-[#0a0f1e] p-0.5" : "flex flex-wrap gap-1.5"}>
          {entry.values.map((option) => {
            const nextOption = String(option);
            const affordable = isOptionAffordable(nextOption);
            const active = nextOption === current;

            return (
              <button
                key={nextOption}
                type="button"
                disabled={!affordable}
                title={!affordable ? t("locked") : undefined}
                onClick={() => setParameterValues((prev) => ({ ...prev, [key]: nextOption }))}
                className={`${segmented ? "flex-1" : ""} rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                  active
                    ? "bg-white/[0.09] text-white shadow-[0_1px_2px_rgba(0,0,0,0.4)]"
                    : `text-white/45 hover:text-white/80 ${segmented ? "" : "border border-white/[0.07]"}`
                }`}
              >
                {toEnumOptionLabel(key, nextOption)}
              </button>
            );
          })}
        </div>
      );
    }

    if (entry.type === "boolean") {
      return (
        <button
          type="button"
          onClick={() => {
            setParameterValues((current) => ({ ...current, [key]: !Boolean(current[key]) }));
          }}
          className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors ${
            Boolean(value)
              ? "border-[#adc6ff]/30 bg-[#adc6ff]/10 text-[#adc6ff]"
              : "border-white/10 bg-[#101728] text-[#dce1fb]"
          }`}
        >
          <span>{Boolean(value) ? t("Enabled") : t("Disabled")}</span>
          <span
            className={`h-5 w-10 rounded-full transition-colors ${
              Boolean(value) ? "bg-[#4d8eff]" : "bg-[#2b3347]"
            }`}
          >
            <span
              className={`mt-[2px] block h-4 w-4 rounded-full bg-white transition-transform ${
                Boolean(value) ? "translate-x-5" : "translate-x-1"
              }`}
            />
          </span>
        </button>
      );
    }

    if (entry.type === "float" || entry.type === "integer") {
      const { min, max } = getNumericBounds(entry);
      const step = getParameterStep(entry);
      const numericValue = typeof value === "number" ? value : min;

      // The numeric readout sits in a pill on the label row (see the panel's
      // header render), leaving the track the full width of the cell.
      return (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={numericValue}
            onChange={(event) => {
              const nextValue = entry.type === "integer" ? Number.parseInt(event.target.value, 10) : Number.parseFloat(event.target.value);
              setParameterValues((current) => ({ ...current, [key]: nextValue }));
            }}
            className="chat-range-slider"
          />
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={numericValue}
            onChange={(event) => {
              const raw = event.target.value;
              const parsed = entry.type === "integer" ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
              if (Number.isNaN(parsed)) {
                setParameterValues((current) => ({ ...current, [key]: min }));
                return;
              }
              const bounded = Math.min(max, Math.max(min, parsed));
              setParameterValues((current) => ({ ...current, [key]: bounded }));
            }}
            className="w-16 shrink-0 rounded-md border border-white/[0.07] bg-[#0a0f1e] px-2 py-1 text-right text-[12px] tabular-nums text-white/80 outline-none transition focus:border-[#adc6ff]/40"
          />
        </div>
      );
    }

    if (entry.type === "color") {
      const hex = normalizeHex(value);
      return (
        <div className="flex items-center gap-2">
          <ColorPickerPopover
            value={hex}
            onChange={(next) => setParameterValues((current) => ({ ...current, [key]: next }))}
            onClear={() => setParameterValues((current) => ({ ...current, [key]: "" }))}
          />
          <span className="font-mono text-[12px] text-[#8c909f]">{hex || t("None")}</span>
        </div>
      );
    }

    if (entry.type === "colorList") {
      const list: string[] = Array.isArray(value) ? (value as string[]) : [];
      const maxItems = typeof entry.maxItems === "number" ? entry.maxItems : 5;
      return (
        <div className="flex flex-wrap items-center gap-2">
          {list.map((color, index) => (
            <div key={`${key}-${index}`} className="flex items-center gap-1 rounded-md border border-white/10 bg-[#101728] px-1.5 py-1">
              <ColorPickerPopover
                value={normalizeHex(color)}
                onChange={(next) =>
                  setParameterValues((current) => {
                    const arr = [...list];
                    arr[index] = next;
                    return { ...current, [key]: arr };
                  })
                }
              />
              <button
                type="button"
                aria-label="Remove color"
                onClick={() => setParameterValues((current) => ({ ...current, [key]: list.filter((_, i) => i !== index) }))}
                className="px-1 text-sm font-bold text-[#8c909f] hover:text-red-300"
              >
                ×
              </button>
            </div>
          ))}
          {list.length < maxItems ? (
            <button
              type="button"
              onClick={() => setParameterValues((current) => ({ ...current, [key]: [...list, "#10b981"] }))}
              className="rounded-md border border-dashed border-white/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#8c909f] hover:border-white/40 hover:text-[#dce1fb]"
            >
              + {t("Add color")}
            </button>
          ) : null}
        </div>
      );
    }

    return (
      <div className="rounded-md border border-white/10 bg-[#101728] px-3 py-2 text-sm text-[#8c909f]">
        {t("Unsupported parameter type.")}
      </div>
    );
  }

  return (
    // Full-height app surface: the rail is supplied by playground/layout.tsx.
    <section className="h-dvh overflow-hidden">
        <MotionConfig reducedMotion="user">
        <div ref={chatCanvasRef} className="chat-canvas flex h-full flex-col overflow-hidden">
          <div className="chat-sea" aria-hidden="true">
            <div className="chat-sea__tide" />
            <div className="chat-sea__blob chat-sea__blob--a" />
            <div className="chat-sea__blob chat-sea__blob--b" />
            <div className="chat-sea__blob chat-sea__blob--c" />
            <div className="chat-sea__blob chat-sea__blob--d" />
            {/* Floating luminous motes — soft glowing sparks that drift slowly
                upward and twinkle, like creative energy gathering toward the vortex.
                Nested inside chat-sea (absolute, full-canvas) so they can never touch
                layout; each fades to 0 opacity at both ends so the loop is seamless. */}
            {CHAT_MOTES.map((mote, i) => (
              <span
                key={i}
                className={`chat-mote chat-mote--${mote.drift}`}
                style={{
                  left: mote.left,
                  top: mote.top,
                  width: mote.size,
                  height: mote.size,
                  background: `radial-gradient(circle, ${mote.color} 0%, transparent 70%)`,
                  boxShadow: `0 0 ${mote.size * 2}px ${mote.color}`,
                  animationDuration: `${mote.dur}s`,
                  animationDelay: `${mote.delay}s`,
                }}
              />
            ))}
          </div>
          <header className="relative z-30 flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#0a0f1e]/80 px-2.5 backdrop-blur-xl sm:px-5">
            <div className="flex min-w-0 items-center gap-2.5">
              {editingConversationTitle ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={conversationTitleDraft}
                    onChange={(event) => setConversationTitleDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleSaveConversationTitle();
                      }
                      if (event.key === "Escape") {
                        setConversationTitleDraft(normalizedConversationTitle);
                        setEditingConversationTitle(false);
                      }
                    }}
                    maxLength={120}
                    autoFocus
                    className="w-36 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-sm font-semibold text-white outline-none focus:border-[#adc6ff]/40 sm:w-52"
                  />
                  <button type="button" onClick={() => void handleSaveConversationTitle()} className="chat-topbar-btn !h-7 !w-7 text-[#adc6ff]">
                    <span className="material-symbols-outlined text-[16px]">check</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConversationTitleDraft(normalizedConversationTitle);
                      setEditingConversationTitle(false);
                    }}
                    className="chat-topbar-btn !h-7 !w-7"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setConversationTitleDraft(normalizedConversationTitle);
                    setEditingConversationTitle(true);
                  }}
                  className="group flex min-w-0 items-center gap-1.5"
                >
                  <h1 className="max-w-[128px] truncate text-sm font-semibold text-white sm:max-w-xs">{normalizedConversationTitle === DEFAULT_CONVERSATION_TITLE ? t("New Chat") : normalizedConversationTitle}</h1>
                  <span className="material-symbols-outlined shrink-0 text-[14px] text-white/25 transition-colors group-hover:text-white/60">edit</span>
                </button>
              )}
              <span className="hidden text-white/15 sm:inline">.</span>
              <span className="hidden max-w-[160px] truncate text-[11px] font-medium text-[#6b7a8f] sm:inline">{lockedModel?.displayName || t("Model")}</span>
            </div>

            <div className={`items-center gap-1 ${editingConversationTitle ? "hidden sm:flex" : "flex"}`}>
              <div className="mr-1.5 hidden items-center gap-2.5 text-[11px] text-[#6b7a8f] lg:flex">
                <span className="font-mono tabular-nums">
                  {conversationTotalTokens.toLocaleString()} <span className="text-white/20">tok</span>
                </span>
                <span className="text-white/10">.</span>
                <span className="font-mono tabular-nums text-[#adc6ff]/60">
                  {conversationCostTotal.toFixed(2)} <span className="text-white/20">Cr</span>
                </span>
              </div>
              <div className="mr-0.5 hidden h-4 w-px bg-white/[0.06] lg:block" />

              <button type="button" onClick={() => void handleNewChat()} title={t("New Chat")} className="chat-topbar-btn">
                <span className="material-symbols-outlined text-[18px]">add</span>
              </button>
              <button type="button" onClick={() => void handleDeleteConversation()} disabled={!conversationId || loadingReply} title={t("Delete Chat")} className="chat-topbar-btn hover:!text-red-400/80">
                <span className="material-symbols-outlined text-[18px]">delete_outline</span>
              </button>
              <div className="mx-0.5 h-4 w-px bg-white/[0.06]" />

              <div className="chat-credits-badge">
                <span className="material-symbols-outlined text-[13px] text-[#adc6ff]" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
                <span className="text-[11px] font-bold tabular-nums text-blue-100/80">{currentCredits === null ? "..." : currentCredits.toFixed(2)}</span>
              </div>
            </div>
          </header>

          <div className="flex items-center justify-center gap-4 border-b border-white/[0.04] bg-[#0a0f1e]/60 px-4 py-1.5 text-[11px] text-[#6b7a8f] lg:hidden">
            <span className="tabular-nums">{conversationTotalTokens.toLocaleString()} {t("tokens")}</span>
            <span className="text-white/10">.</span>
            <span className="tabular-nums text-[#adc6ff]/60">{conversationCostTotal.toFixed(2)} Cr</span>
          </div>

          <div className="relative z-10 flex flex-1 overflow-hidden">
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="chat-messages-scroll flex-1 overflow-y-auto" onScroll={handleMessagesScroll}>
                <div className="mx-auto max-w-4xl px-3 py-6 sm:px-6 sm:py-8 lg:px-8">
                  {loadingConversation || isBootstrappingRequestedConversation ? (
                    <div className="flex min-h-[50vh] items-center justify-center">
                      <div className="flex items-center gap-2">
                        <div className="chat-typing-dot" />
                        <div className="chat-typing-dot" />
                        <div className="chat-typing-dot" />
                      </div>
                    </div>
                  ) : messages.length === 0 ? (
                    <motion.div
                      className="flex min-h-[55vh] flex-col items-center justify-center"
                      variants={emptyContainerVariants}
                      initial="hidden"
                      animate="show"
                    >
                      <motion.div variants={emptyItemVariants} className="chat-empty-orb" aria-hidden="true">
                        <span className="chat-empty-orb__ring" />
                        <span className="chat-empty-orb__core">
                          <motion.span
                            className="chat-vortex-wrap"
                            animate={{ scale: [1, 1.06, 1], opacity: [0.85, 1, 0.85] }}
                            transition={{ duration: 4.5, ease: "easeInOut", repeat: Infinity }}
                          >
                            {/* Spiral vortex inspired by the Vibecraft logo — swirling
                                blades curling into a hollow core, slowly counter-rotating
                                against the aurora ring for a sense of depth. */}
                            <svg className="chat-vortex" viewBox="0 0 100 100" fill="none">
                              <defs>
                                <linearGradient id="chatVortexGrad" x1="0" y1="0" x2="1" y2="1">
                                  <stop offset="0%" stopColor="#dcd4ff" />
                                  <stop offset="45%" stopColor="#8b5cf6" />
                                  <stop offset="100%" stopColor="#22d3ee" />
                                </linearGradient>
                              </defs>
                              <g className="chat-vortex__spin" stroke="url(#chatVortexGrad)" strokeWidth="4.4" strokeLinecap="round">
                                {[0, 60, 120, 180, 240, 300].map((deg) => (
                                  <path key={deg} d="M50 40 C66 39 74 55 62 68" transform={`rotate(${deg} 50 50)`} />
                                ))}
                              </g>
                              <circle cx="50" cy="50" r="3.2" fill="#ede9fe" />
                            </svg>
                          </motion.span>
                        </span>
                      </motion.div>
                      <motion.h2 variants={emptyItemVariants} className="mt-7 text-[22px] font-semibold tracking-[-0.015em] text-white/90">
                        {lockedModelIsOneShotImage ? t("One-shot image generation") : t("What will you create?")}
                      </motion.h2>
                      <motion.p variants={emptyItemVariants} className="mt-2.5 max-w-[360px] text-center text-[13px] leading-relaxed text-[#5a6580]">
                        {lockedModelIsOneShotImage
                          ? `${lockedModel?.displayName || t("This model")} ${t("generates an image directly from your prompt. It does not use chat memory, so write the full image request in one message.")}`
                          : `${t("Ask a question, describe an image, or start a brainstorming session with")} ${lockedModel?.displayName || t("your model")}.`}
                      </motion.p>

                      <motion.div variants={emptyItemVariants} className="mt-6 flex min-h-[42px] flex-col items-center gap-2">
                        <span className="chat-idea-eyebrow">{t("Try")}</span>
                        <AnimatePresence mode="wait">
                          <motion.button
                            key={ideaIndex}
                            type="button"
                            onClick={() => {
                              setInput(t(STARTER_IDEAS[ideaIndex]));
                              requestAnimationFrame(() => textareaRef.current?.focus());
                            }}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
                            className="chat-idea-pill"
                          >
                            <span>“{t(STARTER_IDEAS[ideaIndex])}”</span>
                            <span className="material-symbols-outlined">north_east</span>
                          </motion.button>
                        </AnimatePresence>
                      </motion.div>
                    </motion.div>
                  ) : (
                    <div className="flex flex-col gap-6 pb-4">
                      <AnimatePresence initial={false} mode="popLayout">
                        {messages.map((message) => (
                          <motion.div
                            key={message.id}
                            layout
                            custom={message.role}
                            variants={messageVariants}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                          >
                            <div className={`flex max-w-[88%] flex-col gap-1.5 sm:max-w-[78%] ${message.role === "user" ? "items-end" : "items-start"}`}>
                              <div className={`chat-msg-label flex items-center gap-1.5 px-1.5 ${message.role === "user" ? "text-[#adc6ff]/50" : "text-white/35"}`}>
                                {message.role !== "user" ? <span className="chat-msg-dot chat-msg-dot--assistant" /> : null}
                                {message.role === "user" ? displayName : lockedModel?.displayName || t("Assistant")}
                                {message.role === "user" ? <span className="chat-msg-dot chat-msg-dot--user" /> : null}
                              </div>
                              <div className={`group relative ${message.role === "user" ? "chat-msg-user" : "chat-msg-assistant"}`}>
                                {message.role === "user" ? <UserMessageContent message={message} /> : <AssistantMessageContent message={message} />}
                              </div>
                            </div>
                          </motion.div>
                        ))}

                        {loadingReply ? (
                          <motion.div
                            key="typing-indicator"
                            layout
                            variants={typingVariants}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            className="flex justify-start"
                          >
                            <div className="flex max-w-[78%] flex-col items-start gap-1.5">
                              <div className="chat-msg-label flex items-center gap-1.5 px-1.5 text-white/35">
                                <span className="chat-msg-dot chat-msg-dot--assistant" />
                                {lockedModel?.displayName || t("Assistant")}
                              </div>
                              <ChatThinkingIndicator
                                expectsImage={Boolean(lockedModel && outputsImage(lockedModel))}
                                imageOnly={lockedModelIsOneShotImage}
                                expectedSeconds={getModelLatencyBudget(lockedModel, parameterValues)}
                                reducedMotion={Boolean(prefersReducedMotion)}
                                t={t}
                              />
                            </div>
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* pb-[5.5rem] clears the app rail's fixed mobile bottom nav (h-20);
                  on lg the rail is a left column and the extra padding goes away. */}
              <div className="shrink-0 px-2.5 pb-[5.5rem] pt-2 sm:px-5 lg:pb-5">
                <div className="mx-auto max-w-2xl">
                  {notice ? (
                    <div className="mb-3 flex items-center gap-2 rounded-xl border border-[#adc6ff]/25 bg-[#adc6ff]/[0.08] px-4 py-2.5 text-[13px] text-[#adc6ff]">
                      <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
                      <span>{notice}</span>
                    </div>
                  ) : null}
                  {error ? (
                    error === CONTENT_BLOCKED_MESSAGE ? (
                      <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-4 py-2.5 text-[13px] text-amber-200/90">
                        {t("This request was blocked by our content safety filters and was not charged. Repeated violations may lead to your account being suspended.")}{" "}
                        <Link href="/policy" className="font-medium underline transition hover:text-amber-100">
                          {t("Review our content policy.")}
                        </Link>
                      </div>
                    ) : (
                      <div className="mb-3 rounded-xl border border-red-500/20 bg-red-500/[0.07] px-4 py-2.5 text-[13px] text-red-200/90">
                        {localizeChatError(error)}
                      </div>
                    )
                  ) : null}

                  <input ref={fileInputRef} type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleImageUpload} />

                  {lockedModel?.supportsImageInput && inputImages.length > 0 ? (
                    <div className="chat-image-preview mb-3 flex items-center gap-3 px-4 py-2.5">
                      <div className="flex shrink-0 flex-nowrap items-center gap-2">
                        {inputImages.map((image) => (
                          <div
                            key={image.localId}
                            className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/12 shadow-[0_4px_14px_rgba(0,0,0,0.3)] transition-transform duration-200 hover:scale-[1.06]"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={image.previewUrl} alt={image.name} className="h-full w-full object-cover" />
                            {image.uploading ? (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[1px]">
                                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                              </div>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => removeAttachedImage(image.localId)}
                              className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/75 text-white ring-1 ring-white/20 transition-colors hover:bg-red-500/80"
                              aria-label={t("Remove image")}
                            >
                              <span className="material-symbols-outlined text-[11px]">close</span>
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-white/80">
                          {inputImages.length} / {maxInputImages} {t("images attached")}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={clearAttachedImages}
                        className="chat-topbar-btn !h-8 !w-8 text-white/40 hover:!text-red-400/80"
                      >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                      </button>
                    </div>
                  ) : null}

                  <div className="chat-composer px-4 py-3 sm:px-5 sm:py-3.5">
                    {composerCharging ? <span key={chargeKey} className="chat-composer__charge" aria-hidden="true" /> : null}
                    <textarea
                      ref={textareaRef}
                      value={input}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setInput(nextValue.slice(0, MAX_CHAT_TEXT_CHARS));
                        if (error && nextValue.length <= MAX_CHAT_TEXT_CHARS) {
                          setError(null);
                        }
                      }}
                      onPaste={handleImagePaste}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          if (input.trim() || inputImages.length > 0) runComposerCharge();
                          void handleSend();
                        }
                      }}
                      placeholder={lockedModel?.supportsImageInput ? t("Ask anything, or drop an image...") : t("Ask anything...")}
                      rows={1}
                      className="w-full resize-none bg-transparent text-[14px] leading-relaxed text-white/90 outline-none placeholder:text-white/20"
                    />

                    <div className="mt-3 flex items-center justify-between border-t border-white/[0.04] pt-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        {lockedModel?.supportsImageInput ? (
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploadingImage || loadingReply}
                            className="chat-attach-btn"
                            title={t("Upload image")}
                          >
                            <span className="material-symbols-outlined text-[17px]">add_photo_alternate</span>
                          </button>
                        ) : null}

                        <ModelPickerPopover
                          groups={pickerGroups}
                          value={lockedModelId}
                          onSelect={handleModelChange}
                          disabled={loadingConfig || loadingReply || loadingConversation}
                          isRtl={isRtl}
                          t={t}
                        />

                        <span className={`hidden text-[11px] tabular-nums text-white/12 transition-colors sm:inline ${remainingChars < 400 ? "!text-red-400/50" : ""} ${input.length > 0 ? "!text-white/20" : ""}`}>
                          {input.length > 0 ? `${input.length.toLocaleString()} / ${MAX_CHAT_TEXT_CHARS.toLocaleString()}` : ""}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                      {/* Model Controls lives beside Send rather than in the topbar:
                          it configures the next message, so it belongs with the
                          controls that send one. */}
                      <button
                        ref={settingsBtnRef}
                        type="button"
                        onClick={() => setSettingsPanelOpen((prev) => !prev)}
                        className={`chat-attach-btn ${settingsPanelOpen ? "!text-[#adc6ff] !bg-white/[0.06]" : ""}`}
                        title={t("Model Settings")}
                        aria-pressed={settingsPanelOpen}
                      >
                        <span className="material-symbols-outlined text-[17px]">tune</span>
                      </button>

                      <motion.button
                        type="button"
                        onClick={() => {
                          runComposerCharge();
                          void handleSend();
                        }}
                        disabled={
                          (!input.trim() && inputImages.length === 0) ||
                          input.trim().length > MAX_CHAT_TEXT_CHARS ||
                          !lockedModelId ||
                          loadingReply ||
                          uploadingImage ||
                          loadingConversation
                        }
                        variants={{ hover: { scale: 1.03, y: -1 }, tap: { scale: 0.95, y: 0 } }}
                        whileHover="hover"
                        whileTap="tap"
                        transition={CHAT_SPRING}
                        className="chat-send-btn"
                      >
                        <span>{uploadingImage ? t("Uploading...") : t("Send")}</span>
                        <motion.span
                          className="material-symbols-outlined text-[15px]"
                          variants={{ hover: { y: -2, x: 1 }, tap: { y: 0 } }}
                          transition={CHAT_SPRING}
                        >
                          arrow_upward
                        </motion.span>
                      </motion.button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {settingsPanelOpen && settingsPos && typeof document !== "undefined"
              ? createPortal(
                <motion.div
                  ref={settingsPanelRef}
                  dir={isRtl ? "rtl" : "ltr"}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.16 }}
                  style={{ position: "fixed", left: settingsPos.left, bottom: settingsPos.bottom, width: settingsPos.width }}
                  className="z-[9998] max-h-[60vh] overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#0f1626]/95 p-3 shadow-[0_20px_60px_rgba(0,0,0,0.65)] backdrop-blur-xl"
                >
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">{t("Model Controls")}</span>
                    {editableModelParameters.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (!lockedModel) return;
                          setParameterValues(createParameterState(lockedModel.parameterSchema));
                        }}
                        className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-white/35 transition-colors hover:text-[#adc6ff]"
                      >
                        <span className="material-symbols-outlined text-[13px]">refresh</span>
                        {t("Reset all")}
                      </button>
                    ) : null}
                  </div>

                  {editableModelParameters.length > 0 ? (
                    // Sliders take a full row; enums/booleans/colors sit two-up. The
                    // per-model mix is lopsided (some models are all sliders, some all
                    // enums), so this degrades better than a fixed two-column split.
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {editableModelParameters.map(([key, entry]) => {
                        const pricingHint = getChatParamPricingHint(lockedModel, key);
                        // Sliders need the track width; shape pickers need room to
                        // lay their boxes out without wrapping mid-row.
                        const isWide =
                          entry.type === "float" || entry.type === "integer" || SHAPE_PARAMETER_KEYS.has(key);
                        return (
                          <div
                            key={key}
                            className={`rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5 ${isWide ? "sm:col-span-2" : ""}`}
                          >
                            <div className="mb-2 flex items-center gap-1.5">
                              <label className="text-[11px] font-medium text-white/50">{toParameterLabel(key)}</label>
                              {pricingHint ? (
                                <span className="group relative inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-white/10 text-[9px] font-bold text-[#adc6ff]/50">
                                  ?
                                  <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-max max-w-[220px] whitespace-pre-line rounded-xl border border-white/8 bg-[#0a0f1e] px-3 py-2.5 text-[11px] font-medium leading-5 text-white/75 shadow-2xl group-hover:block">
                                    {pricingHint}
                                  </span>
                                </span>
                              ) : null}
                            </div>
                            {renderParameterControl(key, entry)}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="px-1 py-6 text-center text-[12px] text-white/30">
                      <span className="material-symbols-outlined mb-1 block text-xl text-white/12">settings_suggest</span>
                      {t("No editable parameters for this model.")}
                    </div>
                  )}
                </motion.div>,
                document.body,
              )
              : null}
          </div>
        </div>
        </MotionConfig>
    </section>
  );
}
