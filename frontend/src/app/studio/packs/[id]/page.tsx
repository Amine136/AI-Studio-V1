"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AuthenticatedImage, { fetchAuthenticatedAsset } from "../../../../components/AuthenticatedImage";
import InteractiveAuthenticatedImage from "../../../../components/InteractiveAuthenticatedImage";
import { api, isContentBlockedError } from "../../../../services/api";
import { useAuth } from "../../../../context/AuthContext";
import { useLanguage } from "../../../../context/LanguageContext";
import type { InputImagePayload, PackDetail, PackEstimate, PackPlan, PackTile, PackVariant } from "../../../../types";
import { addHistoryEntry } from "../../../../lib/history";
import { CAPABILITY_GLYPH, CRAFT_HEX, aspectFieldKey, capabilityLabel, fmtNum, pt, qualityLabel } from "../packsShared";
import AspectShapePicker from "../AspectShapePicker";
import ModelPicker from "../ModelPicker";
import { getUploadConstraints, preferredOutputType, readImageDimensions, type UploadImageConstraints } from "../../../../lib/imageInputConstraints";
import PackChat from "./PackChat";

type UITile = Omit<PackTile, "status"> & { status: PackTile["status"] | "generating" };

// Editing/image-input models accept at most 3 source images (mirrors the backend
// MAX_EDITING_INPUT_IMAGES). The studio caps uploads there so a multi-reference
// request never 400s.
const MAX_REFS = 3;

// Client-side image normalization, identical to Smart Create / Plain Chat: shrink
// each photo in the browser BEFORE upload so payloads stay small (the server-side
// downscaler is the backstop). 768px longest side, re-encoded to <=120 KB.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_PROXY_IMAGE_DIMENSION = 768;
const MAX_PROXY_IMAGE_BYTES = 120_000;
// The pack's image model is chosen by the agent AFTER upload, so normalize against
// the strictest cross-provider rules (PNG/JPEG only, largest min-dimension) so the
// result stays compatible with whichever model is picked.
const UNIVERSAL_INPUT_CONSTRAINTS: UploadImageConstraints = {
  maxImages: MAX_REFS,
  minDim: 256,
  formats: ["image/png", "image/jpeg"],
};

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

// Per-pack sticky overrides: once a user changes model/ratio/quality for a pack,
// remember that choice (user override > agent recommendation > default).
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
    /* ignore quota / private-mode errors */
  }
}

// Aspect-ratio options follow the SELECTED model: each model accepts its own
// vocabulary (grok ratio strings like "3:2" vs gpt-image pixel sizes like
// "1024x1024"). Falls back to the pack-level list for models that don't declare
// their own (or before a model is chosen).
function aspectOptionsFor(
  pack: PackDetail | null,
  modelId: string | undefined,
): string[] {
  const fromModel = pack?.models?.find((m) => m.id === modelId)?.aspect_ratios;
  if (fromModel && fromModel.length) return fromModel;
  return pack?.aspect_ratios ?? [];
}

