"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useAuth } from "../../../context/AuthContext";
import { api } from "../../../services/api";
import type { BillingBreakdown, BillingUsage, PlainChatModelItem, PlainChatParameterSchemaEntry, PlainChatPart, PlainChatTurnMeta, UploadedImageResult } from "../../../types";

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
  name: string;
  mimeType: string;
  url: string;
  previewUrl: string;
  size: number;
}

interface ChatModelOption {
  id: string;
  displayName: string;
  description?: string;
  provider: string;
  supportsImageInput: boolean;
  parameterSchema: Record<string, PlainChatParameterSchemaEntry>;
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
            <a
              key={`${message.id}-image-${index}`}
              href={part.url}
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={part.url}
                alt={`Assistant image ${index + 1}`}
                className="max-h-64 w-auto rounded-xl border border-white/10 object-cover shadow-[0_12px_30px_rgba(0,0,0,0.28)]"
              />
            </a>
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
            <a
              key={`${message.id}-image-${index}`}
              href={part.url}
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={part.url}
                alt={`User upload ${index + 1}`}
                className="max-h-56 w-auto rounded-xl border border-black/10 object-cover shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
              />
            </a>
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

function toChatModelOption(model: PlainChatModelItem): ChatModelOption {
  return {
    id: model.id,
    displayName: model.displayName,
    description: model.description,
    provider: toProviderLabel(model.provider),
    supportsImageInput: Boolean(model.supportsImageInput),
    parameterSchema: model.parameterSchema || {},
  };
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
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<ChatPhase>("select");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [providerGroups, setProviderGroups] = useState<ProviderGroup[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [lockedModelId, setLockedModelId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loadingReply, setLoadingReply] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [inputImage, setInputImage] = useState<UploadedImageState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentCredits, setCurrentCredits] = useState<number | null>(null);
  const [conversationTokens, setConversationTokens] = useState(0);
  const [lastUsage, setLastUsage] = useState<BillingUsage | null>(null);
  const [lastBillingMeta, setLastBillingMeta] = useState<PlainChatTurnMeta | null>(null);
  const [parameterValues, setParameterValues] = useState<ParameterState>({});

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
      setInput("");
      setInputImage(null);
      setError(null);
      setConversationTokens(0);
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
      setInput("");
      setInputImage(null);
      setError(null);
      setConversationTokens(0);
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
        parameterValues?: ParameterState;
      };
      setPhase(parsed.phase || "select");
      setMessages(parsed.messages || []);
      setSelectedProvider(parsed.selectedProvider || "");
      setSelectedModel(parsed.selectedModel || "");
      setLockedModelId(parsed.lockedModelId || "");
      setConversationId(parsed.conversationId || "");
      setParameterValues(parsed.parameterValues || {});
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ phase, messages, selectedProvider, selectedModel, lockedModelId, conversationId, parameterValues }),
    );
  }, [phase, messages, selectedProvider, selectedModel, lockedModelId, conversationId, parameterValues]);

  useEffect(() => {
    if (typeof window === "undefined" || !conversationId) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("new");
    url.searchParams.set("conversation", conversationId);
    window.history.replaceState({}, "", url.toString());
  }, [conversationId]);

  useEffect(() => {
    let cancelled = false;

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
            setPhase("select");
            setMessages([]);
            setConversationTokens(0);
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

    if (user) {
      void loadProfile();
    }
    void loadConfig();

    return () => {
      cancelled = true;
    };
  }, [lockedModelId, selectedModel, selectedProvider, user]);

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
        setConversationTokens(response.conversation.totalTokens || 0);
        setLastUsage(null);
        setLastBillingMeta(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load chat history.");
        setConversationId("");
        setMessages([]);
        setPhase("select");
        setConversationTokens(0);
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
          name: uploaded.name || file.name,
          mimeType: uploaded.mime_type || file.type,
          url: uploaded.url,
          previewUrl: URL.createObjectURL(file),
          size: uploaded.size || file.size,
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
      setConversationTokens(conversation.totalTokens || 0);
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

    const parts: PlainChatPart[] = [];
    if (text) {
      parts.push({ type: "text", text });
    }
    if (lockedModel?.supportsImageInput && inputImage) {
      parts.push({ type: "image_url", url: inputImage.url });
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
      setConversationTokens(response.conversation?.totalTokens || 0);
      setLastUsage(response.usage || null);
      setLastBillingMeta(response.meta || null);
      if (typeof response.meta?.current_balance === "number") {
        setCurrentCredits(response.meta.current_balance);
      }
    } catch (err) {
      setMessages((current) => current.slice(0, -1));
      setError(err instanceof Error ? err.message : "Could not get a reply.");
    } finally {
      setLoadingReply(false);
    }
  }

  const remainingChars = MAX_CHAT_TEXT_CHARS - input.length;
  const displayName = user?.displayName || user?.email?.split("@")[0] || "Studio User";
  const photoUrl = user?.photoURL || null;
  const lastResolvedCost = toResolvedCostNumber(lastBillingMeta?.resolvedCost);
  const lastTotalTokens = getUsageTotalTokens(lastUsage);
  const lastBillingComponents = Object.entries(lastBillingMeta?.billing?.components || {});

  async function handleNewChat() {
    if (!lockedModelId || !user) return;

    try {
      setLoadingReply(true);
      setError(null);
      const conversation = await api.createPlainChatConversation({ model: lockedModelId });
      setConversationId(conversation.id);
      setConversationTokens(conversation.totalTokens || 0);
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

  function renderParameterControl(key: string, entry: PlainChatParameterSchemaEntry) {
    const value = parameterValues[key];

    if (entry.type === "enum" && Array.isArray(entry.values) && entry.values.length > 0) {
      return (
        <select
          value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
          onChange={(event) => {
            setParameterValues((current) => ({ ...current, [key]: event.target.value }));
          }}
          className="w-full rounded-xl border border-white/10 bg-[#101728] px-3 py-2 text-sm text-white outline-none transition focus:border-[#adc6ff]/40"
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
          className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-sm transition-colors ${
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
              className="w-28 rounded-xl border border-white/10 bg-[#101728] px-3 py-2 text-sm text-white outline-none transition focus:border-[#adc6ff]/40"
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
      <div className="rounded-xl border border-white/10 bg-[#101728] px-3 py-2 text-sm text-[#8c909f]">
        Unsupported parameter type.
      </div>
    );
  }

  return (
    <section className="min-h-[calc(100vh-4rem)] px-6 py-8 lg:px-10">
      {phase === "select" ? (
        <div className="mx-auto max-w-6xl space-y-8">
          <div className="max-w-3xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#adc6ff]/20 bg-[#adc6ff]/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[#adc6ff]">
              Simple Chat
            </div>
            <h1 className="font-headline text-4xl font-bold tracking-tight text-white lg:text-5xl">
              Select a model before you start chatting.
            </h1>
            <p className="mt-4 text-base leading-7 text-[#c2c6d6] lg:text-lg">
              Choose one provider, pick one model, then continue into a locked chat session. The model will stay fixed for that conversation.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="space-y-3 rounded-2xl border border-white/8 bg-[#151b2d] p-6">
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#adc6ff]">Providers</div>
              {providerGroups.map((group) => (
                <button
                  key={group.provider}
                  type="button"
                  onClick={() => {
                    setSelectedProvider(group.provider);
                    setSelectedModel(group.models[0]?.id || "");
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm transition-colors ${
                    selectedProvider === group.provider
                      ? "bg-[#adc6ff]/10 font-semibold text-[#adc6ff]"
                      : "bg-[#191f31] text-[#dce1fb] hover:bg-[#23293c]"
                  }`}
                >
                  <span>{group.provider}</span>
                  <span className="text-[10px] uppercase tracking-widest text-[#8c909f]">{group.models.length}</span>
                </button>
              ))}
            </aside>

            <div className="rounded-2xl border border-white/8 bg-[#151b2d] p-6">
              <div className="flex flex-col gap-3 border-b border-white/8 pb-5 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#adc6ff]">Available Models</div>
                  <h2 className="mt-2 font-headline text-2xl font-bold text-white">{selectedProvider || "Choose a provider"}</h2>
                </div>
                {selectedModelOption ? (
                  <div className="rounded-full border border-[#adc6ff]/20 bg-[#adc6ff]/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] text-[#adc6ff]">
                    Usage-based billing
                  </div>
                ) : null}
              </div>

              <div className="mt-6 space-y-3">
                {loadingConfig ? (
                  <div className="rounded-xl bg-[#191f31] px-4 py-3 text-sm text-[#8c909f]">Loading models…</div>
                ) : activeProviderGroup ? (
                  activeProviderGroup.models.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => setSelectedModel(model.id)}
                      className={`w-full rounded-2xl border px-5 py-4 text-left transition-all ${
                        selectedModel === model.id
                          ? "border-[#adc6ff]/30 bg-[#adc6ff]/10 text-[#adc6ff]"
                          : "border-white/8 bg-[#191f31] text-[#dce1fb] hover:bg-[#23293c]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="font-headline text-xl font-bold">{model.displayName}</div>
                          <p className="mt-2 text-sm leading-6 text-[#c2c6d6]">{model.description || "Text-focused conversational model."}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <span className="rounded-full border border-white/10 bg-[#23293c] px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[#c2c6d6]">
                              {model.provider}
                            </span>
                            {model.supportsImageInput ? (
                              <span className="rounded-full border border-[#adc6ff]/20 bg-[#adc6ff]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[#adc6ff]">
                                accepts image input
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8c909f]">Usage-based</div>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-xl bg-[#191f31] px-4 py-3 text-sm text-[#8c909f]">No models available.</div>
                )}
              </div>

              <div className="mt-8 flex flex-wrap gap-4">
                <Link
                  href="/studio/start"
                  className="rounded-xl border border-white/10 bg-[#191f31] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#23293c]"
                >
                  Back to Choice
                </Link>
                <button
                  type="button"
                  onClick={() => void handleStartChat()}
                  disabled={!selectedModel || loadingConfig || loadingReply}
                  className="rounded-xl bg-gradient-to-r from-[#adc6ff] to-[#4d8eff] px-6 py-3 text-sm font-bold text-[#00285d] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loadingReply ? "Starting…" : "Next"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-7xl flex-col overflow-hidden rounded-2xl border border-white/8 bg-[#151b2d]">
          <div className="sticky top-16 z-30 border-b border-white/8 bg-[#11182a]/95 px-6 py-4 backdrop-blur-xl">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl border border-[#adc6ff]/20 bg-[#1a2333]">
                  {photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrl} alt={displayName} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-sm font-bold text-[#adc6ff]">{displayName.slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#adc6ff]">Chat Session</div>
                  <div className="mt-1 font-headline text-xl font-bold text-white">{lockedModel?.displayName || "Selected model"}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-full border border-white/10 bg-[#191f31] px-4 py-2 text-sm font-semibold text-white">
                  Tokens used: <span className="text-[#adc6ff]">{conversationTokens.toLocaleString()}</span>
                </div>
                <div className="rounded-full border border-white/10 bg-[#191f31] px-4 py-2 text-sm font-semibold text-white">
                  Last cost: <span className="text-[#adc6ff]">{lastResolvedCost > 0 ? `${lastResolvedCost.toFixed(4)} credits` : "—"}</span>
                </div>
                <div className="rounded-full border border-white/10 bg-[#191f31] px-4 py-2 text-sm font-semibold text-white">
                  Remaining credits: <span className="text-[#adc6ff]">{currentCredits === null ? "..." : currentCredits.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="border-b border-white/8 px-6 py-5">
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#adc6ff]">Simple Chat Session</div>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-headline text-3xl font-bold text-white">{lockedModel?.displayName || "Selected model"}</h2>
                <p className="mt-2 text-sm text-[#c2c6d6]">
                  {lockedModel?.description || "Chat with the selected model. The model is locked for this conversation."}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleNewChat()}
                  className="rounded-xl border border-white/10 bg-[#191f31] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#23293c]"
                >
                  New Chat
                </button>
                <Link
                  href="/studio/start"
                  className="rounded-xl bg-gradient-to-r from-[#adc6ff] to-[#4d8eff] px-4 py-3 text-sm font-bold text-[#00285d] transition-all hover:brightness-110"
                >
                  Back to Choice
                </Link>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-hidden px-6 py-6">
            <div className="grid h-full gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-4 overflow-y-auto pr-1">
                {loadingConversation ? (
                  <div className="flex h-full min-h-[360px] items-center justify-center">
                    <div className="max-w-xl text-center text-sm text-[#8c909f]">Loading conversation…</div>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex h-full min-h-[360px] items-center justify-center">
                    <div className="max-w-xl text-center">
                      <span className="material-symbols-outlined text-6xl text-[#adc6ff]">chat</span>
                      <h3 className="mt-4 font-headline text-3xl font-bold text-white">Start the conversation</h3>
                      <p className="mt-3 text-base leading-7 text-[#c2c6d6]">
                        Send your first message. This session keeps the previous turns in memory while you continue chatting.
                      </p>
                    </div>
                  </div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={`max-w-3xl rounded-2xl px-5 py-4 ${
                        message.role === "user"
                          ? "ml-auto bg-gradient-to-r from-[#adc6ff] to-[#4d8eff] text-[#00285d]"
                          : "bg-[#191f31] text-[#dce1fb]"
                      }`}
                    >
                      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] opacity-70">
                        {message.role === "user" ? "You" : lockedModel?.displayName || "Assistant"}
                      </div>
                      {message.role === "user" ? (
                        <UserMessageContent message={message} />
                      ) : (
                        <AssistantMessageContent message={message} />
                      )}
                    </div>
                  ))
                )}

                {loadingReply ? (
                  <div className="max-w-3xl rounded-2xl bg-[#191f31] px-5 py-4 text-[#dce1fb]">
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] opacity-70">
                      {lockedModel?.displayName || "Assistant"}
                    </div>
                    <p className="text-sm leading-7 text-[#8c909f]">Thinking…</p>
                  </div>
                ) : null}
              </div>

              <aside className="h-fit rounded-2xl border border-white/8 bg-[#11182a] p-5 xl:sticky xl:top-0">
                <div className="mb-5 rounded-2xl border border-white/8 bg-[#151b2d] p-4">
                  <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#adc6ff]">Last Request Billing</div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-white/8 bg-[#11182a] px-3 py-3">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-[#8c909f]">Cost</div>
                      <div className="mt-1 text-sm font-semibold text-white">
                        {lastResolvedCost > 0 ? `${lastResolvedCost.toFixed(4)} credits` : "—"}
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-[#11182a] px-3 py-3">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-[#8c909f]">Tokens</div>
                      <div className="mt-1 text-sm font-semibold text-white">
                        {lastTotalTokens > 0 ? lastTotalTokens.toLocaleString() : "—"}
                      </div>
                    </div>
                  </div>
                  {lastBillingMeta?.billingMode ? (
                    <div className="mt-3 text-xs text-[#c2c6d6]">
                      Billing mode: <span className="font-semibold text-white">{lastBillingMeta.billingMode}</span>
                    </div>
                  ) : null}
                  {lastBillingComponents.length > 0 ? (
                    <div className="mt-4 space-y-2">
                      {lastBillingComponents.map(([key, value]) => {
                        const componentCost = toResolvedCostNumber((value as Record<string, unknown>)?.cost as string | number | undefined);
                        return (
                          <div key={key} className="rounded-xl border border-white/8 bg-[#11182a] px-3 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-semibold text-white">{formatBillingComponentLabel(key)}</div>
                              <div className="text-xs font-semibold text-[#adc6ff]">
                                {componentCost > 0 ? `${componentCost.toFixed(4)} cr` : "—"}
                              </div>
                            </div>
                            {"promptTokens" in (value as Record<string, unknown>) || "completionTokens" in (value as Record<string, unknown>) ? (
                              <div className="mt-2 text-[11px] text-[#8c909f]">
                                {Number((value as Record<string, unknown>).promptTokens || 0).toLocaleString()} in / {Number((value as Record<string, unknown>).completionTokens || 0).toLocaleString()} out
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#adc6ff]">Model Params</div>
                    <h3 className="mt-2 font-headline text-xl font-bold text-white">
                      {lockedModel?.displayName || "Selected model"}
                    </h3>
                  </div>
                  {lockedModelParameters.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (!lockedModel) return;
                        setParameterValues(createParameterState(lockedModel.parameterSchema));
                      }}
                      className="rounded-lg border border-white/10 bg-[#191f31] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#23293c]"
                    >
                      Reset
                    </button>
                  ) : null}
                </div>

                <p className="mt-3 text-sm leading-6 text-[#8c909f]">
                  These settings apply to the next assistant turns in this locked conversation.
                </p>

                <div className="mt-5 space-y-4">
                  {lockedModelParameters.length > 0 ? (
                    lockedModelParameters.map(([key, entry]) => (
                      <div key={key} className="rounded-2xl border border-white/8 bg-[#151b2d] p-4">
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-white">{toParameterLabel(key)}</div>
                          </div>
                          <div className="max-w-[130px] text-right text-[11px] leading-4 text-[#8c909f]">
                            {entry.note ? <div>{entry.note}</div> : null}
                          </div>
                        </div>
                        {renderParameterControl(key, entry)}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-white/8 bg-[#151b2d] px-4 py-5 text-sm leading-6 text-[#8c909f]">
                      This model does not expose editable chat parameters yet.
                    </div>
                  )}
                </div>
              </aside>
            </div>
          </div>

          <div className="border-t border-white/8 px-6 py-5">
            {error ? (
              <div className="mb-4 rounded-xl border border-[#93000a]/30 bg-[#93000a]/10 px-4 py-3 text-sm text-[#ffdad6]">
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
              <div className="mb-4 flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#191f31] px-4 py-3">
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={inputImage.previewUrl} alt={inputImage.name} className="h-12 w-12 rounded-lg object-cover" />
                  <div>
                    <div className="text-sm font-semibold text-white">{inputImage.name}</div>
                    <div className="text-xs text-[#8c909f]">{(inputImage.size / (1024 * 1024)).toFixed(2)} MB</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (inputImage?.previewUrl) URL.revokeObjectURL(inputImage.previewUrl);
                    setInputImage(null);
                  }}
                  className="rounded-lg border border-white/10 bg-[#23293c] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#33394c]"
                >
                  Remove
                </button>
              </div>
            ) : null}

            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="flex-1">
                <textarea
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
                  placeholder={lockedModel?.supportsImageInput ? "Send a message or ask about the uploaded image…" : "Send a message…"}
                  rows={4}
                  className="w-full resize-none rounded-2xl border border-white/10 bg-[#070d1f] px-5 py-4 text-sm leading-7 text-white outline-none transition placeholder:text-[#8c909f] focus:border-[#adc6ff]/40"
                />
                <div className="mt-2 flex justify-end text-xs text-[#8c909f]">
                  <span className={remainingChars < 400 ? "text-[#ffb4ab]" : undefined}>
                    {input.length}/{MAX_CHAT_TEXT_CHARS}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {lockedModel?.supportsImageInput ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingImage || loadingReply}
                    className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-[#191f31] text-white transition-colors hover:bg-[#23293c] disabled:cursor-not-allowed disabled:opacity-50"
                    title="Upload image"
                  >
                    <span className="material-symbols-outlined text-xl">upload</span>
                  </button>
                ) : null}
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
                  className="rounded-xl bg-gradient-to-r from-[#adc6ff] to-[#4d8eff] px-6 py-3 text-sm font-bold text-[#00285d] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {uploadingImage ? "Uploading…" : "Send"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
