"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type ReactNode } from "react";
import { useAuth } from "../../../context/AuthContext";
import { useLanguage } from "../../../context/LanguageContext";
import InteractiveAuthenticatedImage from "../../../components/InteractiveAuthenticatedImage";
import { isRenderableImageUrl } from "../../../components/AuthenticatedImage";
import { ColorPickerPopover } from "../../../components/ColorPickerPopover";
import { api, CONTENT_BLOCKED_MESSAGE, MODERATION_UNAVAILABLE_MESSAGE } from "../../../services/api";
import { addHistoryEntry } from "../../../lib/history";
import { getModelDescription } from "../../../lib/modelDescriptions";
import { getUploadConstraints, maxInputImagesForModelId, preferredOutputType, providerLabelForModelId, readImageDimensions, type UploadImageConstraints } from "../../../lib/imageInputConstraints";
import type { BillingBreakdown, BillingUsage, ModelPricingSummary, PlainChatModelItem, PlainChatParameterSchemaEntry, PlainChatPart, PlainChatTurnMeta, UploadedImageResult } from "../../../types";

type ChatRole = "user" | "assistant";
type ChatPhase = "select" | "chat";

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

const STORAGE_KEY = "studio-simple-chat-v2";
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
              wrapperClassName="rounded-xl border border-white/10"
              imageClassName="max-h-64 w-auto object-cover shadow-[0_12px_30px_rgba(0,0,0,0.28)]"
              loadingClassName="flex min-h-40 min-w-40 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-xs text-white/60"
              errorClassName="flex min-h-40 min-w-40 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-xs text-white/60"
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
              wrapperClassName="rounded-xl border border-black/10"
              imageClassName="h-20 w-20 object-cover shadow-[0_8px_18px_rgba(0,0,0,0.16)]"
              loadingClassName="flex h-20 w-20 items-center justify-center rounded-xl border border-black/10 bg-black/5 text-xs text-black/60"
              errorClassName="flex h-20 w-20 items-center justify-center rounded-xl border border-black/10 bg-black/5 text-xs text-black/60"
              controls="open"
              controlButtonClassName="h-6 w-6"
              controlIconClassName="text-[13px]"
            />
          ))}
        </div>
      ) : null}
    </div>
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

