"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useAuth } from "../../../context/AuthContext";
import InteractiveAuthenticatedImage from "../../../components/InteractiveAuthenticatedImage";
import { api } from "../../../services/api";
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
  fileId: string;
  name: string;
  mimeType: string;
  url: string;
  previewUrl: string;
  size: number;
  originalSize: number;
}

interface ChatModelOption {
  id: string;
  displayName: string;
  description?: string;
  provider: string;
  supportsImageInput: boolean;
  parameterSchema: Record<string, PlainChatParameterSchemaEntry>;
  pricing?: ModelPricingSummary;
}

interface ProviderGroup {
  provider: string;
  models: ChatModelOption[];
}

const STORAGE_KEY = "studio-simple-chat-v2";
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_PROXY_IMAGE_DIMENSION = 1536;
const MAX_PROXY_IMAGE_BYTES = 1_800_000;
const MAX_CHAT_TEXT_CHARS = 4000;
const DEFAULT_CONVERSATION_TITLE = "New Chat";
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
  sampleImageSize: "sampleImageSize",
  aspectRatio: "aspectRatio",
  sampleCount: "sampleCount",
  seed: "seed",
  addWatermark: "addWatermark",
  enhancePrompt: "enhancePrompt",
  outputMimeType: "outputMimeType",
} as const;

type ParameterValue = string | number | boolean;
type ParameterState = Record<string, ParameterValue>;

function normalizeConversationTitle(value?: string | null): string {
  const normalized = (value || "").trim();
  return normalized || DEFAULT_CONVERSATION_TITLE;
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
  const imageParts = (message.parts || []).filter((part) => part.type === "image_url" && typeof part.url === "string" && part.url.trim());

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
  const imageParts = (message.parts || []).filter((part) => part.type === "image_url" && typeof part.url === "string" && part.url.trim());

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
              imageClassName="max-h-56 w-auto object-cover shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
              loadingClassName="flex min-h-40 min-w-40 items-center justify-center rounded-xl border border-black/10 bg-black/5 px-4 py-6 text-xs text-black/60"
              errorClassName="flex min-h-40 min-w-40 items-center justify-center rounded-xl border border-black/10 bg-black/5 px-4 py-6 text-xs text-black/60"
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
    parameterSchema: model.parameterSchema || {},
    pricing: model.pricing,
  };
}

function getChatParamPricingHint(model: ChatModelOption | null, key: string) {
  const expected = model?.pricing?.expected;
  if (!expected || typeof expected !== "object") return null;

  let priceMap: Record<string, number> | undefined;
  if (key === "imageSize" && expected.imageSizePrices && typeof expected.imageSizePrices === "object") {
    priceMap = expected.imageSizePrices;
  } else if (key === "sampleImageSize" && expected.sampleImageSizePrices && typeof expected.sampleImageSizePrices === "object") {
    priceMap = expected.sampleImageSizePrices;
  }

  if (!priceMap || Object.keys(priceMap).length === 0) return null;

  return Object.entries(priceMap)
    .map(([label, value]) => `${label}: ${Number(value).toFixed(2)} credits`)
    .join("\n");
}

function toParameterLabel(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
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

function getDefaultParameterValue(entry: PlainChatParameterSchemaEntry): ParameterValue | null {
  if (entry.key === "imageSize" || entry.key === "sampleImageSize") {
    const enumValues = Array.isArray(entry.values) ? entry.values.map((value) => String(value).trim().toUpperCase()) : [];
    if (enumValues.includes("1K")) {
      return "1K";
    }
  }
  if (entry.recommendedDefault !== undefined) {
    return entry.recommendedDefault;
  }
  if (entry.value !== undefined) return entry.value;
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

function getVisibleChatParameters(schema: Record<string, PlainChatParameterSchemaEntry>) {
  return Object.entries(schema)
    .filter(([key, entry]) => key !== "modelId" && typeof entry === "object" && entry !== null && isRenderableParameterEntry(entry))
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
    const defaultValue = getDefaultParameterValue(entry);
    if (defaultValue !== null) {
      acc[key] = defaultValue;
    }
    return acc;
  }, {});
}

