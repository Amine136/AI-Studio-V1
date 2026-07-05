"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, isContentBlockedError, isNetworkError } from "../../../services/api";
import { useAuth } from "../../../context/AuthContext";
import { addHistoryEntry } from "../../../lib/history";
import InteractiveAuthenticatedImage from "../../../components/InteractiveAuthenticatedImage";
import AuthenticatedImage from "../../../components/AuthenticatedImage";
import {
  getUploadConstraints,
  preferredOutputType,
  readImageDimensions,
  type UploadImageConstraints,
} from "../../../lib/imageInputConstraints";
import type { InputImagePayload, PackChatTurn, PackDetail, PackEstimate, PackPlan, PackSessionData, PackSessionMeta, PackVariant } from "../../../types";
import type { Language } from "../../../context/LanguageContext";
import { CRAFT_HEX, fmtNum, pt, qualityLabel } from "../packsShared";
import type { CSSProperties } from "react";

// Editing/image-input models accept at most 3 source images.
const MAX_REFS = 3;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
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
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))), mimeType, quality);
  });
}
async function normalizeUploadImage(file: File, constraints: UploadImageConstraints): Promise<File> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageFromUrl(objectUrl);
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

// A generation result shown in the gallery (no chat text is rendered).
type ResultTile = { id: string; status: "generating" | "success" | "error"; image?: string; prompt?: string };

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
  const isRtl = language === "ar";
  const displayClass = isRtl ? "" : "font-['Bricolage_Grotesque']";

  const [results, setResults] = useState<ResultTile[]>([]);
  const [composer, setComposer] = useState("");
  const [pendingRefs, setPendingRefs] = useState<InputImagePayload[]>([]);
  const [credits, setCredits] = useState<number | null>(null);
  const [planning, setPlanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [clarify, setClarify] = useState<string | null>(null);
  const awaitingClarify = clarify !== null;

  // Composer "charge" burst — mirrors the studio chat composer: a bright arc
  // sweeps the border a few laps then settles into the idle aurora ring.
  // Plays once on open and again on every send. chargeKey bumps so the
  // overlay remounts and the CSS animation restarts cleanly.
  const [packComposerCharging, setPackComposerCharging] = useState(false);
  const [chargeKey, setChargeKey] = useState(0);
  const chargeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runPackComposerCharge = useCallback(() => {
    setChargeKey((k) => k + 1);
    setPackComposerCharging(true);
    if (chargeTimerRef.current) clearTimeout(chargeTimerRef.current);
    chargeTimerRef.current = setTimeout(() => setPackComposerCharging(false), 2600);
  }, []);
  useEffect(() => {
    runPackComposerCharge();
    return () => {
      if (chargeTimerRef.current) clearTimeout(chargeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const [popAspect, setPopAspect] = useState<string>("");
  const [popQuality, setPopQuality] = useState<string | null>(null);
  const [popEstimate, setPopEstimate] = useState<PackEstimate | null>(null);
  const [popEstimating, setPopEstimating] = useState(false);

  const galleryRef = useRef<HTMLDivElement | null>(null);

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
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error("mockup fetch failed");
        const blob = await resp.blob();
        const raw = new File([blob], `mockup-${variant?.id ?? "scene"}.png`, { type: blob.type || "image/png" });
        const file = await normalizeUploadImage(raw, UNIVERSAL_INPUT_CONSTRAINTS);
        const up = await api.uploadInputImage(file);
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
  }, [variant?.id, variant?.thumbnail_url, variant?.hero_example_url]);

  const mockupActive = Boolean(mockupRef) && useMockup;
  const designSlots = MAX_REFS - (mockupActive ? 1 : 0);

  const addFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const room = designSlots - pendingRefs.length;
      const slice = Array.from(files).slice(0, Math.max(0, room));
      const validate = getUploadConstraints(undefined);
      for (const original of slice) {
        try {
          if (!["image/png", "image/jpeg", "image/webp"].includes(original.type)) throw new Error("Only PNG, JPEG, and WEBP images are supported.");
          if (original.size > MAX_UPLOAD_BYTES) throw new Error("Each image must be 10 MB or smaller.");
          const { width, height } = await readImageDimensions(original);
          if (Math.min(width, height) < validate.minDim) throw new Error(`Image too small — at least ${validate.minDim}px on the shortest side.`);
          const file = await normalizeUploadImage(original, UNIVERSAL_INPUT_CONSTRAINTS);
          const res = await api.uploadInputImage(file);
          setPendingRefs((prev) => [...prev, { file_id: res.id, name: res.name, mime_type: res.mime_type, url: res.url }]);
        } catch (e) {
          setToast(e instanceof Error ? e.message : "Upload failed");
        }
      }
    },
    [designSlots, pendingRefs.length],
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
      if (res.status === "moderation_unavailable") {
        setToast(pt(language, "moderationUnavailable"));
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
      setToast(isContentBlockedError(e) ? pt(language, "blocked") : e instanceof Error ? e.message : "Failed");
    } finally {
      setPlanning(false);
    }
  }, [composer, pendingRefs, clarify, awaitingClarify, mockupRef, pack, language, variant]);

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
    setResults((prev) => [{ id: tileId, status: "generating", prompt: plan.final_prompt }, ...prev]);
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
      setToast(isContentBlockedError(e) ? pt(language, "blocked") : e instanceof Error ? e.message : "Generation failed");
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

  // Per-pack craft accent (replaces the old global amber) exposed as CSS vars so
  // the studio's highlights match the pack's color across the whole ecosystem.
  const accent = CRAFT_HEX[pack.capability] ?? "#8fa0c4";
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
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[12px] font-semibold text-white">{variant.title}</p>
              {onChangeMockup && (
                <button
                  type="button"
                  onClick={onChangeMockup}
                  className="text-[11px] text-[color:var(--accent)] transition hover:brightness-110"
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
            className="flex min-w-0 items-center gap-1.5 text-sm text-white transition hover:text-[color:var(--accent)] disabled:cursor-default disabled:text-[#606d8a]"
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
              <div className="absolute end-0 top-full z-20 mt-1 max-h-80 w-64 overflow-y-auto rounded-xl border border-white/10 bg-[#141b2d] p-1 shadow-xl">
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

      {/* canvas + floating command bar (bar overlays the gallery, à la playground) */}
      <div className="relative min-h-0 flex-1">
        <div ref={galleryRef} className="absolute inset-0 overflow-y-auto rounded-2xl px-1.5 pt-1 pb-32">
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
          <div className="gap-3 [column-fill:_balance] columns-2 sm:columns-3 xl:columns-4">
            {results.map((t) => (
              <div key={t.id} className="group relative mb-3 block break-inside-avoid overflow-hidden rounded-2xl border border-white/[.08] bg-[#141b2b]">
                {t.status === "generating" ? (
                  <div className="flex aspect-square w-full items-center justify-center">
                    <div className="h-9 w-9 animate-spin rounded-full border-2 border-[color:var(--accent-30)] border-t-[color:var(--accent)]" />
                  </div>
                ) : t.status === "success" && t.image ? (
                  <>
                    <InteractiveAuthenticatedImage
                      src={t.image}
                      alt={pack.title}
                      wrapperClassName="w-full"
                      imageClassName="block h-auto w-full"
                      loadingClassName="flex aspect-square w-full items-center justify-center text-xs text-[#606d8a]"
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

        {/* floating compact command bar — centered over the gallery, attachments inline */}
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex flex-col items-center gap-2 px-2">
          {clarify && (
            <div className="pointer-events-auto flex w-full max-w-xl items-start gap-2 rounded-2xl border border-[color:var(--accent-30)] bg-[color:var(--accent-10)] px-3.5 py-2.5 text-sm backdrop-blur-md">
              <span className="material-symbols-outlined text-[18px] text-[color:var(--accent)]">help</span>
              <span className="text-[#dfe4f2]">{clarify}</span>
            </div>
          )}
          <div className="pack-composer pointer-events-auto w-full max-w-xl rounded-[26px] border border-white/10 bg-[#0f1728]/95 p-2 shadow-[0_18px_50px_-12px_rgba(0,0,0,.7)] backdrop-blur-xl transition focus-within:border-[color:var(--accent-40)] focus-within:shadow-[0_0_0_3px_var(--accent-15)]">
            {packComposerCharging ? <span key={chargeKey} className="pack-composer__charge" aria-hidden="true" /> : null}
            {(mockupRef || mockupLoading || pendingRefs.length > 0) && (
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5 px-1">
                {mockupLoading && <span className="text-[11px] text-[#606d8a]">{pt(language, "loading")}</span>}
                {mockupRef && useMockup && (
                  <div
                    className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg ring-1 ring-[color:var(--accent-60)]"
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
                  <div key={r.file_id ?? r.url ?? i} className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg ring-1 ring-white/10">
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
                <label className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-[#93a0bd] transition hover:bg-white/5 hover:text-white">
                  <span className="material-symbols-outlined text-[22px]">add</span>
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => void addFiles(e.target.files)} />
                </label>
              )}
              <textarea
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (canSend) {
                      runPackComposerCharge();
                      void send();
                    }
                  }
                }}
                rows={1}
                placeholder={pt(language, "chatPlaceholder")}
                className="max-h-32 flex-1 resize-none self-center bg-transparent px-1.5 py-2 text-sm text-white placeholder:text-[#606d8a] focus:outline-none"
              />
              <button
                type="button"
                disabled={!canSend}
                onClick={() => {
                  runPackComposerCharge();
                  void send();
                }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--accent)] text-[#0d1320] shadow-[0_4px_14px_-2px_var(--accent-60)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
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
      </div>

      {toast && (
        <div className="fixed bottom-6 start-1/2 z-50 -translate-x-1/2 rounded-xl border border-white/10 bg-[#1a2238] px-4 py-2.5 text-sm text-white shadow-xl">{toast}</div>
      )}

      {/* confirm pop-up — agent summary + editable params + cost */}
      {confirmOpen && plan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-[#141b2d] p-5">
            <p className="text-base font-semibold text-white">{pt(language, "reviewPlan")}</p>
            <div className="mt-3 rounded-xl bg-[#111826] p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#606d8a]">{pt(language, "planSummaryLabel")}</p>
              <p className="mt-1 text-sm text-[#cdd6f4]">{plan.summary || plan.final_prompt}</p>
            </div>
            {models.length > 1 && (
              <div className="mt-4">
                <label className="mb-1.5 block text-sm font-medium text-[#cdd6f4]">{pt(language, "model")}</label>
                <div className="flex flex-wrap gap-2">
                  {models.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setPopModel(m.id);
                        const q = m.quality_options ?? [];
                        setPopQuality((prev) => (prev && q.includes(prev) ? prev : q[0] ?? null));
                        // Ratio options differ per model; keep the current value
                        // only if the new model accepts it, else use its default.
                        const a = aspectOptionsFor(pack, m.id);
                        setPopAspect((prev) => (prev && a.includes(prev) ? prev : a[0] ?? ""));
                      }}
                      className={`rounded-xl border px-3 py-2 text-sm transition ${popModel === m.id ? "border-[color:var(--accent)] bg-[color:var(--accent-15)] font-semibold text-[color:var(--accent)]" : "border-white/10 bg-[#111826] text-[#aebbe0] hover:border-white/20"}`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-4">
              <label className="mb-1.5 block text-sm font-medium text-[#cdd6f4]">{pt(language, "aspectRatio")}</label>
              <select
                value={popAspect}
                onChange={(e) => setPopAspect(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-[#111826] px-3 py-2.5 text-sm text-white focus:border-[color:var(--accent-60)] focus:outline-none"
              >
                {aspectOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            {qualityOptions.length > 0 && (
              <div className="mt-4">
                <label className="mb-1.5 block text-sm font-medium text-[#cdd6f4]">{pt(language, "quality")}</label>
                <div className="flex flex-wrap gap-2">
                  {qualityOptions.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setPopQuality(q)}
                      className={`rounded-xl border px-3 py-2 text-sm transition ${popQuality === q ? "border-[color:var(--accent)] bg-[color:var(--accent-15)] font-semibold text-[color:var(--accent)]" : "border-white/10 bg-[#111826] text-[#aebbe0] hover:border-white/20"}`}
                    >
                      {qualityLabel(language, q)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-4 flex items-center justify-between rounded-xl border border-[color:var(--accent-30)] bg-[#141b2b] p-3">
              <div>
                <p className="text-sm text-[#aebbe0]">{pt(language, "willCost")}</p>
                {popBalanceAfter !== null && (
                  <p className="text-xs text-[#606d8a]">
                    {pt(language, "balanceAfter")} {fmtNum(language, popBalanceAfter)}
                  </p>
                )}
              </div>
              <p className="text-2xl font-extrabold text-[color:var(--accent)]">{popEstimating ? "…" : fmtNum(language, popTotal)}</p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmOpen(false)} className="rounded-lg px-4 py-2 text-sm text-[#aebbe0] hover:bg-white/5">
                {pt(language, "cancel")}
              </button>
              <button
                type="button"
                disabled={busy || popEstimating || popInsufficient}
                onClick={() => void confirmGenerate()}
                className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-bold text-[#0d1320] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
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
