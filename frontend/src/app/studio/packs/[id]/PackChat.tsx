"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, isContentBlockedError, isNetworkError } from "../../../../services/api";
import { useAuth } from "../../../../context/AuthContext";
import { addHistoryEntry } from "../../../../lib/history";
import { LATENCY_FALLBACK_SECONDS, latencyBudgetForModel } from "../../../../lib/modelLatency";
import InteractiveAuthenticatedImage from "../../../../components/InteractiveAuthenticatedImage";
import AuthenticatedImage, { fetchAuthenticatedAsset } from "../../../../components/AuthenticatedImage";
import RefPicker, { REF_DND_TYPE } from "./RefPicker";
import {
  getUploadConstraints,
  preferredOutputType,
  readImageDimensions,
  type UploadImageConstraints,
} from "../../../../lib/imageInputConstraints";
import type { InputImagePayload, PackChatTurn, PackDetail, PackEstimate, PackPlan, PackSessionData, PackSessionMeta, PackVariant } from "../../../../types";
import { recordRecentUpload, type RecentUpload } from "../../../../lib/recentUploads";
import {
  dropMockupRef,
  mockupCacheKey,
  mockupRefStillExists,
  readMockupRef,
  writeMockupRef,
} from "../../../../lib/mockupRefCache";
import type { Language } from "../../../../context/LanguageContext";
import { aspectFieldKey, fmtNum, pt, qualityLabel } from "../packsShared";
import AspectShapePicker from "../AspectShapePicker";
import ModelPicker from "../ModelPicker";
import type { CSSProperties, ClipboardEvent, DragEvent } from "react";

// The packs STUDIO (chrome + confirm modal) uses ONE accent — the composer
// send-button hue — instead of the per-pack craft accent, so the whole studio
// reads as one unit. It's exposed as --accent* on the studio root below
// (accentVars), which every var(--accent) usage — including the modal —
// inherits. The packs GALLERY still uses the per-pack craft colors (CRAFT_HEX)
// for card/specimen identity.
//
// This MUST stay a var, not a literal. It used to be #a5b4fc, and because these
// accents are handed to color-mix() in INLINE styles, no stylesheet could retint
// them — so light mode kept mixing tints out of a pale periwinkle. A 15% tint of
// that reads bright on near-black and is practically white on white, which is why
// the whole studio looked washed out in light. Dark keeps #a5b4fc; light is the
// brand blue (see --packs-brand in globals.css).
const BRAND = "var(--packs-brand)";

// Generating-tile ETA counter. Reuses the shared per-model latency budget
// (lib/modelLatency, the same source the plain-chat waiter uses) but presents it
// DIFFERENTLY: a circular periwinkle ring that fills toward the expected time —
// smooth via SVG stroke-dashoffset, not the chat's linear purple→cyan bar — with
// the "~Ns" ticking in the middle, then spins indeterminately if it runs over.
function PackGeneratingTile({ expectedSeconds }: { expectedSeconds: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 500);
    return () => window.clearInterval(id);
  }, []);

  const expected = expectedSeconds > 0 ? expectedSeconds : LATENCY_FALLBACK_SECONDS;
  const overtime = elapsed >= expected;
  const remaining = Math.max(1, Math.ceil(expected - elapsed));
  const pct = Math.min(elapsed / expected, 1);
  const label = overtime ? `${Math.floor(elapsed)}s` : `~${remaining}s`;

  const R = 20;
  const CIRC = 2 * Math.PI * R;
  // Filling: arc grows empty→full as time nears the budget. Overtime: a fixed
  // ~30% arc that spins, reading as "still working" rather than a false 100%.
  const dashoffset = overtime ? CIRC * 0.7 : CIRC * (1 - pct);

  return (
    <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 animate-pulse motion-reduce:animate-none"
        style={{ background: "radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 68%)" }}
      />
      <div className="relative flex h-[60px] w-[60px] items-center justify-center">
        <svg
          viewBox="0 0 48 48"
          className={`absolute inset-0 h-full w-full ${overtime ? "animate-spin [animation-duration:0.9s] motion-reduce:animate-none" : "-rotate-90"}`}
        >
          <circle cx="24" cy="24" r={R} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="3.5" />
          <circle
            cx="24"
            cy="24"
            r={R}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={dashoffset}
            style={{ transition: "stroke-dashoffset 0.5s linear" }}
            className="motion-reduce:transition-none"
          />
        </svg>
        <span className="relative z-10 text-[13px] font-bold tabular-nums text-[color:var(--accent)]">{label}</span>
      </div>
    </div>
  );
}