export default function StudioChatPage() {
  const { user, loading: authLoading } = useAuth();
  const { t, language } = useLanguage();
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
  const [phase, setPhase] = useState<ChatPhase>("select");
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [providerGroups, setProviderGroups] = useState<ProviderGroup[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("");
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
  const [currentCredits, setCurrentCredits] = useState<number | null>(null);
  const [conversationPromptTokens, setConversationPromptTokens] = useState(0);
  const [conversationCompletionTokens, setConversationCompletionTokens] = useState(0);
  const [conversationCostTotal, setConversationCostTotal] = useState(0);
  const [lastUsage, setLastUsage] = useState<BillingUsage | null>(null);
  const [lastBillingMeta, setLastBillingMeta] = useState<PlainChatTurnMeta | null>(null);
  const [parameterValues, setParameterValues] = useState<ParameterState>({});
  const [providerSearch, setProviderSearch] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const loadingReplyRef = useRef(false);
  const messageCountRef = useRef(0);
  const suppressEmptyConversationLoadRef = useRef(false);
  const hasBootstrappedChatRef = useRef(false);
  const deletedConversationIdRef = useRef("");
  const failedConversationLoadRef = useRef("");
  const inputImagesRef = useRef<UploadedImageState[]>([]);
  const deepLinkAppliedRef = useRef(false);

  const searchParams = useSearchParams();
  const forceNewSession = searchParams?.get("new") === "1";
  const requestedConversationId = searchParams?.get("conversation");
  const requestedModelParam = searchParams?.get("model") || "";
  const requestedPromptParam = searchParams?.get("prompt") || "";
  const requestedConversationIsActive =
    Boolean(requestedConversationId) && requestedConversationId !== deletedConversationIdRef.current;
  const isBootstrappingRequestedConversation = requestedConversationIsActive && requestedConversationId !== conversationId;
  const renderPhase: ChatPhase = requestedConversationIsActive ? "chat" : phase;

  // On large screens, reveal the Model Controls panel automatically when a chat
  // opens. Only auto-opens once per entry into the chat phase, so the user can
  // still close it and it won't fight them until they go back and reopen a chat.
  const autoOpenedControlsRef = useRef(false);
  useEffect(() => {
    if (renderPhase !== "chat") {
      autoOpenedControlsRef.current = false;
      return;
    }
    if (autoOpenedControlsRef.current) return;
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
      setSettingsPanelOpen(true);
      autoOpenedControlsRef.current = true;
    }
  }, [renderPhase]);

  useEffect(() => {
    loadingReplyRef.current = loadingReply;
    messageCountRef.current = messages.length;
  }, [loadingReply, messages.length]);

  useEffect(() => {
    if (forceNewSession) {
      hasBootstrappedChatRef.current = true;
      sessionStorage.removeItem(STORAGE_KEY);
      setPhase("select");
      setMessages([]);
      setSelectedProvider("");
      setSelectedModel("");
      setLockedModelId("");
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
      setPhase("chat");
      setMessages([]);
      setSelectedProvider("");
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
        phase?: ChatPhase;
        messages?: ChatMessage[];
        selectedProvider?: string;
        selectedModel?: string;
        lockedModelId?: string;
        conversationId?: string;
        conversationTitle?: string;
        parameterValues?: ParameterState;
      };
      setPhase(parsed.phase || "select");
      setMessages(parsed.messages || []);
      setSelectedProvider(parsed.selectedProvider || "");
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
      JSON.stringify({ phase, messages, selectedProvider, selectedModel, lockedModelId, conversationId, conversationTitle, parameterValues }),
    );
  }, [conversationId, conversationTitle, isBootstrappingRequestedConversation, lockedModelId, messages, parameterValues, phase, selectedModel, selectedProvider]);

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

          const nextProvider = selectedProvider && nextGroups.some((group) => group.provider === selectedProvider)
            ? selectedProvider
            : nextGroups[0]?.provider || "";
          const nextProviderModels = nextGroups.find((group) => group.provider === nextProvider)?.models || [];
          const nextSelected = selectedModel && nextProviderModels.some((model) => model.id === selectedModel)
            ? selectedModel
            : nextProviderModels[0]?.id || "";

          setSelectedProvider(nextProvider);
          setSelectedModel(nextSelected);

          if (lockedModelId && !nextGroups.some((group) => group.models.some((model) => model.id === lockedModelId))) {
            setLockedModelId("");
            setConversationId("");
            setConversationTitle(DEFAULT_CONVERSATION_TITLE);
            setConversationTitleDraft(DEFAULT_CONVERSATION_TITLE);
            setEditingConversationTitle(false);
            setPhase("select");
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
  // an optional pre-filled prompt (e.g. dashboard quick-start cards link here as
  // /studio/chat?model=<id>&prompt=<text>). Runs once after models load.
  useEffect(() => {
    if (deepLinkAppliedRef.current) return;
    if (!requestedModelParam) return;
    if (providerGroups.length === 0) return;

    deepLinkAppliedRef.current = true;

    let match: { provider: string; modelId: string } | null = null;
    for (const group of providerGroups) {
      const found = group.models.find((model) => model.id === requestedModelParam);
      if (found) {
        match = { provider: group.provider, modelId: found.id };
        break;
      }
    }

    // Strip the deep-link params so a refresh / back nav doesn't re-trigger it.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("model");
      url.searchParams.delete("prompt");
      window.history.replaceState({}, "", url.toString());
    }

    if (!match) return; // Requested model not available — leave the default picker.

    hasBootstrappedChatRef.current = true;
    setSelectedProvider(match.provider);
    setSelectedModel(match.modelId);
    setLockedModelId(match.modelId);
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
    setPhase("chat");
    if (requestedPromptParam) setInput(requestedPromptParam);
  }, [providerGroups, requestedModelParam, requestedPromptParam]);

  useEffect(() => {
    let cancelled = false;

    async function loadConversation() {
      if (!user || phase !== "chat" || !conversationId) return;

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
        setPhase("select");
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
  }, [conversationId, phase, user]);

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

  const activeProviderGroup = useMemo(
    () => providerGroups.find((group) => group.provider === selectedProvider) || null,
    [providerGroups, selectedProvider],
  );

  const visibleProviderGroups = useMemo(() => {
    const providerQuery = providerSearch.trim().toLowerCase();
    const modelQuery = modelSearch.trim().toLowerCase();

    return providerGroups
      .map((group) => {
        const providerMatches = !providerQuery || group.provider.toLowerCase().includes(providerQuery);
        const models = group.models.filter((model) => {
          if (modelQuery) {
            const haystack = `${model.displayName} ${getModelDescription(model.id, language) || model.description || ""}`.toLowerCase();
            if (!haystack.includes(modelQuery)) return false;
          }
          return providerMatches;
        });
        return { ...group, models };
      })
      .filter((group) => group.models.length > 0);
  }, [modelSearch, providerGroups, providerSearch, language]);

  const visibleActiveProviderGroup = useMemo(() => {
    return visibleProviderGroups.find((group) => group.provider === selectedProvider) || visibleProviderGroups[0] || null;
  }, [selectedProvider, visibleProviderGroups]);

  const visibleSelectedModelOption = useMemo(() => {
    return visibleActiveProviderGroup?.models.find((model) => model.id === selectedModel)
      || visibleActiveProviderGroup?.models[0]
      || null;
  }, [selectedModel, visibleActiveProviderGroup]);

  const selectedModelOption = useMemo(
    () => activeProviderGroup?.models.find((model) => model.id === selectedModel) || null,
    [activeProviderGroup, selectedModel],
  );

  const lockedModel = useMemo(
    () => providerGroups.flatMap((group) => group.models).find((model) => model.id === lockedModelId) || null,
    [lockedModelId, providerGroups],
  );

  const selectedModelMinimumCost = useMemo(
    () => getChatModelMinimumCost(visibleSelectedModelOption),
    [visibleSelectedModelOption],
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

  const insufficientSelectedModelCredits = currentCredits !== null && currentCredits < selectedModelMinimumCost;
  const insufficientLockedModelMinimumCredits = currentCredits !== null && currentCredits < lockedModelMinimumCost;
  const insufficientLockedModelExpectedCredits = currentCredits !== null && currentCredits < lockedModelExpectedCost;

  const lockedModelParameters = useMemo(
    () => (lockedModel ? getVisibleChatParameters(lockedModel.parameterSchema) : []),
    [lockedModel],
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

  async function handleStartChat() {
    if (!selectedModel || !user) return;
    if (insufficientSelectedModelCredits) {
      setError(`You need at least ${selectedModelMinimumCost.toFixed(2)} credits to use this model.`);
      return;
    }

    try {
      setLoadingReply(true);
      setError(null);
      setLockedModelId(selectedModel);
      setConversationId("");
      setConversationTitle(DEFAULT_CONVERSATION_TITLE);
      setConversationTitleDraft(DEFAULT_CONVERSATION_TITLE);
      setEditingConversationTitle(false);
      setConversationPromptTokens(0);
      setConversationCompletionTokens(0);
      setConversationCostTotal(0);
      setLastUsage(null);
      setLastBillingMeta(null);
      setPhase("chat");
      setMessages([]);
      setInput("");
      clearAttachedImages();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not start a chat."));
    } finally {
      setLoadingReply(false);
    }
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

  function renderModelParamsPanel(isMobile = false) {
    return (
      <div
        className={`h-full ${
          isMobile
            ? "overflow-hidden rounded-xl border border-[rgba(173,198,255,0.1)] bg-[rgba(25,31,49,0.7)] backdrop-blur-[16px]"
            : "border-l border-white/10 bg-transparent"
        }`}
      >
        <div className={`flex items-center justify-end border-b border-white/10 ${isMobile ? "p-5" : "px-4 py-5"}`}>
          {lockedModelParameters.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                if (!lockedModel) return;
                setParameterValues(createParameterState(lockedModel.parameterSchema));
              }}
              className="text-[10px] font-bold uppercase text-[#adc6ff] hover:underline"
            >
              {t("Reset")}
            </button>
          ) : null}
        </div>

        <div className={`space-y-4 overflow-y-auto custom-scrollbar ${isMobile ? "max-h-[420px] p-5" : "h-[calc(100vh-64px-61px)] px-4 py-5"}`}>
              {lockedModelParameters.length > 0 ? (
                <div className="space-y-4">
                  {lockedModelParameters.map(([key, entry]) => {
                    const pricingHint = getChatParamPricingHint(lockedModel, key);
                    return (
                      <div key={key} className="space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#c2c6d6]">
                            <span>{toParameterLabel(key)}</span>
                            {pricingHint ? (
                              <span
                                className="group relative mr-1 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-white/15 text-[10px] font-bold normal-case tracking-normal text-[#adc6ff]"
                                aria-label="Show size pricing"
                              >
                                !
                                <span className="pointer-events-none absolute left-4 top-full z-20 mt-4 hidden w-max max-w-[220px] whitespace-pre-line rounded-md border border-white/10 bg-[#151b2d] px-3 py-2 text-[11px] font-medium normal-case leading-5 tracking-normal text-white shadow-[0_12px_30px_rgba(0,0,0,0.35)] group-hover:block">
                                  {pricingHint}
                                </span>
                              </span>
                            ) : null}
                          </label>
                        </div>
                        {renderParameterControl(key, entry)}
                      </div>
                    );
                  })}
                </div>
          ) : (
            <div className={`${isMobile ? "rounded-lg border border-white/8 bg-[#151b2d] px-4 py-5" : "px-1 py-2"} text-sm leading-6 text-[#8c909f]`}>
              {t("This model does not expose editable chat parameters yet.")}
            </div>
          )}
        </div>
      </div>
    );
  }

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
      router.replace("/studio/chat");
      setPhase("chat");
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
      return (
        <select
          value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
          onChange={(event) => {
            setParameterValues((current) => ({ ...current, [key]: event.target.value }));
          }}
          className="w-full rounded-md border border-white/10 bg-[#101728] px-3 py-2 text-sm text-white outline-none transition focus:border-[#adc6ff]/40"
        >
          {entry.values.map((option) => {
            const nextOption = String(option);
            const nextValues = { ...parameterValues, [key]: nextOption };
            const affordable = currentCredits === null || getChatModelExpectedCost(lockedModel, nextValues) <= currentCredits;
            return (
              <option key={nextOption} value={nextOption} disabled={!affordable}>
                {toEnumOptionLabel(key, nextOption)}{!affordable ? ` — ${t("locked")}` : ""}
              </option>
            );
          })}
        </select>
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

      return (
        <div className="space-y-3">
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
              className="w-28 rounded-md border border-white/10 bg-[#101728] px-3 py-2 text-sm text-white outline-none transition focus:border-[#adc6ff]/40"
            />
          </div>
          <div className="flex justify-between text-[11px] text-[#8c909f]">
            <span>{min}</span>
            <span>{max}</span>
          </div>
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
    <section className={renderPhase === "chat" ? "h-dvh overflow-hidden" : "min-h-[calc(100vh-4rem)] overflow-x-hidden px-4 py-4 sm:px-6 sm:py-8 lg:px-10"}>
      {renderPhase === "select" ? (
        <div className="relative mx-auto flex min-h-[calc(100vh-6rem)] max-w-[1600px] flex-col overflow-hidden rounded-2xl border border-[#424754]/40 bg-[#051424] shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:min-h-[calc(100vh-8rem)]">
          <div className="pointer-events-none absolute right-[-10rem] top-[-8rem] h-[34rem] w-[34rem] rounded-full bg-[#adc6ff]/10 blur-[120px]" />
          <div className="pointer-events-none absolute bottom-[-10rem] left-[20%] h-[24rem] w-[24rem] rounded-full bg-[#4d8eff]/5 blur-[100px]" />

          <div className="relative z-10 flex flex-1 flex-col px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
            <section className="mb-6 sm:mb-10">
              <div className="mb-6 flex flex-col gap-2">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[#8c909f]">{t("Playground")}</p>
                <h1 className="font-headline text-3xl font-bold tracking-tight text-[#d4e4fa] sm:text-4xl">{t("Engineered AI")}</h1>
              </div>

              <div className="mb-7 max-w-2xl">
                <div className="group relative rounded-full shadow-[0_0_15px_rgba(173,198,255,0.16)]">
                  <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[#8c909f] transition-colors group-focus-within:text-[#adc6ff]">search</span>
                  <input
                    type="text"
                    value={modelSearch}
                    onChange={(event) => setModelSearch(event.target.value)}
                    placeholder={t("Search across all models...")}
                    className="w-full rounded-full border border-[#424754]/50 bg-[#010f1f]/65 py-3 pl-12 pr-6 text-sm text-[#d4e4fa] backdrop-blur-sm placeholder:text-[#8c909f]/55 transition-all focus:border-[#adc6ff] focus:outline-none focus:ring-2 focus:ring-[#adc6ff]/20"
                  />
                </div>
              </div>

              <div className="hidden gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex">
                {providerGroups.map((group) => {
                  const active = (visibleActiveProviderGroup?.provider || selectedProvider) === group.provider;
                  const recommended = group.provider === RECOMMENDED_PROVIDER;
                  return (
                    <button
                      key={group.provider}
                      type="button"
                      onClick={() => {
                        setSelectedProvider(group.provider);
                        setSelectedModel(group.models[0]?.id || "");
                      }}
                      className={`flex flex-shrink-0 items-center gap-3 rounded-2xl border px-5 py-3 text-left backdrop-blur-xl transition-all duration-300 ${
                        active
                          ? recommended
                            ? "border-[#f5c97b] bg-[#f5c97b]/10 text-[#f8e3b8] shadow-[0_0_15px_rgba(245,201,123,0.22)]"
                            : "border-[#adc6ff] bg-[#adc6ff]/10 text-[#d4e4fa] shadow-[0_0_15px_rgba(173,198,255,0.2)]"
                          : recommended
                            ? "border-[#f5c97b]/40 bg-[#f5c97b]/[0.04] text-[#e9d3a3] hover:border-[#f5c97b]/70 hover:bg-[#f5c97b]/10 hover:text-[#f8e3b8]"
                            : "border-[#334155]/45 bg-[#0f172a]/40 text-[#c2c6d6] hover:border-[#adc6ff]/70 hover:bg-[#1c2b3c]/55 hover:text-[#d4e4fa]"
                      }`}
                    >
                      <span className={`material-symbols-outlined text-[21px] ${recommended ? "text-[#f5c97b]" : active ? "text-[#adc6ff]" : "text-[#c2c6d6]"}`} style={active || recommended ? { fontVariationSettings: "'FILL' 1" } : undefined}>
                        {getProviderIcon(group.provider)}
                      </span>
                      <span className="font-mono text-[12px] font-medium uppercase tracking-wider">{recommended ? t("Recommended") : group.provider}</span>
                      {active ? (
                        <span className={`material-symbols-outlined text-[18px] ${recommended ? "text-[#f5c97b]" : "text-[#adc6ff]"}`}>check_circle</span>
                      ) : (
                        <span className="rounded-full bg-[#273647]/70 px-2 py-0.5 text-[10px] text-[#8c909f]">{group.models.length}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2 sm:hidden">
                {providerGroups.map((group) => {
                  const active = (visibleActiveProviderGroup?.provider || selectedProvider) === group.provider;
                  const recommended = group.provider === RECOMMENDED_PROVIDER;
                  return (
                    <button
                      key={group.provider}
                      type="button"
                      onClick={() => {
                        setSelectedProvider(group.provider);
                        setSelectedModel(group.models[0]?.id || "");
                      }}
                      className={`flex flex-shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-medium uppercase tracking-wide backdrop-blur-xl transition-all duration-300 ${
                        active
                          ? recommended
                            ? "border-[#f5c97b] bg-[#f5c97b]/10 text-[#f8e3b8] shadow-[0_0_15px_rgba(245,201,123,0.22)]"
                            : "border-[#adc6ff] bg-[#adc6ff]/10 text-[#d4e4fa] shadow-[0_0_15px_rgba(173,198,255,0.2)]"
                          : recommended
                            ? "border-[#f5c97b]/40 bg-[#f5c97b]/[0.04] text-[#e9d3a3] hover:border-[#f5c97b]/70 hover:text-[#f8e3b8]"
                            : "border-[#334155]/45 bg-[#0f172a]/40 text-[#c2c6d6] hover:border-[#adc6ff]/70 hover:text-[#d4e4fa]"
                      }`}
                    >
                      <span className={`material-symbols-outlined text-[16px] ${recommended ? "text-[#f5c97b]" : active ? "text-[#adc6ff]" : "text-[#8c909f]"}`} style={active || recommended ? { fontVariationSettings: "'FILL' 1" } : undefined}>
                        {getProviderIcon(group.provider)}
                      </span>
                      <span className="font-mono">{recommended ? t("Recommended") : group.provider}</span>
                      {active ? (
                        <span className={`material-symbols-outlined text-[14px] ${recommended ? "text-[#f5c97b]" : "text-[#adc6ff]"}`}>check_circle</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="flex min-h-0 flex-1 flex-col pb-24">
              <div className="mb-7 flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-mono text-[12px] font-medium uppercase tracking-[0.18em] text-[#8c909f]">{t("Available Models")}</h2>
                  {visibleActiveProviderGroup ? (
                    <p className="mt-1 text-sm text-[#c2c6d6]/70">{visibleActiveProviderGroup.provider === RECOMMENDED_PROVIDER ? t("Recommended") : visibleActiveProviderGroup.provider} - {visibleActiveProviderGroup.models.length} {t("visible")}</p>
                  ) : null}
                </div>
                <div className="hidden gap-2 sm:flex">
                  <button
                    type="button"
                    onClick={() => setViewMode("grid")}
                    className={`rounded-lg border p-2 transition-all ${viewMode === "grid" ? "border-[#424754] bg-[#122131] text-[#adc6ff]" : "border-transparent text-[#8c909f] hover:text-[#c2c6d6]"}`}
                  >
                    <span className="material-symbols-outlined block text-[20px]">grid_view</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("list")}
                    className={`rounded-lg border p-2 transition-all ${viewMode === "list" ? "border-[#424754] bg-[#122131] text-[#adc6ff]" : "border-transparent text-[#8c909f] hover:text-[#c2c6d6]"}`}
                  >
                    <span className="material-symbols-outlined block text-[20px]">list</span>
                  </button>
                </div>
              </div>

              {loadingConfig ? (
                <div className="rounded-2xl border border-[#334155]/45 bg-[#0f172a]/40 p-8 text-sm text-[#c2c6d6] backdrop-blur-xl">{t("Loading models...")}</div>
              ) : visibleActiveProviderGroup ? (
                <div className={`grid gap-4 ${viewMode === "grid" ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" : "grid-cols-1"}`}>
                  {visibleActiveProviderGroup.models.map((model) => {
                    const active = (visibleSelectedModelOption?.id || selectedModel) === model.id;
                    const recommendedActive = visibleActiveProviderGroup.provider === RECOMMENDED_PROVIDER;
                    const minimumCost = getChatModelMinimumCost(model);
                    const affordable = currentCredits === null || currentCredits >= minimumCost;
                    const featureLabels = getModelFeatureLabels(model);
                    return (
                      <button
                        key={model.id}
                        type="button"
                        disabled={!affordable}
                        onClick={() => {
                          if (!affordable) return;
                          setSelectedProvider(visibleActiveProviderGroup.provider);
                          setSelectedModel(model.id);
                        }}
                        className={`group flex min-h-[136px] flex-col rounded-xl border p-4 text-left backdrop-blur-xl transition-all duration-300 ${
                          !affordable
                            ? "cursor-not-allowed border-[#334155]/30 bg-[#0f172a]/25 opacity-55"
                            : active
                            ? recommendedActive
                              ? "border-[#f5c97b]/70 bg-[#f5c97b]/10 shadow-[0_0_20px_rgba(245,201,123,0.16)]"
                              : "border-[#adc6ff]/70 bg-[#adc6ff]/10 shadow-[0_0_20px_rgba(173,198,255,0.14)]"
                            : recommendedActive
                            ? "border-[#f5c97b]/25 bg-[#0f172a]/40 hover:border-[#f5c97b] hover:bg-[#241d10]/50 hover:shadow-[0_0_20px_rgba(245,201,123,0.12)]"
                            : "border-[#334155]/45 bg-[#0f172a]/40 hover:border-[#adc6ff] hover:bg-[#1c2b3c]/50 hover:shadow-[0_0_20px_rgba(173,198,255,0.1)]"
                        }`}
                      >
                        <div className="mb-2 flex items-start justify-between gap-3">
                          <h3 className={`font-mono text-[13px] font-medium uppercase tracking-[0.04em] text-[#d4e4fa] transition-colors ${recommendedActive ? "group-hover:text-[#f5c97b]" : "group-hover:text-[#adc6ff]"}`}>{model.displayName}</h3>
                          {active ? (
                            <span className={`material-symbols-outlined text-[20px] ${recommendedActive ? "text-[#f5c97b]" : "text-[#adc6ff]"}`} style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                          ) : null}
                        </div>

                        <p className="mb-3 line-clamp-2 flex-1 text-[13px] leading-5 text-[#c2c6d6]/80">{getModelDescription(model.id, language) || t("Usage-based conversational model for playground.")}</p>

                        {!affordable ? (
                          <p className="mb-3 text-[11px] font-medium text-[#ffb4ab]">{t("Need at least")} {minimumCost.toFixed(2)} {t("credits.")}</p>
                        ) : null}

                        <div className="mt-auto flex flex-wrap gap-2">
                          {featureLabels.map((label) => (
                            <span key={label} className="rounded-full border border-[#424754]/70 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-[#8c909f]">
                              {t(label)}
                            </span>
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-[#334155]/45 bg-[#0f172a]/40 p-8 text-sm text-[#c2c6d6] backdrop-blur-xl">{t("No models available for the current search.")}</div>
              )}
            </section>
          </div>

          <footer className="sticky bottom-0 z-20 border-t border-[#424754]/35 bg-[#051424]/85 backdrop-blur-md">
            <div className="flex flex-col justify-between gap-4 px-4 py-4 sm:flex-row sm:items-center sm:px-6 lg:px-8">
              <Link href="/studio/start" className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[#c2c6d6] transition-colors hover:text-[#d4e4fa]">
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                {t("Provider")}
              </Link>
              <button
                type="button"
                onClick={() => void handleStartChat()}
                disabled={!visibleSelectedModelOption || loadingConfig || loadingReply || insufficientSelectedModelCredits}
                className="group flex w-full items-center justify-center gap-2 rounded-xl bg-[#adc6ff] px-6 py-3 font-mono text-[13px] font-medium uppercase tracking-[0.05em] text-[#002e6a] shadow-[0_0_24px_rgba(173,198,255,0.2)] transition-all hover:scale-[1.02] hover:bg-[#adc6ff]/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                <span>{loadingReply ? t("Starting...") : insufficientSelectedModelCredits ? `${t("Need")} ${selectedModelMinimumCost.toFixed(2)} ${t("Credits")}` : t("Continue")}</span>
                <span className="material-symbols-outlined text-[18px] transition-transform group-hover:translate-x-1">arrow_forward</span>
              </button>
            </div>
          </footer>
        </div>
      ) : (
        <div className="chat-canvas flex h-full flex-col overflow-hidden">
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
              <Link href="/studio/start" title={t("Back to Choice")} className="chat-topbar-btn">
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              </Link>

              <div className="mx-0.5 h-4 w-px bg-white/[0.06]" />

              <div className="chat-credits-badge">
                <span className="material-symbols-outlined text-[13px] text-[#adc6ff]" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
                <span className="text-[11px] font-bold tabular-nums text-blue-100/80">{currentCredits === null ? "..." : currentCredits.toFixed(2)}</span>
              </div>

              <button type="button" onClick={() => setSettingsPanelOpen((prev) => !prev)} className={`chat-topbar-btn ${settingsPanelOpen ? "!text-[#adc6ff] bg-white/[0.04]" : ""}`} title={t("Model Settings")}>
                <span className="material-symbols-outlined text-[18px]">tune</span>
              </button>
            </div>
          </header>

          <div className="flex items-center justify-center gap-4 border-b border-white/[0.04] bg-[#0a0f1e]/60 px-4 py-1.5 text-[11px] text-[#6b7a8f] lg:hidden">
            <span className="tabular-nums">{conversationTotalTokens.toLocaleString()} {t("tokens")}</span>
            <span className="text-white/10">.</span>
            <span className="tabular-nums text-[#adc6ff]/60">{conversationCostTotal.toFixed(2)} Cr</span>
          </div>

          <div className="relative z-10 flex flex-1 overflow-hidden">
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="chat-messages-scroll flex-1 overflow-y-auto">
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
                    <div className="flex min-h-[55vh] flex-col items-center justify-center">
                      <div className="chat-empty-icon relative flex h-20 w-20 items-center justify-center rounded-3xl border border-white/[0.06] bg-white/[0.025]">
                        <span className="material-symbols-outlined text-4xl text-[#adc6ff]/40" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
                        <div className="chat-empty-icon-glow" />
                      </div>
                      <h2 className="mt-6 text-xl font-semibold tracking-[-0.01em] text-white/90">
                        {lockedModelIsOneShotImage ? t("One-shot image generation") : t("What will you create?")}
                      </h2>
                      <p className="mt-2.5 max-w-[360px] text-center text-[13px] leading-relaxed text-[#5a6580]">
                        {lockedModelIsOneShotImage
                          ? `${lockedModel?.displayName || t("This model")} ${t("generates an image directly from your prompt. It does not use chat memory, so write the full image request in one message.")}`
                          : `${t("Ask a question, describe an image, or start a brainstorming session with")} ${lockedModel?.displayName || t("your model")}.`}
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-6 pb-4">
                      {messages.map((message, idx) => (
                        <div
                          key={message.id}
                          className={`chat-message-in flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                          style={{ animationDelay: `${Math.min(idx * 40, 250)}ms` }}
                        >
                          <div className={`group relative max-w-[88%] sm:max-w-[78%] ${message.role === "user" ? "chat-msg-user" : "chat-msg-assistant"}`}>
                            <div className={`chat-msg-label flex items-center gap-2 ${message.role === "user" ? "justify-end text-[#adc6ff]/45" : "text-white/25"}`}>
                              {message.role === "user" ? displayName : lockedModel?.displayName || t("Assistant")}
                            </div>
                            {message.role === "user" ? <UserMessageContent message={message} /> : <AssistantMessageContent message={message} />}
                          </div>
                        </div>
                      ))}

                      {loadingReply ? (
                        <div className="chat-message-in flex justify-start">
                          <div className="chat-msg-assistant">
                            <div className="chat-msg-label text-white/25">
                              {lockedModel?.displayName || t("Assistant")}
                            </div>
                            <div className="flex items-center gap-2 py-1">
                              <div className="chat-typing-dot" />
                              <div className="chat-typing-dot" />
                              <div className="chat-typing-dot" />
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              <div className="shrink-0 px-2.5 pb-3 pt-2 sm:px-5 sm:pb-5">
                <div className="mx-auto max-w-4xl">
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
                      <div className="flex shrink-0 flex-nowrap items-center gap-1.5">
                        {inputImages.map((image) => (
                          <div key={image.localId} className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg ring-1 ring-white/10">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={image.previewUrl} alt={image.name} className="h-full w-full object-cover" />
                            {image.uploading ? (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                              </div>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => removeAttachedImage(image.localId)}
                              className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black/70 text-[9px] text-white"
                            >
                              ×
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
                          void handleSend();
                        }
                      }}
                      placeholder={lockedModel?.supportsImageInput ? t("Ask anything, or drop an image...") : t("Ask anything...")}
                      rows={1}
                      className="w-full resize-none bg-transparent text-[14px] leading-relaxed text-white/90 outline-none placeholder:text-white/20"
                    />

                    <div className="mt-3 flex items-center justify-between border-t border-white/[0.04] pt-3">
                      <div className="flex items-center gap-2.5">
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
                        <span className={`text-[11px] tabular-nums text-white/12 transition-colors ${remainingChars < 400 ? "!text-red-400/50" : ""} ${input.length > 0 ? "!text-white/20" : ""}`}>
                          {input.length > 0 ? `${input.length.toLocaleString()} / ${MAX_CHAT_TEXT_CHARS.toLocaleString()}` : ""}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleSend()}
                        disabled={
                          (!input.trim() && inputImages.length === 0) ||
                          input.trim().length > MAX_CHAT_TEXT_CHARS ||
                          !lockedModelId ||
                          loadingReply ||
                          uploadingImage ||
                          loadingConversation
                        }
                        className="chat-send-btn"
                      >
                        <span>{uploadingImage ? t("Uploading...") : t("Send")}</span>
                        <span className="material-symbols-outlined text-[15px]">arrow_upward</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {settingsPanelOpen ? (
              <>
                <div className="chat-panel-backdrop fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px] lg:hidden" onClick={() => setSettingsPanelOpen(false)} />
                <aside className="chat-panel-slide fixed bottom-0 right-0 top-0 z-50 flex w-[56vw] min-w-[210px] max-w-[280px] flex-col border-l border-white/[0.05] bg-[#080c1a]/95 backdrop-blur-2xl sm:w-72 lg:relative lg:bottom-auto lg:top-auto lg:z-auto lg:w-[280px]">
                  <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] px-4">
                    <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/35">{t("Model Controls")}</span>
                    <div className="flex items-center gap-1">
                      {lockedModelParameters.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (!lockedModel) return;
                            setParameterValues(createParameterState(lockedModel.parameterSchema));
                          }}
                          className="text-[10px] font-bold uppercase tracking-wider text-[#adc6ff]/60 transition-colors hover:text-[#adc6ff]"
                        >
                          {t("Reset")}
                        </button>
                      ) : null}
                      <button type="button" onClick={() => setSettingsPanelOpen(false)} className="chat-topbar-btn !h-7 !w-7">
                        <span className="material-symbols-outlined text-[16px]">close</span>
                      </button>
                    </div>
                  </div>

                  <div className="chat-messages-scroll flex-1 space-y-4 overflow-y-auto px-4 py-5">
                    {lockedModelParameters.length > 0 ? (
                      lockedModelParameters.map(([key, entry]) => {
                        const pricingHint = getChatParamPricingHint(lockedModel, key);
                        return (
                          <div key={key} className="chat-settings-group space-y-3">
                            <div className="flex items-center justify-between gap-2">
                              <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/35">
                                <span>{toParameterLabel(key)}</span>
                                {pricingHint ? (
                                  <span className="group relative inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-white/8 text-[9px] font-bold normal-case tracking-normal text-[#adc6ff]/50">
                                    ?
                                    <span className="pointer-events-none absolute left-4 top-full z-20 mt-3 hidden w-max max-w-[200px] whitespace-pre-line rounded-xl border border-white/8 bg-[#0a0f1e] px-3 py-2.5 text-[11px] font-medium normal-case leading-5 tracking-normal text-white/75 shadow-2xl group-hover:block">
                                      {pricingHint}
                                    </span>
                                  </span>
                                ) : null}
                              </label>
                            </div>
                            {renderParameterControl(key, entry)}
                          </div>
                        );
                      })
                    ) : (
                      <div className="chat-settings-group text-center text-[13px] leading-relaxed text-[#5a6580]">
                        <span className="material-symbols-outlined mb-2 block text-xl text-white/15">settings_suggest</span>
                        {t("No editable parameters for this model.")}
                      </div>
                    )}
                  </div>
                </aside>
              </>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