export default function PackDetailPage() {
  const params = useParams();
  const packId = String(params?.id ?? "");
  const { user } = useAuth();
  const { language, isRtl } = useLanguage();

  const [pack, setPack] = useState<PackDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);

  const [slotValues, setSlotValues] = useState<Record<string, string>>({});
  const [imageRefs, setImageRefs] = useState<InputImagePayload[]>([]);
  const [variantId, setVariantId] = useState<string | null>(null);
  // The chosen mockup template, uploaded as a reference image so the model
  // reproduces the EXACT scene and we replace its placeholder with the design.
  const [mockupRef, setMockupRef] = useState<InputImagePayload | null>(null);
  const [mockupLoading, setMockupLoading] = useState(false);

  // ---- planning agent (the free step before generation) ----
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<PackPlan | null>(null);
  const [clarify, setClarify] = useState<string | null>(null);
  const [clarifyAnswer, setClarifyAnswer] = useState("");

  // ---- confirm pop-up (the only place params surface) ----
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [popModel, setPopModel] = useState<string | undefined>(undefined);
  // The agent's recommended model — collapsed model list leads with it, shown gold.
  const [popRecommendedModel, setPopRecommendedModel] = useState<string | null>(null);
  const [popAspect, setPopAspect] = useState<string>("");
  const [popQuality, setPopQuality] = useState<string | null>(null);
  const [popEstimate, setPopEstimate] = useState<PackEstimate | null>(null);
  const [popEstimating, setPopEstimating] = useState(false);

  // ---- results ----
  const [phase, setPhase] = useState<"form" | "results">("form");
  const [tiles, setTiles] = useState<UITile[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Params + unit price of the last confirmed generation, reused by variant/resize.
  const lastGenRef = useRef<{ model?: string; aspect?: string; quality?: string | null; prompt?: string }>({});
  const [lastUnit, setLastUnit] = useState(0);

  // ---- load pack + profile ----
  useEffect(() => {
    let cancelled = false;
    api
      .getPack(packId, language)
      .then((p) => {
        if (cancelled) return;
        setPack(p);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e?.message ?? "Failed to load pack");
      });
    return () => {
      cancelled = true;
    };
  }, [packId, language]);

  // Deep-link: /studio/packs/<id>?variant=<vid> pre-selects a mockup and jumps
  // straight into the studio (used by the Social gallery, which lists mockups
  // directly instead of category cards). Applied once, after the pack loads.
  const deepLinkedRef = useRef(false);
  useEffect(() => {
    if (deepLinkedRef.current || !pack?.variants?.length) return;
    deepLinkedRef.current = true;
    const vid = new URLSearchParams(window.location.search).get("variant");
    if (vid && pack.variants.some((v) => v.id === vid)) setVariantId(vid);
  }, [pack]);

  const refreshCredits = useCallback(() => {
    api
      .getProfile()
      .then((p) => setCredits(p.credits ?? 0))
      .catch(() => setCredits(null));
  }, []);

  useEffect(() => {
    refreshCredits();
  }, [refreshCredits]);

  // Variant (mockup) picker: a pack with variants opens a gallery first, then the
  // studio. The chosen scene is honored by the agent (sent as variant_id).
  const variants = pack?.variants ?? [];
  const selectedVariant = useMemo(
    () => variants.find((v) => v.id === variantId) ?? null,
    [variants, variantId],
  );
  const needsVariantPick = variants.length > 0 && !selectedVariant;

  // When a mockup variant is picked, upload its template image (shrunk) so it can
  // be sent to the model as image 1 (the exact scene to reproduce). Re-runs on
  // variant change; cleared when no variant is selected.
  useEffect(() => {
    const mockupUrl = selectedVariant?.thumbnail_url || selectedVariant?.hero_example_url || "";
    if (!mockupUrl) {
      setMockupRef(null);
      return;
    }
    let cancelled = false;
    setMockupLoading(true);
    setMockupRef(null);
    void (async () => {
      try {
        const resp = await fetch(mockupUrl);
        if (!resp.ok) throw new Error("mockup fetch failed");
        const blob = await resp.blob();
        const raw = new File([blob], `mockup-${selectedVariant?.id ?? "scene"}.png`, { type: blob.type || "image/png" });
        const file = await normalizeUploadImage(raw, UNIVERSAL_INPUT_CONSTRAINTS);
        const up = await api.uploadInputImage(file);
        if (!cancelled) {
          setMockupRef({ file_id: up.id, name: up.name, mime_type: up.mime_type, url: up.url });
        }
      } catch {
        // Non-fatal: fall back to the text-only mockup scene (agent still honors it).
        if (!cancelled) setMockupRef(null);
      } finally {
        if (!cancelled) setMockupLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedVariant?.id, selectedVariant?.thumbnail_url, selectedVariant?.hero_example_url]);

  // Combined refs sent to the agent + model: mockup template first, then designs.
  const buildSendRefs = useCallback(
    () => (mockupRef ? [mockupRef, ...imageRefs] : [...imageRefs]),
    [mockupRef, imageRefs],
  );

  // Show the image uploader when the pack requires an image, has an image_ref
  // slot, OR is a freeform/studio pack (optional "upload your design").
  const needsImage = useMemo(
    () =>
      Boolean(
        pack &&
          (pack.requires_image_input ||
            pack.kind === "freeform" ||
            pack.slots.some((s) => s.type === "image_ref")),
      ),
    [pack],
  );

  const missingRequired = useMemo(() => {
    if (!pack) return true;
    for (const s of pack.slots) {
      if (s.type === "image_ref") continue;
      if (s.required && !(slotValues[s.key] ?? "").trim()) return true;
    }
    if (pack.requires_image_input && imageRefs.length === 0) return true;
    return false;
  }, [pack, slotValues, imageRefs]);

  // ---- image upload ----
  // The mockup template occupies one of the model's image slots, so leave room.
  const designSlots = MAX_REFS - (mockupRef ? 1 : 0);

  const onUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = designSlots - imageRefs.length;
    const slice = Array.from(files).slice(0, Math.max(0, room));
    // Validate loosely (default min dim); normalize against the strict universal
    // rules. Same pipeline as Smart Create / Plain Chat.
    const validateConstraints = getUploadConstraints(undefined);
    for (const original of slice) {
      try {
        if (!["image/png", "image/jpeg", "image/webp"].includes(original.type)) {
          throw new Error("Only PNG, JPEG, and WEBP images are supported.");
        }
        if (original.size > MAX_UPLOAD_BYTES) {
          throw new Error("Each image must be 10 MB or smaller.");
        }
        const { width, height } = await readImageDimensions(original);
        if (Math.min(width, height) < validateConstraints.minDim) {
          throw new Error(`Image too small — at least ${validateConstraints.minDim}px on the shortest side.`);
        }
        // Shrink in the browser before upload so payloads stay small.
        const file = await normalizeUploadImage(original, UNIVERSAL_INPUT_CONSTRAINTS);
        const res = await api.uploadInputImage(file);
        setImageRefs((prev) => [
          ...prev,
          { file_id: res.id, name: res.name, mime_type: res.mime_type, url: res.url },
        ]);
      } catch (e) {
        setToast(e instanceof Error ? e.message : "Upload failed");
      }
    }
  }, [imageRefs.length, designSlots]);

  // Compose the user's request text from the studio fields. Freeform packs use
  // their free prompt verbatim; structured packs join "label: value" lines.
  const composeUserText = useCallback(() => {
    if (!pack) return "";
    const parts: string[] = [];
    for (const s of pack.slots) {
      if (s.type === "image_ref") continue;
      const v = (slotValues[s.key] ?? "").trim();
      if (!v) continue;
      if (s.type === "select") {
        const o = s.options?.find((opt) => opt.value === v);
        parts.push(`${s.label}: ${o?.label ?? v}`);
      } else if (s.multiline || s.key === "prompt") {
        parts.push(v);
      } else {
        parts.push(`${s.label}: ${v}`);
      }
    }
    return parts.join(". ");
  }, [pack, slotValues]);

  // ---- plan (free): call the agent, then either ask a question or open the
  // confirm pop-up. round 1 may ask; round 2 always returns a plan. ----
  const doPlan = useCallback(
    async (round: number, answer?: string) => {
      if (!pack) return;
      setPlanning(true);
      setToast(null);
      const base = composeUserText();
      const ans = (answer ?? "").trim();
      const text = ans ? (base ? `${base}\n\n${ans}` : ans) : base;
      const sendRefs = buildSendRefs();
      try {
        const res = await api.planPack(packId, {
          text,
          image_refs: sendRefs.length ? sendRefs : undefined,
          lang: language,
          variant_id: variantId ?? undefined,
          round,
          mockup_first: Boolean(mockupRef),
        });
        if (res.status === "needs_clarification") {
          setClarify(res.clarification ?? "");
          setClarifyAnswer("");
          setConfirmOpen(false);
          return;
        }
        const p = res.plan;
        if (!p) return;
        setPlan(p);
        setClarify(null);

        // Initial pop-up params: sticky override > agent recommendation > default.
        const sticky = readSticky(packId);
        const models = pack.models ?? [];
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
          sticky?.quality && qOpts.includes(sticky.quality)
            ? sticky.quality
            : p.quality && qOpts.includes(p.quality)
              ? p.quality
              : qOpts[0] ?? null;

        setPopModel(initModel);
        setPopRecommendedModel(validModel(p.model) ?? initModel ?? null);
        setPopAspect(initAspect);
        setPopQuality(initQuality);
        setPopEstimate(res.estimate ?? null);
        setConfirmOpen(true);
      } catch (e) {
        setToast(
          isContentBlockedError(e) ? pt(language, "blocked") : e instanceof Error ? e.message : "Failed",
        );
      } finally {
        setPlanning(false);
      }
    },
    [pack, packId, composeUserText, buildSendRefs, mockupRef, language, variantId],
  );

  const onGenerateClick = useCallback(() => {
    if (missingRequired) {
      setToast(pt(language, "fillRequired"));
      return;
    }
    void doPlan(1);
  }, [missingRequired, language, doPlan]);

  // ---- live re-estimate while the pop-up is open and the user edits params ----
  useEffect(() => {
    if (!confirmOpen || !pack || !popModel) return;
    let cancelled = false;
    setPopEstimating(true);
    api
      .estimatePack(packId, {
        n: 1,
        aspect_ratio: popAspect || undefined,
        has_image: imageRefs.length > 0 || Boolean(mockupRef),
        model: popModel,
        quality: popQuality ?? undefined,
      })
      .then((e) => {
        if (!cancelled) setPopEstimate(e);
      })
      .catch(() => {
        /* keep the last estimate on a transient failure */
      })
      .finally(() => {
        if (!cancelled) setPopEstimating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [confirmOpen, packId, popModel, popAspect, popQuality, imageRefs.length, mockupRef, pack]);

  // ---- generate (one image; variant/resize reuse the last confirmed params) ----
  const runGenerate = useCallback(
    async (opts: { model?: string; aspect?: string; quality?: string | null; prompt_override?: string; append?: boolean }) => {
      if (!pack) return;
      const append = opts.append ?? false;
      const useModel = opts.model ?? lastGenRef.current.model;
      const useAspect = opts.aspect ?? lastGenRef.current.aspect;
      const useQuality = opts.quality ?? lastGenRef.current.quality ?? null;
      const usePrompt = opts.prompt_override ?? lastGenRef.current.prompt;
      lastGenRef.current = { model: useModel, aspect: useAspect, quality: useQuality, prompt: usePrompt };

      setBusy(true);
      setToast(null);

      const baseIndex = append ? tiles.length : 0;
      const placeholder: UITile = { index: baseIndex, status: "generating", image: null, charged_cost: 0 };
      setPhase("results");
      setTiles((prev) => (append ? [...prev, placeholder] : [placeholder]));

      const sendRefs = buildSendRefs();
      try {
        const res = await api.generatePack(packId, {
          n: 1,
          aspect_ratio: useAspect || undefined,
          image_refs: sendRefs.length ? sendRefs : undefined,
          model: useModel,
          quality: useQuality ?? undefined,
          prompt_override: usePrompt,
        });
        const incoming: UITile[] = res.tiles.map((t, i) => ({ ...t, index: baseIndex + i }));
        setTiles((prev) => {
          const kept = prev.filter((t) => t.index < baseIndex);
          return [...kept, ...incoming];
        });
        if (res.summary.current_balance !== null) setCredits(res.summary.current_balance);
        window.dispatchEvent(new Event("studio-credits-refresh"));
        refreshCredits();
        // Save every delivered image to the user's gallery (history).
        if (user) {
          for (const t of res.tiles) {
            if (t.status === "success" && t.image) {
              void addHistoryEntry(user.uid, {
                imageUrl: t.image,
                prompt: usePrompt || pack.title,
                model: useModel ?? "",
              });
            }
          }
        }
      } catch (e) {
        setTiles((prev) => prev.filter((t) => t.index < baseIndex));
        if (!append) setPhase("form");
        setToast(isContentBlockedError(e) ? pt(language, "blocked") : e instanceof Error ? e.message : "Generation failed");
      } finally {
        setBusy(false);
      }
    },
    [pack, tiles.length, packId, buildSendRefs, refreshCredits, language, user],
  );

  const confirmGenerate = useCallback(() => {
    if (!plan) return;
    writeSticky(packId, { model: popModel, aspect_ratio: popAspect, quality: popQuality });
    setLastUnit(popEstimate?.unit ?? 0);
    setConfirmOpen(false);
    void runGenerate({
      model: popModel,
      aspect: popAspect,
      quality: popQuality,
      prompt_override: plan.final_prompt,
      append: false,
    });
  }, [plan, packId, popModel, popAspect, popQuality, popEstimate, runGenerate]);

  const download = useCallback(
    async (src: string | null, name: string) => {
      if (!src) return;
      try {
        const blob = await fetchAuthenticatedAsset(user, src);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch {
        setToast("Download failed");
      }
    },
    [user],
  );

  if (loadError) {
    return (
      <div className="p-8">
        <Link href="/studio/packs" className="text-sm text-[#93a0bd] hover:text-white">
          ‹ {pt(language, "back")}
        </Link>
        <p className="mt-6 text-sm text-rose-300">{loadError}</p>
      </div>
    );
  }
  if (!pack) {
    return <div className="p-8 text-sm text-[#93a0bd]">{pt(language, "loading")}</div>;
  }

  const capLabel = capabilityLabel(language, pack.capability);
  const craftColor = CRAFT_HEX[pack.capability] ?? "#8fa0c4";
  // Bricolage has no Arabic glyphs — only use it for Latin; Arabic inherits Tajawal.
  const displayClass = isRtl ? "" : "font-['Bricolage_Grotesque']";
  // Per-pack craft accent as CSS vars (replaces the old global amber) — matches PackChat.
  const mixAccent = (pct: number) => `color-mix(in srgb, ${craftColor} ${pct}%, transparent)`;
  const accentVars = {
    "--accent": craftColor,
    "--accent-10": mixAccent(10),
    "--accent-15": mixAccent(15),
    "--accent-30": mixAccent(30),
    "--accent-40": mixAccent(40),
    "--accent-60": mixAccent(60),
  } as CSSProperties;

  // ---- pop-up derived values ----
  const models = pack.models ?? [];
  const qualityOptions = models.find((m) => m.id === popModel)?.quality_options ?? [];
  // Aspect-ratio choices for the CURRENTLY selected model (grok ratios vs
  // gpt-image sizes); falls back to the pack-level list.
  const aspectOptions = aspectOptionsFor(pack, popModel);
  const popTotal = popEstimate?.total ?? 0;
  const popBalanceAfter = credits === null ? null : Math.max(0, Number((credits - popTotal).toFixed(4)));
  const popInsufficient = credits !== null && popTotal > credits;

  // Freeform studio → full-bleed "playground" layout: no breadcrumb/badge, no card
  // box. Fills the viewport below the 60px header (bottom pad clears the mobile
  // nav) so the gallery scrolls internally and the context strip stays pinned.
  if (pack.kind === "freeform" && !needsVariantPick) {
    return (
      <div
        style={{ ...accentVars, background: "radial-gradient(120% 55% at 50% -8%, rgba(255,255,255,.04), transparent 60%)" }}
        className="flex h-[calc(100dvh-60px)] flex-col px-3 pb-24 pt-2 sm:px-6 lg:pb-4"
      >
        <PackChat
          key={selectedVariant?.id ?? "none"}
          pack={pack}
          variant={selectedVariant}
          language={language}
          onChangeMockup={variants.length > 0 ? () => setVariantId(null) : undefined}
        />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8" style={accentVars}>
      {/* breadcrumb */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <Link href="/studio/packs" className="text-[#93a0bd] transition hover:text-white">
            ‹ {pt(language, "back")}
          </Link>
          <span className="text-[#42506f]">/</span>
          <span className={`font-bold text-[#eaedf6] ${displayClass}`}>{pack.title}</span>
        </div>
        <span
          className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
          style={{ color: craftColor, backgroundColor: `${craftColor}22` }}
        >
          <span className="material-symbols-outlined text-[15px]">{CAPABILITY_GLYPH[pack.capability]}</span>
          {capLabel}
        </span>
      </div>

      {phase === "form" ? (
        needsVariantPick ? (
          <div>
            <h2 className={`text-xl font-bold text-[#eaedf6] ${displayClass}`}>{pt(language, "pickMockup")}</h2>
            {/* Masonry gallery: each mockup at its natural aspect ratio (no square
                crop), flowing into as many columns as fit — not forced 4-up. */}
            <div className="mt-5 gap-1.5 [column-fill:_balance] columns-2 sm:columns-3 xl:columns-4">
              {variants.map((v) => (
                <MockupPickerTile key={v.id} v={v} onPick={() => setVariantId(v.id)} />
              ))}
            </div>
          </div>
        ) : pack.kind === "freeform" ? (
          <PackChat
            key={selectedVariant?.id ?? "none"}
            pack={pack}
            variant={selectedVariant}
            language={language}
            onChangeMockup={variants.length > 0 ? () => setVariantId(null) : undefined}
          />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* hero */}
            <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#111826] p-6">
              <div className="aspect-square w-full max-w-sm overflow-hidden rounded-xl bg-gradient-to-br from-[#1b2540] to-[#11192c]">
                {(selectedVariant?.hero_example_url || pack.hero_example_url) ? (
                  <AuthenticatedImage
                    src={selectedVariant?.hero_example_url || pack.hero_example_url}
                    alt={selectedVariant?.title || pack.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <div className="h-32 w-28 rounded-lg bg-white/90 shadow-2xl" />
                  </div>
                )}
              </div>
              <p className="mt-3 text-xs text-[#606d8a]">{selectedVariant?.title || pt(language, "example")}</p>
              {selectedVariant && (
                <button
                  type="button"
                  onClick={() => setVariantId(null)}
                  className="mt-1 text-xs text-[#93a0bd] transition hover:text-[color:var(--accent)]"
                >
                  ‹ {pt(language, "changeMockup")}
                </button>
              )}
            </div>

            {/* form — content only; model / ratio / quality move to the confirm pop-up */}
            <div className="flex flex-col gap-5">
              {needsImage && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[#cdd6f4]">
                    {pack.requires_image_input ? pt(language, "referenceRequired") : pt(language, "referenceOptional")}
                  </label>
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-white/15 bg-[#111826] p-3">
                    {imageRefs.map((img, i) => (
                      <div key={img.file_id ?? i} className="relative h-14 w-14 overflow-hidden rounded-lg border border-white/10">
                        <AuthenticatedImage src={img.url} alt={img.name ?? "ref"} className="h-full w-full object-cover" />
                        {imageRefs.length > 1 && (
                          <span className="absolute bottom-0 start-0 flex h-4 min-w-4 items-center justify-center bg-[color:var(--accent)] px-1 text-[10px] font-bold text-[#0d1320]">
                            {fmtNum(language, i + 1)}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setImageRefs((prev) => prev.filter((_, idx) => idx !== i))}
                          className="absolute end-0 top-0 flex h-4 w-4 items-center justify-center bg-black/60 text-[10px] text-white"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {imageRefs.length < designSlots && (
                      <label className="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-[#aebbe0] hover:bg-white/5">
                        <span className="material-symbols-outlined text-base">upload</span>
                        {pt(language, "upload")}
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => void onUpload(e.target.files)}
                        />
                      </label>
                    )}
                    {!pack.requires_image_input && imageRefs.length === 0 && (
                      <span className="text-xs text-[#606d8a]">{pt(language, "orSkip")}</span>
                    )}
                  </div>
                  {imageRefs.length > 1 && (
                    <p className="mt-1.5 text-xs text-[#606d8a]">{pt(language, "multiImageHint")}</p>
                  )}
                </div>
              )}

              {pack.slots
                .filter((s) => s.type !== "image_ref")
                .map((s) => (
                  <div key={s.key}>
                    <label className="mb-1.5 block text-sm font-medium text-[#cdd6f4]">
                      {s.label}
                      {s.required && <span className="ms-1 text-[11px] text-[color:var(--accent)]">· {pt(language, "required")}</span>}
                    </label>
                    {s.type === "select" ? (
                      <select
                        value={slotValues[s.key] ?? ""}
                        onChange={(e) => setSlotValues((prev) => ({ ...prev, [s.key]: e.target.value }))}
                        className="w-full rounded-xl border border-white/10 bg-[#111826] px-3 py-2.5 text-sm text-white focus:border-[color:var(--accent-60)] focus:outline-none"
                      >
                        <option value="">—</option>
                        {(s.options ?? []).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : s.multiline ? (
                      <textarea
                        value={slotValues[s.key] ?? ""}
                        onChange={(e) => setSlotValues((prev) => ({ ...prev, [s.key]: e.target.value }))}
                        placeholder={s.placeholder ?? pt(language, "describePlaceholder")}
                        rows={5}
                        maxLength={4000}
                        className="w-full resize-y rounded-xl border border-white/10 bg-[#111826] px-3 py-2.5 text-sm text-white placeholder:text-[#606d8a] focus:border-[color:var(--accent-60)] focus:outline-none"
                      />
                    ) : (
                      <input
                        value={slotValues[s.key] ?? ""}
                        onChange={(e) => setSlotValues((prev) => ({ ...prev, [s.key]: e.target.value }))}
                        placeholder={s.placeholder ?? ""}
                        className="w-full rounded-xl border border-white/10 bg-[#111826] px-3 py-2.5 text-sm text-white placeholder:text-[#606d8a] focus:border-[color:var(--accent-60)] focus:outline-none"
                      />
                    )}
                  </div>
                ))}

              {/* generate CTA — opens the planning agent, then the confirm pop-up */}
              <div className="rounded-2xl border border-[color:var(--accent-30)] bg-[#141b2b] p-4">
                <button
                  type="button"
                  disabled={busy || planning || mockupLoading}
                  onClick={onGenerateClick}
                  className="w-full rounded-xl bg-[color:var(--accent)] py-3 text-sm font-bold text-[#0d1320] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {planning ? pt(language, "planning") : mockupLoading ? pt(language, "loading") : `${pt(language, "generate")} →`}
                </button>
                <Link
                  href={`/studio/packs/${packId}/batch`}
                  className="mt-2 block text-center text-xs text-[#93a0bd] transition hover:text-[color:var(--accent)]"
                >
                  {pt(language, "applyToMany")} →
                </Link>
                <p className="mt-2 text-center text-[11px] text-[#606d8a]">{pt(language, "ctaNote")}</p>
              </div>
            </div>
          </div>
        )
      ) : (
        <ResultsView
          pack={pack}
          tiles={tiles}
          busy={busy}
          unit={lastUnit}
          aspectRatios={aspectOptions}
          onVariant={() => void runGenerate({ append: true })}
          onResize={(r) => void runGenerate({ aspect: r, append: true })}
          onDownload={download}
          onBack={() => setPhase("form")}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 start-1/2 z-50 -translate-x-1/2 rounded-xl border border-white/10 bg-[#1a2238] px-4 py-2.5 text-sm text-white shadow-xl">
          {toast}
        </div>
      )}

      {/* agent clarification pop-up */}
      {clarify !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#141b2d] p-5">
            <p className="flex items-center gap-2 text-base font-semibold text-white">
              <span className="material-symbols-outlined text-[20px] text-[color:var(--accent)]">help</span>
              {pt(language, "agentAsks")}
            </p>
            <p className="mt-2 text-sm text-[#cdd6f4]">{clarify}</p>
            <textarea
              value={clarifyAnswer}
              onChange={(e) => setClarifyAnswer(e.target.value)}
              placeholder={pt(language, "yourAnswer")}
              rows={3}
              maxLength={2000}
              className="mt-3 w-full resize-y rounded-xl border border-white/10 bg-[#111826] px-3 py-2.5 text-sm text-white placeholder:text-[#606d8a] focus:border-[color:var(--accent-60)] focus:outline-none"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setClarify(null)}
                className="rounded-lg px-4 py-2 text-sm text-[#aebbe0] hover:bg-white/5"
              >
                {pt(language, "cancel")}
              </button>
              <button
                type="button"
                disabled={planning}
                onClick={() => void doPlan(2, clarifyAnswer)}
                className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-bold text-[#0d1320] hover:brightness-110 disabled:opacity-50"
              >
                {planning ? pt(language, "planning") : `${pt(language, "continue")} →`}
              </button>
            </div>
            <button
              type="button"
              disabled={planning}
              onClick={() => void doPlan(2, "")}
              className="mt-2 block w-full text-center text-xs text-[#606d8a] transition hover:text-[color:var(--accent)] disabled:opacity-50"
            >
              {pt(language, "skipAndGenerate")}
            </button>
          </div>
        </div>
      )}

      {/* confirm pop-up — agent summary + cost + editable model / ratio / quality */}
      {confirmOpen && plan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-white/10 bg-[#141b2d] p-4">
            <p className="text-base font-semibold text-white">{pt(language, "reviewPlan")}</p>

            <div className="mt-2.5 rounded-xl bg-[#111826] p-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#606d8a]">
                {pt(language, "planSummaryLabel")}
              </p>
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
                      className={`cursor-pointer rounded-xl border px-3 py-1.5 text-sm transition ${
                        popQuality === q
                          ? "border-[#e7ad4d] bg-[#e7ad4d]/15 font-semibold text-[#e7ad4d]"
                          : "border-white/10 bg-[#111826] text-[#aebbe0] hover:border-white/20"
                      }`}
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
              <p className="text-xl font-extrabold text-[color:var(--accent)]">
                {popEstimating ? "…" : fmtNum(language, popTotal)}
              </p>
            </div>

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg px-4 py-2 text-sm text-[#aebbe0] hover:bg-white/5"
              >
                {pt(language, "cancel")}
              </button>
              <button
                type="button"
                disabled={busy || popEstimating || popInsufficient}
                onClick={confirmGenerate}
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

function ResultsView({
  pack,
  tiles,
  busy,
  unit,
  aspectRatios,
  onVariant,
  onResize,
  onDownload,
  onBack,
}: {
  pack: PackDetail;
  tiles: UITile[];
  busy: boolean;
  unit: number;
  aspectRatios: string[];
  onVariant: () => void;
  onResize: (ratio: string) => void;
  onDownload: (src: string | null, name: string) => void;
  onBack: () => void;
}) {
  const { language } = useLanguage();
  const [resizeFor, setResizeFor] = useState<number | null>(null);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-white">
          {pt(language, "results")} — {pack.title}
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-[#aebbe0] hover:bg-white/5"
          >
            ‹ {pt(language, "back")}
          </button>
          <button
            type="button"
            onClick={() =>
              tiles
                .filter((t) => t.status === "success" && t.image)
                .forEach((t, i) => onDownload(t.image, `${pack.id}-${i + 1}.png`))
            }
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm text-[#aebbe0] hover:bg-white/5"
          >
            <span className="material-symbols-outlined text-base">download</span>
            {pt(language, "downloadAll")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.index} className="overflow-hidden rounded-2xl border border-white/10 bg-[#141b2d]">
            <div className="relative aspect-square w-full bg-[#0e1525]">
              {t.status === "generating" ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3">
                  <div className="h-24 w-20 animate-pulse rounded-lg bg-white/10" />
                  <span className="text-xs text-[#606d8a]">{pt(language, "generatingShort")}</span>
                </div>
              ) : t.status === "success" && t.image ? (
                <InteractiveAuthenticatedImage
                  src={t.image}
                  alt={pack.title}
                  wrapperClassName="h-full w-full"
                  imageClassName="h-full w-full object-cover"
                  loadingClassName="flex h-full w-full items-center justify-center text-xs text-[#606d8a]"
                  errorClassName="flex h-full w-full items-center justify-center text-xs text-[#8a96b8]"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center p-4 text-center">
                  <span className="text-sm text-[#8a96b8]">
                    {t.status === "skipped" ? pt(language, "tileSkipped") : pt(language, "tileFailed")}
                  </span>
                </div>
              )}
            </div>

            {t.status === "success" && t.image && (
              <div className="flex flex-col gap-0.5 p-3 text-sm">
                <button
                  type="button"
                  disabled={busy}
                  onClick={onVariant}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[#cdd6f4] hover:bg-white/5 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[18px] text-[color:var(--accent)]/80">cached</span>
                  {pt(language, "variant")}
                  <span className="ms-auto text-xs text-[#606d8a]">+{fmtNum(language, unit)}</span>
                </button>

                <div className="relative">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setResizeFor(resizeFor === t.index ? null : t.index)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[#cdd6f4] hover:bg-white/5 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[18px] text-[color:var(--accent)]/80">aspect_ratio</span>
                    {pt(language, "resize")}
                    <span className="material-symbols-outlined ms-auto text-[16px]">expand_more</span>
                  </button>
                  {resizeFor === t.index && (
                    <div className="absolute z-10 mt-1 w-32 rounded-lg border border-white/10 bg-[#1a2238] p-1 shadow-xl">
                      {aspectRatios.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => {
                            setResizeFor(null);
                            onResize(r);
                          }}
                          className="flex w-full items-center justify-between rounded px-2 py-1.5 text-sm text-[#cdd6f4] hover:bg-white/5"
                        >
                          {r}
                          <span className="text-xs text-[#606d8a]">+{fmtNum(language, unit)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  disabled
                  title={pt(language, "soon")}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[#6b7798]"
                >
                  <span className="material-symbols-outlined text-[18px]">edit_note</span>
                  {pt(language, "caption")}
                  <span className="ms-auto text-[10px] uppercase">{pt(language, "soon")}</span>
                </button>
                <button
                  type="button"
                  disabled
                  title={pt(language, "soon")}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[#6b7798]"
                >
                  <span className="material-symbols-outlined text-[18px]">tune</span>
                  {pt(language, "edit")}
                  <span className="ms-auto text-[10px] uppercase">{pt(language, "soon")}</span>
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="mt-5 text-xs text-[#606d8a]">{pt(language, "ctaNote")}</p>
    </div>
  );
}

// One mockup in the "pick a mockup" grid. Mockup thumbnails are public assets, so a
// plain <img> is used (mirrors the gallery): a pulsing 4:5 skeleton reserves space
// until the image loads, then the natural-ratio image fades in. The mount-time
// `complete` check rescues cache hits (Back / re-open) from a stuck skeleton.
function MockupPickerTile({ v, onPick }: { v: PackVariant; onPick: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, []);
  return (
    <button
      type="button"
      onClick={onPick}
      className="group relative mb-1.5 block w-full break-inside-avoid overflow-hidden rounded-md border border-white/[.08] bg-[#141b2b] text-start animate-fade-in-up transition hover:border-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
    >
      {v.thumbnail_url ? (
        <>
          {!loaded && (
            <div
              className="w-full animate-pulse bg-gradient-to-br from-white/[.07] to-white/[.02]"
              style={{ aspectRatio: "4 / 5" }}
            />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={v.thumbnail_url}
            alt={v.title}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
            className={`w-full transition duration-300 group-hover:scale-[1.04] ${
              loaded ? "block h-auto opacity-100" : "absolute inset-0 h-full object-cover opacity-0"
            }`}
          />
        </>
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-gradient-to-br from-[#1b2540] to-[#11192c]">
          <span className="material-symbols-outlined text-2xl text-white/40">image</span>
        </div>
      )}
      {/* caption overlay — hidden until hover/focus (always shown on touch) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-3 pt-9 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100">
        <span className="text-[13px] font-semibold text-white drop-shadow-sm">{v.title}</span>
      </div>
    </button>
  );
}