// "Thinking" with growing dots (. .. ...) shown inside the composer while the
// planning agent runs — the in-box counterpart to the composer's lit ring.
function ThinkingLabel({ text }: { text: string }) {
  const [n, setN] = useState(1);
  useEffect(() => {
    const id = window.setInterval(() => setN((v) => (v % 3) + 1), 420);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="flex flex-1 items-center self-end px-1.5 py-2 text-sm font-medium text-[color:var(--accent)]">
      {text}
      <span className="ms-0.5 inline-block w-3 text-start tabular-nums">{".".repeat(n)}</span>
    </span>
  );
}

// Flowing shimmer + soft image glyph shown in a result tile's spot while the
// finished image decodes — replaces the plain "Loading image..." text.
function PackImageSkeleton() {
  return (
    <>
      <span className="pack-img-skeleton" aria-hidden />
      <span className="material-symbols-outlined relative animate-pulse text-3xl text-[color:var(--accent-60)] motion-reduce:animate-none">image</span>
    </>
  );
}

// Editing/image-input models accept at most 3 source images.
const MAX_REFS = 3;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// Matches the plain chat composer's limit (studio/chat/page.tsx MAX_CHAT_TEXT_CHARS).
const MAX_COMPOSER_CHARS = 4000;
const MAX_PROXY_IMAGE_DIMENSION = 768;
const MAX_PROXY_IMAGE_BYTES = 120_000;
const UNIVERSAL_INPUT_CONSTRAINTS: UploadImageConstraints = {
  maxImages: MAX_REFS,
  minDim: 256,
  formats: ["image/png", "image/jpeg"],
};
const HISTORY_LIMIT = 5;

type Sticky = { model?: string; aspect_ratio?: string; quality?: string | null };
const stickyKey = (id: string) => `vibecraft.packs.sticky.${id}`;
function readSticky(id: string): Sticky | null {
  try {
    const raw = localStorage.getItem(stickyKey(id));
    return raw ? (JSON.parse(raw) as Sticky) : null;
  } catch {
    return null;
  }
}
function writeSticky(id: string, v: Sticky) {
  try {
    localStorage.setItem(stickyKey(id), JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

// Aspect-ratio options follow the SELECTED model: each model accepts its own
// vocabulary (grok ratio strings like "3:2" vs gpt-image pixel sizes like
// "1024x1024"). Falls back to the pack-level list for models that don't declare
// their own (or before a model is chosen).
function aspectOptionsFor(pack: PackDetail | null, modelId: string | undefined): string[] {
  const fromModel = pack?.models?.find((m) => m.id === modelId)?.aspect_ratios;
  if (fromModel && fromModel.length) return fromModel;
  return pack?.aspect_ratios ?? [];
}

function loadImageFromUrl(src: string, language: Language): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(pt(language, "imageDecodeFailed")));
    image.src = src;
  });
}
function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number | undefined, language: Language): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(pt(language, "imageEncodeFailed")))), mimeType, quality);
  });
}
async function normalizeUploadImage(file: File, constraints: UploadImageConstraints, language: Language): Promise<File> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageFromUrl(objectUrl, language);
    const longest = Math.max(image.width, image.height);
    const shortest = Math.min(image.width, image.height);
    let scale = Math.min(1, MAX_PROXY_IMAGE_DIMENSION / longest);
    if (shortest * scale < constraints.minDim) scale = constraints.minDim / shortest;
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(image, 0, 0, width, height);
    const outputType = preferredOutputType(file.type, constraints.formats);
    const shouldReencode = scale !== 1 || file.size > MAX_PROXY_IMAGE_BYTES || file.type !== outputType;
    if (!shouldReencode) return file;
    let quality = outputType === "image/webp" ? 0.86 : 0.82;
    let blob = await canvasToBlob(canvas, outputType, quality, language);
    while (blob.size > MAX_PROXY_IMAGE_BYTES && quality && quality > 0.35) {
      quality -= 0.08;
      blob = await canvasToBlob(canvas, outputType, quality, language);
    }
    if (blob.size >= file.size && file.size <= MAX_PROXY_IMAGE_BYTES && file.type === outputType) return file;
    const extension = outputType === "image/webp" ? ".webp" : ".jpg";
    const nextName = file.name.replace(/\.(png|jpg|jpeg|webp)$/i, extension);
    return new File([blob], nextName, { type: outputType });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// A generation result shown in the gallery (no chat text is rendered).
type ResultTile = { id: string; status: "generating" | "success" | "error"; image?: string; prompt?: string; expectedSeconds?: number };

let _tid = 0;
const nextId = () => `t${Date.now()}_${_tid++}`;