function buildChatOptionsFromParameters(values: ParameterState): Record<string, number | string | boolean> {
  const options: Record<string, number | string | boolean> = {};

  for (const [schemaKey, optionKey] of Object.entries(CHAT_PARAMETER_KEY_MAP)) {
    const value = values[schemaKey];
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
    if (!context) return file;
    context.drawImage(image, 0, 0, width, height);

    const shouldReencode = scale < 1 || file.size > MAX_PROXY_IMAGE_BYTES || file.type === "image/png";
    if (!shouldReencode) return file;

    const outputType = file.type === "image/png" ? "image/webp" : file.type;
    let quality = outputType === "image/webp" ? 0.86 : 0.82;
    let blob = await canvasToBlob(canvas, outputType, quality);

    while (blob.size > MAX_PROXY_IMAGE_BYTES && quality && quality > 0.5) {
      quality -= 0.08;
      blob = await canvasToBlob(canvas, outputType, quality);
    }

    if (blob.size >= file.size) return file;

    const nextName = file.name.replace(/\.(png|jpg|jpeg|webp)$/i, outputType === "image/webp" ? ".webp" : "$&");
    return new File([blob], nextName, { type: outputType });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function StudioChatPage() {
  const { user, loading: authLoading } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [phase, setPhase] = useState<ChatPhase>("select");
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
  const [inputImage, setInputImage] = useState<UploadedImageState | null>(null);
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

  useEffect(() => {
    const forceNewSession = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1";
    const requestedConversationId =
      typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("conversation") : null;

    if (forceNewSession) {
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
      setInputImage(null);
      setError(null);
      setConversationPromptTokens(0);
      setConversationCompletionTokens(0);
      setConversationCostTotal(0);
      setLastUsage(null);
      setLastBillingMeta(null);
      return;
    }

    if (requestedConversationId) {
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
      setInputImage(null);
      setError(null);
      setConversationPromptTokens(0);
      setConversationCompletionTokens(0);
      setConversationCostTotal(0);
      setLastUsage(null);
      setLastBillingMeta(null);
      return;
    }

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
  }, []);

  useEffect(() => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ phase, messages, selectedProvider, selectedModel, lockedModelId, conversationId, conversationTitle, parameterValues }),
    );
  }, [phase, messages, selectedProvider, selectedModel, lockedModelId, conversationId, conversationTitle, parameterValues]);

  useEffect(() => {
    if (typeof window === "undefined" || !conversationId) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("new");
    url.searchParams.set("conversation", conversationId);
    window.history.replaceState({}, "", url.toString());
  }, [conversationId]);

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

        const nextGroups = Object.entries(grouped)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([provider, models]) => ({
            provider,
            models: models.sort((a, b) => a.displayName.localeCompare(b.displayName)),
          }));

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
          setError("Could not load chat models.");
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
  }, [authLoading, lockedModelId, selectedModel, selectedProvider, user]);

  useEffect(() => {
    let cancelled = false;

    async function loadConversation() {
      if (!user || phase !== "chat" || !conversationId) return;

      try {
        setLoadingConversation(true);
        const response = await api.getPlainChatConversationMessages(conversationId, 100);
        if (cancelled) return;
        setMessages(
          response.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: formatMessageParts(message.parts),
            createdAt: message.createdAt,
            parts: message.parts,
          })),
        );
        setLockedModelId(response.conversation.model || lockedModelId);
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
        setError(err instanceof Error ? err.message : "Could not load chat history.");
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
  }, [conversationId, lockedModelId, phase, user]);

  useEffect(() => {
    return () => {
      if (inputImage?.previewUrl) {
        URL.revokeObjectURL(inputImage.previewUrl);
      }
    };
  }, [inputImage]);

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
            const haystack = `${model.displayName} ${model.description || ""}`.toLowerCase();
            if (!haystack.includes(modelQuery)) return false;
          }
          return providerMatches;
        });
        return { ...group, models };
      })
      .filter((group) => group.models.length > 0);
  }, [modelSearch, providerGroups, providerSearch]);

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

  async function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const originalFile = event.target.files?.[0];
    if (!originalFile) return;

    if (!["image/png", "image/jpeg", "image/webp"].includes(originalFile.type)) {
      setError("Only PNG, JPEG, and WEBP images are supported.");
      event.target.value = "";
      return;
    }

    if (originalFile.size > MAX_UPLOAD_BYTES) {
      setError("Image must be 10 MB or smaller.");
      event.target.value = "";
      return;
    }

    try {
      setUploadingImage(true);
      setError(null);
      const file = await normalizeUploadImage(originalFile);
      const uploaded: UploadedImageResult = await api.uploadInputImage(file);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload image.");
    } finally {
      setUploadingImage(false);
      event.target.value = "";
    }
  }

  async function handleStartChat() {
    if (!selectedModel || !user) return;

    try {
      setLoadingReply(true);
      setError(null);
      const conversation = await api.createPlainChatConversation({ model: selectedModel });
      setLockedModelId(selectedModel);
      setConversationId(conversation.id);
      setConversationTitle(normalizeConversationTitle(conversation.title));
      setConversationTitleDraft(normalizeConversationTitle(conversation.title));
      setEditingConversationTitle(false);
      setConversationPromptTokens(conversation.promptTokensTotal || 0);
      setConversationCompletionTokens(conversation.completionTokensTotal || 0);
      setConversationCostTotal(conversation.totalCostCredits || 0);
      setLastUsage(null);
      setLastBillingMeta(null);
      setPhase("chat");
      setMessages([]);
      setInput("");
      setInputImage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a chat.");
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
    if ((!text && !inputImage) || !lockedModelId || !conversationId || loadingReply || !user) return;

    const attachedImage = inputImage;
    const parts: PlainChatPart[] = [];
    if (text) {
      parts.push({ type: "text", text });
    }
    if (lockedModel?.supportsImageInput && attachedImage) {
      parts.push({ type: "image_url", url: attachedImage.url });
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
    setInputImage(null);
    setLoadingReply(true);
    setError(null);

    try {
      const response = await api.sendPlainChatConversationMessage(conversationId, {
        parts,
        options: buildChatOptionsFromParameters(parameterValues),
      });

      if (response.status !== "success" || !response.userMessage || !response.assistantMessage) {
        throw new Error(typeof response.meta?.error_message === "string" ? response.meta.error_message : "The chat model did not return a reply.");
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
      if (attachedImage?.previewUrl) {
        URL.revokeObjectURL(attachedImage.previewUrl);
      }
    } catch (err) {
      setMessages((current) => current.slice(0, -1));
      setInputImage(attachedImage);
      setError(err instanceof Error ? err.message : "Could not get a reply.");
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
              Reset
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
              This model does not expose editable chat parameters yet.
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
      const conversation = await api.createPlainChatConversation({ model: lockedModelId });
      setConversationId(conversation.id);
      setConversationTitle(normalizeConversationTitle(conversation.title));
      setConversationTitleDraft(normalizeConversationTitle(conversation.title));
      setEditingConversationTitle(false);
      setConversationPromptTokens(conversation.promptTokensTotal || 0);
      setConversationCompletionTokens(conversation.completionTokensTotal || 0);
      setConversationCostTotal(conversation.totalCostCredits || 0);
      setLastUsage(null);
      setLastBillingMeta(null);
      setMessages([]);
      setInput("");
      setInputImage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a new chat.");
    } finally {
      setLoadingReply(false);
    }
  }

  async function handleDeleteConversation() {
    if (!conversationId) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this conversation? This action cannot be undone.")) {
      return;
    }

    try {
      setLoadingReply(true);
      setError(null);
      await api.deletePlainChatConversation(conversationId);
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
      setInputImage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this chat.");
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
      setError(err instanceof Error ? err.message : "Could not rename this chat.");
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
          {entry.values.map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
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
          <span>{Boolean(value) ? "Enabled" : "Disabled"}</span>
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
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[#2b3347]"
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

    return (
      <div className="rounded-md border border-white/10 bg-[#101728] px-3 py-2 text-sm text-[#8c909f]">
        Unsupported parameter type.
      </div>
    );
  }

  return (
    <section className="min-h-[calc(100vh-4rem)] overflow-x-hidden px-6 py-8 lg:px-10">
      {phase === "select" ? (
        <div className="relative mx-auto flex min-h-[calc(100vh-8rem)] max-w-7xl flex-col overflow-hidden rounded-[1.5rem] border border-white/8 bg-[#0c1324] shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
          <div className="pointer-events-none absolute right-[-8rem] top-16 h-[26rem] w-[26rem] rounded-full bg-[#adc6ff]/5 blur-[120px]" />
          <div className="pointer-events-none absolute bottom-0 left-[18%] h-[18rem] w-[18rem] rounded-full bg-[#d0bcff]/5 blur-[100px]" />

          <div className="flex flex-1 overflow-hidden">
            <aside className="hidden w-72 flex-shrink-0 border-r border-white/6 bg-slate-900/35 px-4 py-8 backdrop-blur-xl lg:flex lg:flex-col">
              <div className="mb-10 px-2">
                <h1 className="bg-gradient-to-br from-blue-200 to-blue-500 bg-clip-text font-headline text-xl font-bold text-transparent">
                  Engineered AI
                </h1>
                <p className="mt-1 font-headline text-[10px] uppercase tracking-widest text-on-surface opacity-60">
                  Provider Selection
                </p>
              </div>

              <div className="mb-6 px-2 text-on-surface-variant transition-colors focus-within:text-primary">
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-lg opacity-50">search</span>
                  <input
                    type="text"
                    value={providerSearch}
                    onChange={(event) => setProviderSearch(event.target.value)}
                    placeholder="Search providers..."
                    className="w-full rounded-xl border border-outline-variant/20 bg-[#0a0d1a] py-2.5 pl-10 pr-4 text-sm placeholder:text-slate-600 focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                </div>
              </div>

              <nav className="flex-1 space-y-2">
                {visibleProviderGroups.map((group) => {
                  const active = (visibleActiveProviderGroup?.provider || selectedProvider) === group.provider;
                  return (
                    <button
                      key={group.provider}
                      type="button"
                      onClick={() => {
                        setSelectedProvider(group.provider);
                        setSelectedModel(group.models[0]?.id || "");
                      }}
                      className={`group flex w-full scale-[0.99] items-center justify-between rounded-xl px-4 py-3 text-left transition-all duration-300 active:scale-95 ${
                        active
                          ? "border-r-2 border-blue-500 bg-blue-500/5 font-bold text-blue-400"
                          : "font-medium text-slate-500 hover:bg-slate-800/60 hover:text-slate-300"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-xl">{getProviderIcon(group.provider)}</span>
                        <span className="font-headline text-sm uppercase tracking-widest">{group.provider}</span>
                      </div>
                      <span className={`text-[10px] ${active ? "opacity-80" : "opacity-40 group-hover:opacity-100"}`}>
                        {group.models.length} models
                      </span>
                    </button>
                  );
                })}
              </nav>

              <div className="mt-auto" />
            </aside>

            <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
              <header className="flex flex-col justify-between gap-4 px-8 pb-6 pt-10 xl:flex-row xl:items-baseline xl:px-12 xl:pt-12">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
                    <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface xl:text-3xl">
                      {visibleActiveProviderGroup?.provider || selectedProvider || "Select a Provider"}
                    </h2>
                    <div className="relative min-w-[280px] max-w-md xl:ml-6">
                      <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-lg text-slate-500 transition-colors group-focus-within:text-primary">
                        search
                      </span>
                      <input
                        type="text"
                        value={modelSearch}
                        onChange={(event) => setModelSearch(event.target.value)}
                        placeholder="Search models..."
                        className="w-full rounded-full border border-outline-variant/20 bg-[#0a0d1a] py-2 pl-12 pr-6 text-sm placeholder:text-slate-600 focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/40"
                      />
                    </div>
                  </div>
                </div>
                <div />
              </header>

              <section className="max-w-5xl px-8 pb-28 xl:px-12">
                <div className="flex flex-col gap-[10px]">
                  {loadingConfig ? (
                    <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-8 text-sm text-on-surface-variant">
                      Loading models…
                    </div>
                  ) : visibleActiveProviderGroup ? (
                    visibleActiveProviderGroup.models.map((model) => {
                      const active = (visibleSelectedModelOption?.id || selectedModel) === model.id;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => {
                            setSelectedProvider(visibleActiveProviderGroup.provider);
                            setSelectedModel(model.id);
                          }}
                          className={`group relative w-full cursor-pointer rounded-md border bg-[#16192a] px-5 py-4 text-left transition-colors duration-200 ${
                            active
                              ? "border-[rgba(255,255,255,0.18)]"
                              : "border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.12)] hover:bg-[#1a1d27]"
                          }`}
                        >
                          <div className="relative flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="mb-1.5 flex items-center gap-2">
                                <h3 className="text-[15px] font-semibold text-[#f3f5ff]">
                                  {model.displayName}
                                </h3>
                              </div>
                              <p className="mb-3 max-w-xl text-[13px] font-normal leading-5 text-[#8b8fa8]">
                                {model.description || "Usage-based conversational model for plain chat."}
                              </p>
                              <div className="flex flex-wrap gap-2">
                                <span className="rounded-full border border-[rgba(255,255,255,0.15)] bg-transparent px-3 py-1 text-[10px] font-medium uppercase tracking-[0.05em] text-[#8b8fa8]">
                                  {model.provider}
                                </span>
                                {model.supportsImageInput ? (
                                  <span className="rounded-full border border-[rgba(255,255,255,0.15)] bg-transparent px-3 py-1 text-[10px] font-medium uppercase tracking-[0.05em] text-[#8b8fa8]">
                                    Multimodal
                                  </span>
                                ) : (
                                  <span className="rounded-full border border-[rgba(255,255,255,0.15)] bg-transparent px-3 py-1 text-[10px] font-medium uppercase tracking-[0.05em] text-[#8b8fa8]">
                                    Text
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-4">
                              <span className="rounded-full bg-[#202433] px-2.5 py-1 text-[10px] font-medium text-[#8b8fa8]">
                                Usage-Based
                              </span>
                              {active ? (
                                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#eef2ff] text-[#0f1117]">
                                  <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                                    check
                                  </span>
                                </div>
                              ) : (
                                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-[rgba(255,255,255,0.12)] text-[#747b93]">
                                  <span className="material-symbols-outlined text-[18px]">check</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-8 text-sm text-on-surface-variant">
                      No models available for the current search.
                    </div>
                  )}
                </div>
              </section>

              <footer className="sticky bottom-0 flex flex-col justify-between gap-4 border-t border-outline-variant/10 bg-slate-950/80 px-8 py-6 backdrop-blur-md xl:flex-row xl:items-center xl:px-12">
                <div className="flex items-center gap-6">
                  <Link
                    href="/studio/start"
                    className="group flex items-center gap-2 opacity-80 transition-all duration-300 hover:opacity-100"
                  >
                    <span className="material-symbols-outlined text-sm">arrow_back</span>
                    <span className="text-xs font-medium text-slate-400 group-hover:text-blue-300">Back to Choice</span>
                  </Link>
                </div>
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:gap-6">
                  <div className="flex items-center gap-6">
                    <span className="cursor-default text-[13px] font-normal text-[rgba(255,255,255,0.35)]">
                      Documentation
                    </span>
                    <span className="cursor-default text-[13px] font-normal text-[rgba(255,255,255,0.35)]">
                      System Status
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleStartChat()}
                    disabled={!visibleSelectedModelOption || loadingConfig || loadingReply}
                    className="flex items-center gap-2 rounded-[5px] bg-gradient-to-br from-[#adc6ff] to-[#4d8eff] px-8 py-3 font-headline text-sm font-bold text-[#002e6a] shadow-[0_0_24px_rgba(77,142,255,0.18)] transition-all duration-300 hover:scale-105 hover:shadow-[0_0_32px_rgba(77,142,255,0.28)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span>{loadingReply ? "Starting…" : "Next Step"}</span>
                    <span className="material-symbols-outlined text-sm">chevron_right</span>
                  </button>
                </div>
              </footer>
            </main>
          </div>
        </div>
      ) : (
        <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-6 px-4 pb-12 pt-24 sm:px-6 xl:px-8">
          <header className="fixed left-0 right-0 top-0 z-40 border-b border-white/10 bg-[#0c1324]/90 backdrop-blur-xl md:left-48">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 xl:px-8">
              <div className="flex min-w-0 items-center gap-4">
                <div className="min-w-0">
                  {editingConversationTitle ? (
                    <div className="flex min-w-0 items-center gap-2">
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
                        className="min-w-0 rounded-md border border-white/15 bg-[#151b2d] px-3 py-1.5 font-headline text-base font-bold tracking-tight text-white outline-none focus:border-[#adc6ff]/40 sm:text-lg"
                      />
                      <button
                        type="button"
                        onClick={() => void handleSaveConversationTitle()}
                        className="rounded-md border border-white/15 px-2.5 py-1.5 text-[11px] font-semibold text-[#adc6ff] transition-colors hover:bg-white/5"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <div className="flex min-w-0 items-center gap-2">
                      <h1 className="truncate font-headline text-base font-bold tracking-tight text-white sm:text-lg">
                        {displayConversationTitle}
                      </h1>
                      <button
                        type="button"
                        onClick={() => {
                          setConversationTitleDraft(normalizedConversationTitle);
                          setEditingConversationTitle(true);
                        }}
                        className="rounded-md border border-white/10 p-1 text-[#c2c6d6] transition-colors hover:bg-white/5 hover:text-white"
                        aria-label="Rename chat"
                      >
                        <span className="material-symbols-outlined text-sm">edit</span>
                      </button>
                    </div>
                  )}
                  <div className="mt-1 text-xs text-[#8c909f]">{lockedModel?.displayName || "Selected model"}</div>
                </div>
                <div className="hidden h-8 w-px bg-white/10 lg:block" />
                <div className="hidden flex-wrap items-start gap-4 lg:flex">
                  <div className="min-w-[140px]">
                    <span className="block text-[10px] uppercase tracking-[0.14em] text-[#c2c6d6]">Total tokens used</span>
                    <span className="mt-1 block text-sm font-semibold text-white">
                      {conversationTotalTokens.toLocaleString()}
                    </span>
                  </div>
                  <div className="min-w-[150px]">
                    <span className="block text-[10px] uppercase tracking-[0.14em] text-[#c2c6d6]">Cost of conversation</span>
                    <span className="mt-1 block text-sm font-semibold text-[#adc6ff]">
                      {`${conversationCostTotal.toFixed(2)} Cr`}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => void handleNewChat()}
                  className="rounded-md border border-white/15 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#2e3447]/50 sm:text-sm"
                >
                  New Chat
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteConversation()}
                  disabled={!conversationId || loadingReply}
                  className="rounded-md border border-[#5b2028] px-4 py-2 text-xs font-medium text-[#ffb4ab] transition-colors hover:bg-[#5b2028]/20 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
                >
                  Delete Chat
                </button>
                <Link
                  href="/studio/start"
                  className="rounded-md border border-white/15 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#2e3447]/50 sm:text-sm"
                >
                  Back to Choice
                </Link>
                <div className="flex items-center gap-2 rounded-full border border-white/5 bg-[#23293c] px-3 py-1.5">
                  <span className="material-symbols-outlined text-sm text-[#adc6ff]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    bolt
                  </span>
                  <span className="text-xs font-bold text-blue-100 sm:text-sm">
                    {currentCredits === null ? "..." : `${currentCredits.toFixed(2)} Credits`}
                  </span>
                </div>
              </div>

              <div className="flex w-full flex-wrap items-start gap-4 lg:hidden">
                <div className="min-w-[140px]">
                  <span className="block text-[10px] uppercase tracking-[0.14em] text-[#c2c6d6]">Total tokens used</span>
                  <span className="mt-1 block text-sm font-semibold text-white">
                    {conversationTotalTokens.toLocaleString()}
                  </span>
                </div>
                <div className="min-w-[150px]">
                  <span className="block text-[10px] uppercase tracking-[0.14em] text-[#c2c6d6]">Cost of conversation</span>
                  <span className="mt-1 block text-sm font-semibold text-[#adc6ff]">
                    {`${conversationCostTotal.toFixed(2)} Cr`}
                  </span>
                </div>
              </div>
            </div>
          </header>

          <div className="lg:hidden">{renderModelParamsPanel(true)}</div>

          <aside className="fixed bottom-0 top-16 right-0 hidden w-[224px] lg:block">
            {renderModelParamsPanel(false)}
          </aside>

          <div className="lg:pr-[248px]">
            <section className="flex min-w-0 flex-col gap-6 pb-[240px]">
              <div className="relative flex flex-col overflow-hidden rounded-xl border border-[rgba(173,198,255,0.1)] bg-[rgba(25,31,49,0.7)] p-8 backdrop-blur-[16px]">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#adc6ff]/5 to-transparent" />

                <div className="relative p-6">
                  {loadingConversation ? (
                    <div className="flex h-full items-center justify-center">
                      <div className="max-w-xl text-center text-sm text-[#8c909f]">Loading conversation…</div>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex h-full items-center justify-center">
                      <div className="max-w-sm space-y-4 text-center">
                        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-[#2e3447]">
                          <span className="material-symbols-outlined text-3xl text-[#adc6ff]">chat_bubble</span>
                        </div>
                        <h2 className="font-headline text-2xl font-bold text-slate-50">Start the conversation</h2>
                        <p className="text-sm leading-relaxed text-[#c2c6d6]">
                          Ask a question, describe an image, or start a brainstorming session with the selected model.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-6">
                      {messages.map((message) => (
                        <div key={message.id} className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}>
                          <div
                            className={`max-w-[80%] border p-4 text-on-surface ${
                              message.role === "user"
                                ? "rounded-2xl rounded-tr-none border-[#adc6ff]/20 bg-[#adc6ff]/10 text-[#dce1fb]"
                                : "rounded-2xl rounded-tl-none border-white/10 bg-[#2e3447] text-[#dce1fb]"
                            }`}
                          >
                            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] opacity-70">
                              {message.role === "user" ? displayName : lockedModel?.displayName || "Assistant"}
                            </div>
                            {message.role === "user"
                              ? <UserMessageContent message={message} />
                              : <AssistantMessageContent message={message} />}
                          </div>
                        </div>
                      ))}

                      {loadingReply ? (
                        <div className="flex flex-col items-start">
                          <div className="max-w-[80%] rounded-2xl rounded-tl-none border border-white/10 bg-[#2e3447] p-4 text-[#dce1fb]">
                            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] opacity-70">
                              {lockedModel?.displayName || "Assistant"}
                            </div>
                            <p className="text-sm leading-relaxed text-[#8c909f]">Thinking…</p>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>

              <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-[#0c1324]/92 px-4 py-4 backdrop-blur-xl md:left-48 md:right-[224px] sm:px-6 xl:px-8">
                <div className="mx-auto max-w-[1600px]">
                  <div className="bg-transparent py-1">
                {error ? (
                  <div className="mb-4 rounded-lg border border-[#93000a]/30 bg-[#93000a]/10 px-4 py-3 text-sm text-[#ffdad6]">
                    {error}
                  </div>
                ) : null}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleImageUpload}
                />

                {lockedModel?.supportsImageInput && inputImage ? (
                  <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-[#151b2d] px-4 py-3">
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={inputImage.previewUrl} alt={inputImage.name} className="h-12 w-12 rounded-lg object-cover" />
                      <div>
                        <div className="text-sm font-semibold text-white">{inputImage.name}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (inputImage?.previewUrl) URL.revokeObjectURL(inputImage.previewUrl);
                        setInputImage(null);
                      }}
                      className="rounded-md border border-white/10 bg-[#23293c] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#33394c]"
                    >
                      Remove
                    </button>
                  </div>
                ) : null}

                <div className="rounded-lg border border-white/10 bg-[#070d1f] p-4 transition-all focus-within:border-[#adc6ff]/40">
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
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void handleSend();
                      }
                    }}
                    placeholder={lockedModel?.supportsImageInput ? "Type your message here or ask about the uploaded image…" : "Type your message here…"}
                    rows={1}
                    className="w-full resize-none border-none bg-transparent text-sm leading-6 text-white outline-none placeholder:text-[#8c909f]/60"
                  />

                  <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4">
                    <div className="flex items-center gap-4">
                      {lockedModel?.supportsImageInput ? (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadingImage || loadingReply}
                          className="rounded-md p-2 text-[#c2c6d6] transition-colors hover:bg-[#2e3447] disabled:cursor-not-allowed disabled:opacity-50"
                          title="Upload image"
                        >
                          <span className="material-symbols-outlined">upload_file</span>
                        </button>
                      ) : null}
                      <span className={`text-[11px] font-medium uppercase tracking-wider text-[#8c909f] ${remainingChars < 400 ? "!text-[#ffb4ab]" : ""}`}>
                        {input.length} / {MAX_CHAT_TEXT_CHARS}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleSend()}
                      disabled={
                        (!input.trim() && !inputImage) ||
                        input.trim().length > MAX_CHAT_TEXT_CHARS ||
                        !lockedModelId ||
                        !conversationId ||
                        loadingReply ||
                        uploadingImage ||
                        loadingConversation
                      }
                      className="flex items-center gap-2 rounded-md bg-gradient-to-r from-[#adc6ff] to-[#4d8eff] px-6 py-2 text-sm font-bold text-[#002e6a] transition-all hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span>{uploadingImage ? "Uploading…" : "Send"}</span>
                      <span className="material-symbols-outlined text-sm">send</span>
                    </button>
                  </div>
                </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
    </section>
  );
}