export default function PackChat({
  pack,
  variant,
  language,
  onChangeMockup,
}: {
  pack: PackDetail;
  variant: PackVariant | null;
  language: Language;
  onChangeMockup?: () => void;
}) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const isRtl = language === "ar";
  const displayClass = isRtl ? "" : "font-['Bricolage_Grotesque']";

  const [results, setResults] = useState<ResultTile[]>([]);
  // Pre-fill the composer with an editable example: the chosen mockup's own example
  // first, else the pack default. PackChat is keyed per-variant upstream, so this
  // lazy init re-seeds each time a different mockup is opened. The user can edit it.
  const [composer, setComposer] = useState(() => variant?.example || pack.example || "");
  const [pendingRefs, setPendingRefs] = useState<InputImagePayload[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  // URL of the gallery tile currently being fetched + re-uploaded, so the
  // picker can spin that one tile and block a second concurrent pick.
  const [pickerBusyUrl, setPickerBusyUrl] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const [credits, setCredits] = useState<number | null>(null);
  const [planning, setPlanning] = useState(false);
  // One-shot "charge" comet that sweeps the composer border on send (mirrors the
  // plain-chat composer). chargeKey remounts the overlay so the CSS restarts;
  // prefers-reduced-motion is handled in CSS. The lit ring during planning is the
  // `.is-thinking` class on the composer wrapper.
  const [charging, setCharging] = useState(false);
  const [chargeKey, setChargeKey] = useState(0);
  const chargeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runComposerCharge = useCallback(() => {
    setChargeKey((k) => k + 1);
    setCharging(true);
    if (chargeTimerRef.current) clearTimeout(chargeTimerRef.current);
    chargeTimerRef.current = setTimeout(() => setCharging(false), 2600);
  }, []);
  useEffect(() => () => { if (chargeTimerRef.current) clearTimeout(chargeTimerRef.current); }, []);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [clarify, setClarify] = useState<string | null>(null);
  const awaitingClarify = clarify !== null;

  // Conversation memory (NOT rendered in the gallery): prior user requests + the
  // agent's prior prompts, so follow-ups ("make it red") have context.
  const historyRef = useRef<PackChatTurn[]>([]);

  // ---- saved sessions (reopenable + renamable) ----
  const [sessions, setSessions] = useState<PackSessionMeta[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState("");
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const sessionIdRef = useRef<string | null>(null);
  const firstReqRef = useRef<string>("");
  const savingRef = useRef(false);

  const refreshSessions = useCallback(() => {
    api.listPackSessions(pack.id).then(setSessions).catch(() => {});
  }, [pack.id]);
  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  const [mockupRef, setMockupRef] = useState<InputImagePayload | null>(null);
  const [mockupLoading, setMockupLoading] = useState(false);
  // The scene template is a removable attachment: the user owns the ref list,
  // so they can drop it to edit any prior version instead of the blank mockup.
  const [useMockup, setUseMockup] = useState(true);

  // confirm pop-up (the only place params + the agent's summary appear)
  const [plan, setPlan] = useState<PackPlan | null>(null);
  const [planRefs, setPlanRefs] = useState<InputImagePayload[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [popModel, setPopModel] = useState<string | undefined>(undefined);
  // The agent's recommended model — collapsed model list leads with it, shown gold.
  const [popRecommendedModel, setPopRecommendedModel] = useState<string | null>(null);
  const [popAspect, setPopAspect] = useState<string>("");
  const [popQuality, setPopQuality] = useState<string | null>(null);
  const [popEstimate, setPopEstimate] = useState<PackEstimate | null>(null);
  const [popEstimating, setPopEstimating] = useState(false);

  const galleryRef = useRef<HTMLDivElement | null>(null);
  const barWrapRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [barClearance, setBarClearance] = useState(96);

  // The floating bar's height varies (attachment chips / clarify bubble add a
  // row), so measure it live and reserve exactly that much space at the top of
  // the gallery scroll range - otherwise scrolling to the top permanently traps
  // the first row of results under the bar with no way to bring it into view.
  useEffect(() => {
    const el = barWrapRef.current;
    if (!el) return;
    const update = () => setBarClearance(el.offsetHeight + 28);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The seeded example is a suggestion, not something the user typed — so select it
  // on open: the first keystroke replaces it outright instead of typing into it.
  // Fires once per mount, and PackChat is keyed per-variant upstream, so opening a
  // different mockup re-arms it. Touch devices get the selection on first tap
  // instead — auto-focusing there would pop the keyboard over the reference scene.
  const exampleSelectedRef = useRef(false);
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !textarea.value) return;
    // Leave the ref unset on touch so the onFocus handler can select on first tap.
    if (window.matchMedia?.("(pointer: coarse)").matches) return;
    exampleSelectedRef.current = true;
    textarea.focus();
    textarea.select();
  }, []);

  // Grow the composer from 1 up to 4 lines as the user types (line 2 takes
  // line 1's place, etc.), then scroll internally past that instead of
  // growing further — mirrors the auto-grow behavior in the plain chat composer.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    const computed = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(computed.lineHeight) || 20;
    const maxHeight = lineHeight * 4;
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [composer]);

  const refreshCredits = useCallback(() => {
    api.getProfile().then((p) => setCredits(p.credits ?? 0)).catch(() => setCredits(null));
  }, []);
  useEffect(() => {
    refreshCredits();
  }, [refreshCredits]);

  // Upload the chosen mockup template (shrunk) so the model reproduces the scene.
  useEffect(() => {
    const url = variant?.thumbnail_url || variant?.hero_example_url || "";
    if (!url) {
      setMockupRef(null);
      return;
    }
    let cancelled = false;
    setMockupLoading(true);
    setMockupRef(null);
    void (async () => {
      // This scene was very likely uploaded already on a previous visit. Reuse
      // that file_id instead of uploading identical bytes again.
      const key = uid ? mockupCacheKey(uid, variant?.id ?? "scene", url) : null;
      try {
        if (key) {
          const cached = readMockupRef(key);
          if (cached) {
            if (await mockupRefStillExists(user, cached.url)) {
              if (!cancelled) {
                setMockupRef({ file_id: cached.file_id, name: cached.name, mime_type: cached.mime_type, url: cached.url });
                setUseMockup(true);
              }
              return;
            }
            // Server swept it (or it never existed) — fall through and re-upload.
            dropMockupRef(key);
          }
        }
        const resp = await fetch(url);
        if (!resp.ok) throw new Error("mockup fetch failed");
        const blob = await resp.blob();
        const raw = new File([blob], `mockup-${variant?.id ?? "scene"}.png`, { type: blob.type || "image/png" });
        const file = await normalizeUploadImage(raw, UNIVERSAL_INPUT_CONSTRAINTS, language);
        const up = await api.uploadInputImage(file);
        if (key) writeMockupRef(key, { file_id: up.id, name: up.name, mime_type: up.mime_type, url: up.url });
        if (!cancelled) {
          setMockupRef({ file_id: up.id, name: up.name, mime_type: up.mime_type, url: up.url });
          setUseMockup(true);
        }
      } catch {
        if (!cancelled) setMockupRef(null);
      } finally {
        if (!cancelled) setMockupLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [variant?.id, variant?.thumbnail_url, variant?.hero_example_url, uid, user, language]);

  const mockupActive = Boolean(mockupRef) && useMockup;
  const designSlots = MAX_REFS - (mockupActive ? 1 : 0);

  const addFiles = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files || files.length === 0) return;
      const room = designSlots - pendingRefs.length;
      if (room <= 0) {
        setToast(pt(language, "refsFull"));
        return;
      }
      const slice = Array.from(files).slice(0, room);
      const validate = getUploadConstraints(undefined);
      for (const original of slice) {
        try {
          if (!["image/png", "image/jpeg", "image/webp"].includes(original.type)) throw new Error(pt(language, "unsupportedFormat"));
          if (original.size > MAX_UPLOAD_BYTES) throw new Error(pt(language, "fileTooLarge"));
          const { width, height } = await readImageDimensions(original);
          if (Math.min(width, height) < validate.minDim) throw new Error(pt(language, "imageTooSmall").replace("{n}", String(validate.minDim)));
          const file = await normalizeUploadImage(original, UNIVERSAL_INPUT_CONSTRAINTS, language);
          const res = await api.uploadInputImage(file);
          // Only files a person actually chose land in the Uploaded tab — this is
          // the one call site that means "the user picked this from their machine".
          recordRecentUpload(uid, { file_id: res.id, mime_type: res.mime_type, url: res.url });
          setPendingRefs((prev) => [...prev, { file_id: res.id, name: res.name, mime_type: res.mime_type, url: res.url }]);
        } catch (e) {
          setToast(e instanceof Error ? e.message : pt(language, "uploadFailed"));
        }
      }
    },
    [designSlots, pendingRefs.length, language, uid],
  );

  const useFromThread = useCallback(
    (ref: InputImagePayload) => {
      setPendingRefs((prev) => {
        if (prev.length >= designSlots) {
          setToast(pt(language, "refsFull"));
          return prev;
        }
        if (prev.some((r) => (r.url && r.url === ref.url) || (r.file_id && r.file_id === ref.file_id))) return prev;
        return [...prev, ref];
      });
    },
    [designSlots, language],
  );

  // Drag-and-drop anywhere on the canvas. Accepts both a real file drag and an
  // internal result drag: not every browser exposes "Files" for a dragged <img>,
  // so gating on "Files" alone would refuse the drop outright. dragDepthRef counts enter/leave across
  // nested children so the overlay doesn't flicker as the pointer crosses child
  // element boundaries (dragenter/dragleave fire per-element, not once per region).
  const handleDragEnter = useCallback((e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files") && !e.dataTransfer.types.includes(REF_DND_TYPE)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  }, []);
  const handleDragOver = useCallback((e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files") && !e.dataTransfer.types.includes(REF_DND_TYPE)) return;
    e.preventDefault();
  }, []);
  const handleDragLeave = useCallback((e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files") && !e.dataTransfer.types.includes(REF_DND_TYPE)) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragOver(false);
  }, []);
  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDragOver(false);
      // A result dragged from the grid is already a private file on the server.
      // Reference it like the "use in next" button does: no fetch, no upload, and
      // nothing lands in the Uploaded tab, which is only for files off the disk.
      const refUrl = e.dataTransfer.getData(REF_DND_TYPE);
      if (refUrl) {
        useFromThread({ url: refUrl, name: "previous result" });
        return;
      }
      void addFiles(e.dataTransfer.files);
    },
    [addFiles, useFromThread],
  );

  // Paste an image straight from the clipboard (e.g. a screenshot). Falls back
  // to normal text paste when the clipboard has no image content.
  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const imageFiles = Array.from(e.clipboardData.items)
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
      if (imageFiles.length === 0) return;
      e.preventDefault();
      void addFiles(imageFiles);
    },
    [addFiles],
  );


  // A gallery result is a generated output, not a file this user owns as an
  // *input* — so it takes the same route the mockup template does: fetch the
  // bytes (authenticated), normalize, and re-upload to mint a private file_id.
  // A recent upload already has one, so it skips all of this.
  const pickFromGallery = useCallback(
    async (url: string) => {
      if (pendingRefs.length >= designSlots) {
        setToast(pt(language, "refsFull"));
        return;
      }
      setPickerBusyUrl(url);
      try {
        const blob = await fetchAuthenticatedAsset(user, url);
        const raw = new File([blob], "gallery-image.png", { type: blob.type || "image/png" });
        const file = await normalizeUploadImage(raw, UNIVERSAL_INPUT_CONSTRAINTS, language);
        const up = await api.uploadInputImage(file);
        useFromThread({ file_id: up.id, name: up.name, mime_type: up.mime_type, url: up.url });
      } catch (e) {
        setToast(e instanceof Error ? e.message : pt(language, "uploadFailed"));
      } finally {
        setPickerBusyUrl(null);
      }
    },
    [pendingRefs.length, designSlots, language, user, useFromThread],
  );

  const pickFromUploads = useCallback(
    (item: RecentUpload) => {
      useFromThread({ file_id: item.file_id, mime_type: item.mime_type, url: item.url });
    },
    [useFromThread],
  );

  const send = useCallback(async () => {
    const text = composer.trim();
    const userImages = [...pendingRefs];
    if (!text && userImages.length === 0) return;
    if (pack.requires_image_input && !mockupActive && userImages.length === 0) {
      setToast(pt(language, "imageRequired"));
      return;
    }
    // First request of a fresh session becomes its auto-title.
    if (!sessionIdRef.current && !firstReqRef.current && text) firstReqRef.current = text;

    const history = historyRef.current.slice(-HISTORY_LIMIT);
    const round = awaitingClarify ? 2 : 1;
    const sendRefs = mockupActive && mockupRef ? [mockupRef, ...userImages] : userImages;
    // Remember the input so a connection drop never loses what the user typed.
    const prevComposer = composer;
    const prevRefs = pendingRefs;
    const prevClarify = clarify;

    setComposer("");
    setPendingRefs([]);
    setClarify(null);
    setPlanning(true);
    setToast(null);
    runComposerCharge();

    const planBody = {
      text,
      image_refs: sendRefs.length ? sendRefs : undefined,
      lang: language,
      variant_id: variant?.id ?? undefined,
      round,
      mockup_first: mockupActive,
      history: history.length ? history : undefined,
    };

    try {
      let res;
      try {
        res = await api.planPack(pack.id, planBody);
      } catch (firstErr) {
        // A momentary blip shouldn't fail instantly: give the connection ~3s,
        // then retry once (planning is free + idempotent). Otherwise surface it.
        if (!isNetworkError(firstErr)) throw firstErr;
        await new Promise((r) => setTimeout(r, 3000));
        res = await api.planPack(pack.id, planBody);
      }
      // Success: commit this turn to memory.
      if (text) historyRef.current.push({ role: "user", text });
      if (res.status === "needs_clarification") {
        const q = res.clarification ?? "";
        setClarify(q);
        if (q) historyRef.current.push({ role: "assistant", text: q });
        return;
      }
      const p = res.plan;
      if (!p) return;
      if (p.final_prompt) historyRef.current.push({ role: "assistant", text: p.final_prompt });
      setPlan(p);
      setPlanRefs(sendRefs);

      const sticky = readSticky(pack.id);
      const models = (pack.mockup_models?.length ? pack.mockup_models : pack.models) ?? [];
      const validModel = (id?: string | null) => (id && models.some((m) => m.id === id) ? id : undefined);
      const initModel = validModel(sticky?.model) ?? validModel(p.model) ?? models[0]?.id;
      // Ratio options follow the chosen model; sticky/agent values only apply
      // if valid for THAT model's vocabulary, else default to its first option.
      const aOpts = aspectOptionsFor(pack, initModel);
      const initAspect =
        sticky?.aspect_ratio && aOpts.includes(sticky.aspect_ratio)
          ? sticky.aspect_ratio
          : p.aspect_ratio && aOpts.includes(p.aspect_ratio)
            ? p.aspect_ratio
            : aOpts[0] ?? "";
      const qOpts = models.find((m) => m.id === initModel)?.quality_options ?? [];
      const initQuality =
        sticky?.quality && qOpts.includes(sticky.quality) ? sticky.quality : p.quality && qOpts.includes(p.quality) ? p.quality : qOpts[0] ?? null;
      setPopModel(initModel);
      setPopRecommendedModel(validModel(p.model) ?? initModel ?? null);
      setPopAspect(initAspect);
      setPopQuality(initQuality);
      setPopEstimate(res.estimate ?? null);
      setConfirmOpen(true);
    } catch (e) {
      // Restore what the user wrote (only if they haven't typed something new),
      // so they can just retry instead of re-typing.
      setComposer((cur) => cur || prevComposer);
      setPendingRefs((cur) => (cur.length ? cur : prevRefs));
      setClarify((cur) => cur ?? prevClarify);
      setToast(isContentBlockedError(e) ? pt(language, "blocked") : e instanceof Error ? e.message : pt(language, "requestFailed"));
    } finally {
      setPlanning(false);
    }
  }, [composer, pendingRefs, clarify, awaitingClarify, mockupRef, pack, language, variant, runComposerCharge]);

  // live re-estimate while the pop-up is open
  useEffect(() => {
    if (!confirmOpen || !popModel) return;
    let cancelled = false;
    setPopEstimating(true);
    api
      .estimatePack(pack.id, { n: 1, aspect_ratio: popAspect || undefined, has_image: planRefs.length > 0, model: popModel, quality: popQuality ?? undefined })
      .then((e) => !cancelled && setPopEstimate(e))
      .catch(() => {})
      .finally(() => !cancelled && setPopEstimating(false));
    return () => {
      cancelled = true;
    };
  }, [confirmOpen, pack.id, popModel, popAspect, popQuality, planRefs.length]);

  const confirmGenerate = useCallback(async () => {
    if (!plan) return;
    writeSticky(pack.id, { model: popModel, aspect_ratio: popAspect, quality: popQuality });
    setConfirmOpen(false);
    const tileId = nextId();
    // Newest first: prepend the generating tile so the latest result is on top.
    setResults((prev) => [{ id: tileId, status: "generating", prompt: plan.final_prompt, expectedSeconds: latencyBudgetForModel(popModel, popQuality) }, ...prev]);
    galleryRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    setBusy(true);
    setToast(null);
    try {
      const res = await api.generatePack(pack.id, {
        n: 1,
        aspect_ratio: popAspect || undefined,
        image_refs: planRefs.length ? planRefs : undefined,
        model: popModel,
        quality: popQuality ?? undefined,
        prompt_override: plan.final_prompt,
      });
      const tile = res.tiles[0];
      const ok = tile && tile.status === "success" && tile.image;
      setResults((prev) => prev.map((t) => (t.id === tileId ? { ...t, status: ok ? "success" : "error", image: ok ? tile.image! : undefined } : t)));
      if (res.summary.current_balance !== null) setCredits(res.summary.current_balance);
      window.dispatchEvent(new Event("studio-credits-refresh"));
      refreshCredits();
      if (ok && user) void addHistoryEntry(user.uid, { imageUrl: tile.image!, prompt: plan.final_prompt, model: popModel ?? "" });
    } catch (e) {
      if (isNetworkError(e)) {
        // Connection dropped (no charge): drop the placeholder and reopen the
        // confirm so the user retries the SAME plan — no re-typing, no extra
        // agent cost. We never auto-retry a billed call (double-charge risk).
        setResults((prev) => prev.filter((t) => t.id !== tileId));
        setConfirmOpen(true);
      } else {
        setResults((prev) => prev.map((t) => (t.id === tileId ? { ...t, status: "error" } : t)));
      }
      setToast(isContentBlockedError(e) ? pt(language, "blocked") : e instanceof Error ? e.message : pt(language, "generationFailed"));
    } finally {
      setBusy(false);
    }
  }, [plan, pack.id, popModel, popAspect, popQuality, planRefs, refreshCredits, user, language]);

  // ---- autosave the session (create on first result, then patch) ----
  const persist = useCallback(async () => {
    if (savingRef.current) return;
    const saved = results.filter((r) => r.status === "success" && r.image).map((r) => ({ image: r.image as string, prompt: r.prompt }));
    if (saved.length === 0) return;
    const data: PackSessionData = { results: saved, history: historyRef.current.slice(-2 * HISTORY_LIMIT), mockup: mockupRef ?? null };
    savingRef.current = true;
    try {
      if (!sessionIdRef.current) {
        const title = (firstReqRef.current || saved[saved.length - 1]?.prompt || "New session").slice(0, 60);
        const s = await api.createPackSession({ pack_id: pack.id, variant_id: variant?.id ?? null, title, data });
        sessionIdRef.current = s.id;
        setSessionId(s.id);
        setSessionTitle(s.title);
        refreshSessions();
      } else {
        await api.updatePackSession(sessionIdRef.current, { data });
        refreshSessions();
      }
    } catch {
      /* autosave is best-effort */
    } finally {
      savingRef.current = false;
    }
  }, [results, mockupRef, pack.id, variant, refreshSessions]);

  useEffect(() => {
    if (!results.some((r) => r.status === "success" && r.image)) return;
    const t = setTimeout(() => void persist(), 900);
    return () => clearTimeout(t);
  }, [results, persist]);

  const openSession = useCallback(async (id: string) => {
    setSessionsOpen(false);
    try {
      const s = await api.getPackSession(id);
      const loaded: ResultTile[] = (s.data.results ?? []).map((r) => ({ id: nextId(), status: "success" as const, image: r.image, prompt: r.prompt }));
      setResults(loaded);
      historyRef.current = (s.data.history ?? []).slice();
      firstReqRef.current = s.title;
      sessionIdRef.current = s.id;
      setSessionId(s.id);
      setSessionTitle(s.title);
      setClarify(null);
      setComposer("");
      setPendingRefs([]);
    } catch {
      setToast(pt(language, "sessionLoadFailed"));
    }
  }, [language]);

  const newSession = useCallback(() => {
    setSessionsOpen(false);
    setResults([]);
    historyRef.current = [];
    firstReqRef.current = "";
    sessionIdRef.current = null;
    setSessionId(null);
    setSessionTitle("");
    setClarify(null);
    setComposer("");
    setPendingRefs([]);
  }, []);

  const commitRename = useCallback(async () => {
    const t = renameVal.trim().slice(0, 120);
    setRenaming(false);
    if (!t || !sessionIdRef.current) return;
    setSessionTitle(t);
    try {
      await api.updatePackSession(sessionIdRef.current, { title: t });
      refreshSessions();
    } catch {
      /* ignore */
    }
  }, [renameVal, refreshSessions]);

  const deleteSession = useCallback(
    async (id: string) => {
      try {
        await api.deletePackSession(id);
      } catch {
        /* ignore */
      }
      if (sessionIdRef.current === id) newSession();
      refreshSessions();
    },
    [newSession, refreshSessions],
  );

  const models = (pack.mockup_models?.length ? pack.mockup_models : pack.models) ?? [];
  const qualityOptions = models.find((m) => m.id === popModel)?.quality_options ?? [];
  // Aspect-ratio choices for the CURRENTLY selected model (grok ratios vs
  // gpt-image sizes); falls back to the pack-level list.
  const aspectOptions = aspectOptionsFor(pack, popModel);
  const popTotal = popEstimate?.total ?? 0;
  const popBalanceAfter = credits === null ? null : Math.max(0, Number((credits - popTotal).toFixed(4)));
  const popInsufficient = credits !== null && popTotal > credits;
  const canSend = !planning && !busy && !mockupLoading && (composer.trim().length > 0 || pendingRefs.length > 0);
  const heroExample = variant?.hero_example_url || pack.hero_example_url || "";

  // Studio accent = the periwinkle packs-studio color (see BRAND), not the
  // per-pack craft hue, so chrome (change-mockup link, sessions, help, spinner,
  // image ring) and the confirm modal all match the composer's send button.
  const accent = BRAND;
  const mix = (pct: number) => `color-mix(in srgb, ${accent} ${pct}%, transparent)`;
  const accentVars = {
    "--accent": accent,
    "--accent-10": mix(10),
    "--accent-15": mix(15),
    "--accent-20": mix(20),
    "--accent-30": mix(30),
    "--accent-40": mix(40),
    "--accent-60": mix(60),
  } as CSSProperties;

  return (
    <div style={accentVars} className="flex min-h-0 flex-1 flex-col gap-2">
      {/* slim context row — mockup + session controls (minimal chrome, no band) */}
      <div className="flex items-center gap-2.5 px-1.5 py-0.5">
        {variant && (
          <>
            <div className="hidden h-8 w-8 shrink-0 overflow-hidden rounded-lg ring-1 ring-white/10 sm:block">
              <AuthenticatedImage
                src={variant.thumbnail_url || variant.hero_example_url || ""}
                alt={variant.title}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="max-w-[42%] min-w-0 shrink-0 leading-tight">
              <p className="truncate text-[12px] font-semibold text-white">{variant.title}</p>
              {onChangeMockup && (
                <button
                  type="button"
                  onClick={onChangeMockup}
                  className="whitespace-nowrap text-[11px] text-[color:var(--accent)] transition hover:brightness-110"
                >
                  ‹ {pt(language, "changeMockup")}
                </button>
              )}
            </div>
            <div className="mx-1 hidden h-6 w-px bg-white/10 sm:block" />
          </>
        )}
        {renaming ? (
          <input
            value={renameVal}
            autoFocus
            onChange={(e) => setRenameVal(e.target.value)}
            onBlur={() => void commitRename()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            maxLength={120}
            className="min-w-0 flex-1 rounded-lg border border-[color:var(--accent-40)] bg-[#111826] px-2 py-1 text-sm text-white focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setRenameVal(sessionTitle || "");
              setRenaming(true);
            }}
            disabled={!sessionId}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-white transition hover:text-[color:var(--accent)] disabled:cursor-default disabled:text-[#606d8a]"
            title={sessionId ? pt(language, "rename") : ""}
          >
            <span className="truncate">{sessionTitle || pt(language, "untitledSession")}</span>
            {sessionId && <span className="material-symbols-outlined text-[14px] text-[#606d8a]">edit</span>}
          </button>
        )}
        <div className="ms-auto flex items-center gap-1.5">
          <div className="relative">
            <button
              type="button"
              onClick={() => setSessionsOpen((o) => !o)}
              className="flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-[#aebbe0] transition hover:border-white/20"
            >
              <span className="material-symbols-outlined text-[16px]">history</span>
              <span className="hidden sm:inline">{pt(language, "sessions")}</span>
              <span className="material-symbols-outlined text-[16px]">expand_more</span>
            </button>
            {sessionsOpen && (
              <div className="absolute end-0 top-full z-30 mt-1 max-h-80 w-64 overflow-y-auto rounded-xl border border-white/10 bg-[#141b2d] p-1 shadow-xl">
                {sessions.length === 0 ? (
                  <p className="p-3 text-xs text-[#606d8a]">{pt(language, "noSessions")}</p>
                ) : (
                  sessions.map((s) => (
                    <div key={s.id} className="group/se flex items-center gap-2 rounded-lg p-1.5 hover:bg-white/5">
                      <button type="button" onClick={() => void openSession(s.id)} className="flex min-w-0 flex-1 items-center gap-2 text-start">
                        <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-[#0e1525]">
                          {s.thumbnail ? (
                            <AuthenticatedImage src={s.thumbnail} alt={s.title} className="h-full w-full object-cover" />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center text-[#42506f]">
                              <span className="material-symbols-outlined text-[16px]">image</span>
                            </span>
                          )}
                        </div>
                        <span className={`flex-1 truncate text-sm ${s.id === sessionId ? "font-semibold text-[color:var(--accent)]" : "text-[#cdd6f4]"}`}>{s.title}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteSession(s.id)}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[#606d8a] opacity-0 transition hover:text-rose-300 group-hover/se:opacity-100"
                        title={pt(language, "delete")}
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={newSession}
            className="flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-[#aebbe0] transition hover:border-white/20"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            <span className="hidden sm:inline">{pt(language, "newSession")}</span>
          </button>
        </div>
      </div>

      {/* canvas + floating command bar (bar overlays the gallery, translucent so the images behind it tint through) */}
      <div className="relative min-h-0 flex-1">
        {/* floating command bar — pinned near the top, over the gallery */}
        <div ref={barWrapRef} className="pointer-events-none absolute inset-x-0 top-3 z-20 flex flex-col items-center gap-2 px-2">
          {clarify && (
            <div className="pointer-events-auto flex w-full max-w-xl items-start gap-2 rounded-2xl border border-[color:var(--accent-30)] bg-[color:var(--accent-10)] px-3.5 py-2.5 text-sm backdrop-blur-md">
              <span className="material-symbols-outlined text-[18px] text-[color:var(--accent)]">help</span>
              <span className="text-[#dfe4f2]">{clarify}</span>
            </div>
          )}
          <div
            className={`pack-composer ${planning ? "is-thinking" : ""} pointer-events-auto relative w-full max-w-xl rounded-2xl bg-[#151f38]/70 p-2 shadow-[0_1px_0_0_rgba(255,255,255,.06)_inset,0_20px_60px_-14px_rgba(0,0,0,.85)] backdrop-blur-xl transition focus-within:bg-[#151f38]/85`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {charging && <span key={chargeKey} className="pack-composer__charge" aria-hidden="true" />}
            {isDragOver && (
              <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-[#a5b4fc]/70 bg-[#0c1324]/90">
                <span className="material-symbols-outlined text-2xl text-[#a5b4fc]">add_photo_alternate</span>
                <p className="text-xs font-semibold text-[#dfe4f2]">{pt(language, "dropImagesHere")}</p>
              </div>
            )}
            {(mockupRef || mockupLoading || pendingRefs.length > 0) && (
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5 px-1">
                {mockupLoading && <span className="text-[11px] text-[#606d8a]">{pt(language, "loading")}</span>}
                {mockupRef && useMockup && (
                  <div
                    className="relative h-9 w-9 shrink-0 overflow-hidden rounded-[10px] ring-1 ring-[color:var(--accent-60)]"
                    title={pt(language, "mockupChip")}
                  >
                    <AuthenticatedImage src={mockupRef.url ?? ""} alt={pt(language, "sceneLabel")} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setUseMockup(false)}
                      aria-label={pt(language, "mockupOff")}
                      className="absolute end-0 top-0 flex h-4 w-4 items-center justify-center rounded-bl bg-black/70 text-[10px] text-white"
                    >
                      ×
                    </button>
                  </div>
                )}
                {mockupRef && !useMockup && (
                  <button
                    type="button"
                    onClick={() => setUseMockup(true)}
                    className="flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-[#93a0bd] transition hover:bg-white/10"
                  >
                    <span className="material-symbols-outlined text-[14px]">wallpaper</span>
                    {pt(language, "mockupOff")}
                  </button>
                )}
                {pendingRefs.map((r, i) => (
                  <div key={r.file_id ?? r.url ?? i} className="relative h-9 w-9 shrink-0 overflow-hidden rounded-[10px] ring-1 ring-white/10">
                    <AuthenticatedImage src={r.url ?? ""} alt="ref" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setPendingRefs((prev) => prev.filter((_, idx) => idx !== i))}
                      className="absolute end-0 top-0 flex h-4 w-4 items-center justify-center rounded-bl bg-black/70 text-[10px] text-white"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-1.5">
              {pendingRefs.length < designSlots && (
                <div className="relative">
                  <button
                    type="button"
                    aria-expanded={pickerOpen}
                    onClick={() => setPickerOpen((o) => !o)}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] transition hover:bg-white/5 hover:text-white ${
                      pickerOpen ? "bg-white/10 text-white" : "text-[#93a0bd]"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[22px]">add</span>
                  </button>
                  <RefPicker
                    open={pickerOpen}
                    onClose={() => setPickerOpen(false)}
                    language={language}
                    isRtl={isRtl}
                    uid={uid}
                    room={designSlots - pendingRefs.length}
                    busyUrl={pickerBusyUrl}
                    onPickGallery={(url) => void pickFromGallery(url)}
                    onPickUpload={pickFromUploads}
                    onFiles={(files) => void addFiles(files)}
                    onDropRefUrl={(url) => useFromThread({ url, name: "previous result" })}
                  />
                </div>
              )}
              {planning ? (
                <ThinkingLabel text={pt(language, "thinking")} />
              ) : (
                <textarea
                  ref={textareaRef}
                  value={composer}
                  onChange={(e) => setComposer(e.target.value.slice(0, MAX_COMPOSER_CHARS))}
                  onFocus={(e) => {
                    // Touch counterpart to the mount effect: first tap selects the example.
                    if (exampleSelectedRef.current) return;
                    exampleSelectedRef.current = true;
                    e.currentTarget.select();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (canSend) void send();
                    }
                  }}
                  onPaste={handlePaste}
                  rows={1}
                  maxLength={MAX_COMPOSER_CHARS}
                  placeholder={pt(language, "chatPlaceholder")}
                  className="flex-1 resize-none self-end bg-transparent px-1.5 py-2 text-sm text-white placeholder:text-[#606d8a] focus:outline-none"
                />
              )}
              <button
                type="button"
                disabled={!canSend}
                onClick={() => void send()}
                className="pack-cta flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                {planning ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#0d1320]/40 border-t-[#0d1320]" />
                ) : (
                  <span className="material-symbols-outlined text-[20px]">arrow_upward</span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* results gallery fills the whole canvas; the bar floats translucent on top of it.
            paddingTop reserves exactly the bar's live height so scrolling to the
            top always clears the first row instead of trapping it under the bar. */}
        <div ref={galleryRef} className="absolute inset-0 overflow-y-auto rounded-2xl px-1.5 pb-4" style={{ paddingTop: barClearance }}>
        {results.length === 0 ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-5 px-6 text-center">
            {heroExample ? (
              <div className="relative">
                <div className="h-40 w-40 overflow-hidden rounded-2xl ring-1 ring-white/10 shadow-[0_18px_50px_-14px_rgba(0,0,0,.75)]">
                  <AuthenticatedImage src={heroExample} alt={variant?.title || pack.title} className="h-full w-full object-cover" />
                </div>
                <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/10 bg-[#0d1320] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[#93a0bd]">
                  {pt(language, "sceneLabel")}
                </span>
              </div>
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/[.04] ring-1 ring-white/10">
                <span className="material-symbols-outlined text-4xl text-[color:var(--accent)]">auto_awesome</span>
              </div>
            )}
            <div className="max-w-sm">
              <h3 className={`text-lg font-bold text-white ${displayClass}`}>{pt(language, "studioBegin")}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-[#93a0bd]">
                {pt(language, heroExample ? "studioEmptyHint" : "chatEmpty")}
              </p>
            </div>
          </div>
        ) : (
          <div className="gap-1.5 [column-fill:_balance] columns-2 sm:columns-3 xl:columns-4">
            {results.map((t) => (
              <div
                key={t.id}
                onDragStart={(e) => {
                  if (t.status === "success" && t.image) e.dataTransfer.setData(REF_DND_TYPE, t.image);
                }}
                className="group relative mb-1.5 block break-inside-avoid overflow-hidden rounded-sm border border-white/[.08] bg-[#141b2b] animate-fade-in-up"
              >
                {t.status === "generating" ? (
                  <PackGeneratingTile expectedSeconds={t.expectedSeconds ?? LATENCY_FALLBACK_SECONDS} />
                ) : t.status === "success" && t.image ? (
                  <>
                    <InteractiveAuthenticatedImage
                      src={t.image}
                      alt={pack.title}
                      zoomOnClick
                      wrapperClassName="w-full"
                      imageClassName="block h-auto w-full max-h-[55vh] object-cover"
                      loadingClassName="relative flex aspect-square w-full items-center justify-center overflow-hidden bg-[#0f1626]"
                      loadingNode={<PackImageSkeleton />}
                      errorClassName="flex aspect-square w-full items-center justify-center text-xs text-[#8a96b8]"
                    />
                    <button
                      type="button"
                      onClick={() => useFromThread({ url: t.image!, name: "previous result" })}
                      title={pt(language, "useInNext")}
                      className="absolute bottom-2 left-2 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white opacity-0 backdrop-blur transition group-hover:opacity-100 hover:bg-black/75"
                    >
                      <span className="material-symbols-outlined text-[18px]">add_photo_alternate</span>
                    </button>
                  </>
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center p-3 text-center text-xs text-[#8a96b8]">{pt(language, "tileFailed")}</div>
                )}
              </div>
            ))}
          </div>
        )}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 start-1/2 z-50 -translate-x-1/2 rounded-xl border border-white/10 bg-[#1a2238] px-4 py-2.5 text-sm text-white shadow-xl">{toast}</div>
      )}

      {/* confirm pop-up — agent summary + editable params + cost */}
      {confirmOpen && plan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-white/10 bg-[#141b2d] p-4">
            <p className="text-base font-semibold text-white">{pt(language, "reviewPlan")}</p>
            <div className="mt-2.5 rounded-xl bg-[#111826] p-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#606d8a]">{pt(language, "planSummaryLabel")}</p>
              <p className="mt-1 text-sm text-[#cdd6f4]">{plan.summary || plan.final_prompt}</p>
            </div>
            {models.length > 1 && (
              <div className="mt-3">
                <ModelPicker
                  models={models}
                  value={popModel ?? ""}
                  recommended={popRecommendedModel}
                  language={language}
                  onSelect={(id) => {
                    setPopModel(id);
                    const q = models.find((m) => m.id === id)?.quality_options ?? [];
                    setPopQuality((prev) => (prev && q.includes(prev) ? prev : q[0] ?? null));
                    // Ratio options differ per model; keep the current value only
                    // if the new model accepts it, else use its default.
                    const a = aspectOptionsFor(pack, id);
                    setPopAspect((prev) => (prev && a.includes(prev) ? prev : a[0] ?? ""));
                  }}
                />
              </div>
            )}
            {aspectOptions.length > 0 && (
              <div className="mt-3">
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#606d8a]">
                  {pt(language, aspectFieldKey(aspectOptions))}
                </label>
                <AspectShapePicker options={aspectOptions} value={popAspect} onChange={setPopAspect} />
              </div>
            )}
            {qualityOptions.length > 0 && (
              <div className="mt-3">
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#606d8a]">{pt(language, "quality")}</label>
                <div className="flex flex-wrap gap-2">
                  {qualityOptions.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setPopQuality(q)}
                      className={`cursor-pointer rounded-xl border px-3 py-1.5 text-sm transition ${popQuality === q ? "border-[color:var(--accent)] bg-[color:var(--accent-15)] font-semibold text-[color:var(--accent)]" : "border-white/10 bg-[#111826] text-[#aebbe0] hover:border-white/20"}`}
                    >
                      {qualityLabel(language, q)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-3 flex items-center justify-between rounded-xl border border-[color:var(--accent-30)] bg-[#141b2b] p-2.5">
              <div>
                <p className="text-sm text-[#aebbe0]">{pt(language, "willCost")}</p>
                {popBalanceAfter !== null && (
                  <p className="text-xs text-[#606d8a]">
                    {pt(language, "balanceAfter")} {fmtNum(language, popBalanceAfter)}
                  </p>
                )}
              </div>
              <p className="text-xl font-extrabold text-[color:var(--accent)]">{popEstimating ? "…" : fmtNum(language, popTotal)}</p>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmOpen(false)} className="rounded-lg px-4 py-2 text-sm text-[#aebbe0] hover:bg-white/5">
                {pt(language, "cancel")}
              </button>
              <button
                type="button"
                disabled={busy || popEstimating || popInsufficient}
                onClick={() => void confirmGenerate()}
                className="pack-cta rounded-lg px-4 py-2 text-sm font-bold hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              >
                {popInsufficient ? pt(language, "notEnough") : `${pt(language, "confirm")} →`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
