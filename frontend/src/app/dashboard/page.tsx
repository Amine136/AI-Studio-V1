"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../context/LanguageContext";
import AuthenticatedImage from "../../components/AuthenticatedImage";
import { getHistory, type HistoryEntry } from "../../lib/history";
import { SAMPLE_HISTORY, isSampleEntry } from "../../lib/sampleHistory";
import { getProfile } from "../../lib/credits";
import { api } from "../../services/api";
import type { DashboardNewsItem, PlainChatModelItem } from "../../types";

interface SuspensionState {
  reason: string;
  endsAt: string | null;
  endsAtLabel: string | null;
}


type PlaygroundQuickStart = {
  modelId: string;
  tagline: string;
  prompt: string;
  icon: string;
  accent: string; // hex used for the icon tile + glow
  badge?: string; // optional category chip; also gives the card a tinted background
};

type ResolvedQuickStart = PlaygroundQuickStart & {
  name: string;
  provider: string;
  outputModalities: string[];
};

function formatSuspensionEndsAt(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return (
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(date) + " UTC"
  );
}

function parseSuspensionStateFromProfile(profile: any): SuspensionState | null {
  if (!profile?.isSuspended) return null;
  const endsAt = profile?.activeSuspensionUntil ? new Date(profile.activeSuspensionUntil * 1000).toISOString() : null;
  return {
    reason: profile?.suspensionReason || "Access to this account has been restricted.",
    endsAt,
    endsAtLabel: endsAt ? formatSuspensionEndsAt(endsAt) : null,
  };
}


function formatProviderName(value: string) {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isRenderableImageUrl(value?: string) {
  return Boolean(value && (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/")));
}

const defaultNewsItems: DashboardNewsItem[] = [
  {
    id: "default-1",
    badge: "New Features",
    when: "",
    title: "Quick and Smart workflows are active",
    description: "Move straight to generation when you want speed, or pay the Smart analysis fee for extra prompt optimization.",
    linkLabel: "Learn more",
    linkHref: "/studio",
    tone: "blue",
    sortOrder: 0,
    isActive: true,
  },
  {
    id: "default-2",
    badge: "Platform Updates",
    when: "",
    title: "Failed delivery protection is enabled",
    description: "When Vibecraft cannot deliver a usable result, reserved generation credits are released instead of captured.",
    linkLabel: "Review flow",
    linkHref: "/credits",
    tone: "purple",
    sortOrder: 1,
    isActive: true,
  },
  {
    id: "default-3",
    badge: "AI News",
    when: "",
    title: "Admin protections already run live",
    description: "Login lockouts, warnings, rate limits, and audit flows are active across the admin surface.",
    linkLabel: "Open warnings",
    linkHref: "/policy",
    tone: "slate",
    sortOrder: 2,
    isActive: true,
  },
];

function newsBadgeClass(tone: DashboardNewsItem["tone"]) {
  if (tone === "purple") return "bg-[#d0bcff]/10 text-[#d0bcff]";
  if (tone === "slate") return "bg-[#b9c8de]/10 text-[#b9c8de]";
  return "bg-blue-400/10 text-blue-400";
}

// Picks the news title/description/link label in the active language, falling
// back to English whenever that translation was left blank in the admin panel.
function localizedNews(item: DashboardNewsItem, language: string) {
  const pick = (en: string, fr?: string, ar?: string) => {
    if (language === "fr") return (fr && fr.trim()) || en;
    if (language === "ar") return (ar && ar.trim()) || en;
    return en;
  };
  return {
    title: pick(item.title, item.titleFr, item.titleAr),
    description: pick(item.description, item.descriptionFr, item.descriptionAr),
    linkLabel: pick(item.linkLabel, item.linkLabelFr, item.linkLabelAr),
  };
}

function formatRelativeTime(timestamp?: number | null) {
  if (!timestamp) return "Just now";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

// Opens the Playground straight into a model, with an optional seeded prompt the
// user can edit or clear before pressing send. (See the deep-link bootstrap in
// src/app/studio/chat/page.tsx.)
function buildPlaygroundHref(modelId: string, prompt?: string) {
  const params = new URLSearchParams({ model: modelId, new: "1" });
  if (prompt) params.set("prompt", prompt);
  return `/studio/chat?${params.toString()}`;
}

// Curated quick-start models. Each opens the Playground with the model selected
// and a starter prompt prefilled. modelId must match a catalog model slug; cards
// whose model is not currently available are skipped automatically.
const playgroundQuickStarts: PlaygroundQuickStart[] = [
  {
    modelId: "gemini-3.1-flash-image-preview",
    tagline: "Google's fast image model — great for quick, photoreal concepts and edits.",
    prompt:
      "A photorealistic product hero shot of a matte-black wireless headphone set on a wet stone surface, soft studio rim light, shallow depth of field, cinematic reflections, 4k detail.",
    icon: "auto_awesome",
    accent: "#adc6ff",
  },
  {
    modelId: "grok-imagine-image-quality",
    tagline: "Grok's high-quality renderer for bold, stylized, high-impact visuals.",
    prompt:
      "Une affiche cinématographique spectaculaire d'un astronaute solitaire debout sur une dune extraterrestre éclairée au néon au crépuscule, lumière volumétrique, palette magenta et turquoise éclatante, ultra-détaillée, grain argentique.",
    icon: "diamond",
    accent: "#d0bcff",
  },
  {
    modelId: "recraftv4_1_vector",
    tagline: "Recraft's vector engine — clean, scalable SVG output made for designers.",
    prompt:
      "شعار متجهي مسطّح وبسيط لرأس ثعلب مكوَّن من أشكال هندسية بسيطة، لوحة ألوان جريئة من لونين، خطوط نظيفة وحادّة، بأسلوب أيقونة SVG قابلة للتكبير على خلفية سادة.",
    icon: "polyline",
    accent: "#f0a868",
    badge: "SVG · For designers",
  },
];

// Curated "Recommended" picks for the dashboard (premium / flagship tiers).
// Resolved against the live catalog; if any are missing we top up with the best
// available image models so we always show two.
const recommendedModelIds = ["gemini-3-pro-image-preview", "gpt-image-2"];

function normalizeProvider(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("google") || lower.includes("gemini")) return "Google Gemini";
  if (lower.includes("openai") || lower.includes("gpt")) return "OpenAI";
  if (lower.includes("anthropic") || lower.includes("claude")) return "Anthropic";
  if (lower.includes("ideogram")) return "Ideogram";
  if (lower.includes("recraft")) return "Recraft";
  if (lower.includes("grok") || lower.includes("xai")) return "Grok";
  if (lower.includes("mistral")) return "Mistral";
  if (lower.includes("groq")) return "Groq";
  return formatProviderName(name);
}

function getProviderIcon(providerName: string) {
  const lower = providerName.toLowerCase();
  if (lower.includes("google") || lower.includes("gemini")) return "auto_awesome";
  if (lower.includes("openai") || lower.includes("gpt")) return "memory";
  if (lower.includes("anthropic") || lower.includes("claude")) return "psychiatry";
  if (lower.includes("ideogram")) return "draw";
  if (lower.includes("recraft")) return "brush";
  if (lower.includes("grok") || lower.includes("xai")) return "diamond";
  if (lower.includes("mistral")) return "air";
  if (lower.includes("groq")) return "bolt";
  return "api";
}

function modelOutputBadges(outputModalities: string[]): string[] {
  const out = outputModalities.map((v) => v.toUpperCase());
  const badges: string[] = [];
  if (out.includes("IMAGE")) badges.push("Image");
  if (out.includes("TEXT")) badges.push("Text");
  return badges;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { t, isRtl, language } = useLanguage();

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [currentCredits, setCurrentCredits] = useState<number | null>(null);
  const [suspension, setSuspension] = useState<SuspensionState | null>(null);
  const [newsItems, setNewsItems] = useState<DashboardNewsItem[]>(defaultNewsItems);
  const [playgroundModels, setPlaygroundModels] = useState<PlainChatModelItem[]>([]);
  const [activeNewsIndex, setActiveNewsIndex] = useState(0);
  const [activeQuickStartIndex, setActiveQuickStartIndex] = useState(0);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/auth");
    }
  }, [authLoading, router, user]);

  const fetchHistoryData = useCallback(async () => {
    if (!user) return;
    setHistoryLoading(true);
    try {
      const entries = await getHistory(user.uid, 8);
      setHistory(entries);
    } finally {
      setHistoryLoading(false);
    }
  }, [user]);

  const fetchPlaygroundModels = useCallback(async () => {
    try {
      const response = await api.getPlainChatModels();
      setPlaygroundModels(Array.isArray(response.models) ? response.models : []);
    } catch {
      setPlaygroundModels([]);
    }
  }, []);

  const fetchDashboardNews = useCallback(async () => {
    try {
      const response = await api.getDashboardNews();
      if (response.items?.length) {
        setNewsItems(response.items);
      } else {
        setNewsItems(defaultNewsItems);
      }
    } catch {
      setNewsItems(defaultNewsItems);
    }
  }, []);

  const fetchProfile = useCallback(async () => {
    if (!user) return;
    try {
      const profile = await getProfile();
      setCurrentCredits(profile.credits ?? 0);
      setSuspension(parseSuspensionStateFromProfile(profile));
    } catch {
      setCurrentCredits(null);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void fetchHistoryData();
    void fetchProfile();
    void fetchDashboardNews();
    void fetchPlaygroundModels();
  }, [fetchDashboardNews, fetchHistoryData, fetchPlaygroundModels, fetchProfile, user]);

  useEffect(() => {
    if (newsItems.length <= 1) {
      setActiveNewsIndex(0);
      return;
    }

    const intervalId = window.setInterval(() => {
      setActiveNewsIndex((current) => (current + 1) % newsItems.length);
    }, 6000);

    return () => window.clearInterval(intervalId);
  }, [newsItems]);

  const latestItems = [...history, ...SAMPLE_HISTORY].slice(0, 4);

  const playgroundModelMap = useMemo(() => {
    const map = new Map<string, PlainChatModelItem>();
    for (const model of playgroundModels) map.set(model.id, model);
    return map;
  }, [playgroundModels]);

  // Resolve the curated quick-start cards against the live catalog; drop any
  // whose model is not currently available so we never deep-link to a dead model.
  const resolvedQuickStarts = useMemo<ResolvedQuickStart[]>(
    () =>
      playgroundQuickStarts
        .map((quickStart) => {
          const model = playgroundModelMap.get(quickStart.modelId);
          if (!model) return null;
          return {
            ...quickStart,
            name: model.displayName || quickStart.modelId,
            provider: normalizeProvider(model.provider || ""),
            outputModalities: model.outputModalities || [],
          };
        })
        .filter((entry): entry is ResolvedQuickStart => entry !== null),
    [playgroundModelMap],
  );

  // Rotate the quick-start spotlight every 5 seconds.
  useEffect(() => {
    if (resolvedQuickStarts.length <= 1) {
      setActiveQuickStartIndex(0);
      return;
    }
    const intervalId = window.setInterval(() => {
      setActiveQuickStartIndex((current) => (current + 1) % resolvedQuickStarts.length);
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [resolvedQuickStarts.length]);

  // Two recommended models: the curated picks, topped up with the best available
  // image models if any pick is missing.
  const recommendedModels = useMemo(() => {
    const isImage = (model: PlainChatModelItem) =>
      (model.outputModalities || []).map((value) => value.toUpperCase()).includes("IMAGE");
    const picks: PlainChatModelItem[] = [];
    for (const id of recommendedModelIds) {
      const model = playgroundModelMap.get(id);
      if (model) picks.push(model);
    }
    if (picks.length < 2) {
      for (const model of playgroundModels) {
        if (picks.length >= 2) break;
        if (!isImage(model) || picks.some((pick) => pick.id === model.id)) continue;
        picks.push(model);
      }
    }
    return picks.slice(0, 2);
  }, [playgroundModelMap, playgroundModels]);

  // Provider status cards with live model counts.
  const providerSummaries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const model of playgroundModels) {
      const label = normalizeProvider(model.provider || "");
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([title, count]) => ({ title, count, icon: getProviderIcon(title) }));
  }, [playgroundModels]);

  if (authLoading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="auth-loader" />
      </main>
    );
  }

  if (suspension) {
    return (
      <section dir={isRtl ? "rtl" : "ltr"} className="rounded-xl border border-[#93000a]/20 bg-[#151b2d] p-10">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-md border border-[#93000a]/30 bg-[#93000a]/10 text-[#ffb4ab]">
            <span className="material-symbols-outlined text-3xl">gpp_bad</span>
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#ffb4ab]/80">{t("Account Restricted")}</p>
          <h2 className="mt-3 font-headline text-3xl font-bold text-[#dce1fb]">{t("This account is currently suspended")}</h2>
          <p className="mt-4 text-sm leading-7 text-[#c2c6d6]">{suspension.reason}</p>
          <div className="mt-6 rounded-md border border-white/10 bg-[#070d1f] px-5 py-4 text-left">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8c909f]">{t("Status")}</p>
            <p className="mt-2 text-base font-semibold text-[#dce1fb]">{suspension.endsAtLabel || t("Suspended until admin review")}</p>
          </div>
          <div className="mt-6">
            <Link href="/policy" className="inline-flex rounded-sm border border-white/10 bg-[#070d1f] px-4 py-2 text-sm text-[#c2c6d6] transition hover:border-[#adc6ff]/30 hover:text-[#dce1fb]">
              {t("View Usage Policy")}
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div dir={isRtl ? "rtl" : "ltr"} className="space-y-8 sm:space-y-12">
      <section className="relative space-y-6">
        {/* Welcome + credits */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <h2 className="font-headline text-2xl font-bold tracking-tighter text-blue-100 sm:text-4xl">
              {t("Welcome,")} {user.displayName?.split(" ")[0] || user.email?.split("@")[0] || t("Creator")}
            </h2>
          </div>

          <div className="flex shrink-0 items-center gap-3 rounded-xl border border-[#adc6ff]/10 bg-[#151b2d] px-4 py-3">
            <span className="material-symbols-outlined text-xl text-[#d0bcff]" style={{ fontVariationSettings: "'FILL' 1" }}>
              bolt
            </span>
            <span className="font-headline text-xl font-bold text-blue-100">
              {currentCredits === null ? "..." : `${currentCredits.toFixed(2)} Cr`}
            </span>
            <Link
              href="/credits"
              className="shrink-0 rounded-md border border-white/5 bg-[#23293c] px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-all hover:border-[#adc6ff]/40"
            >
              {t("Top Up")}
            </Link>
          </div>
        </div>

        {/* Quick Start · Playground */}
        <div>

          {resolvedQuickStarts.length === 0 ? (
            <div className="h-[220px] animate-pulse rounded-2xl border border-white/5 bg-[#151b2d]" />
          ) : (
            (() => {
              const quickStart = resolvedQuickStarts[activeQuickStartIndex % resolvedQuickStarts.length];
              return (
                <>
                  <div
                    key={quickStart.modelId}
                    className="group relative overflow-hidden rounded-2xl border p-5 duration-500 animate-in fade-in sm:p-7"
                    style={
                      quickStart.badge
                        ? { borderColor: `${quickStart.accent}55`, background: `linear-gradient(135deg, ${quickStart.accent}1f, #151b2d 55%)` }
                        : { borderColor: "rgba(255,255,255,0.05)", backgroundColor: "#151b2d" }
                    }
                  >
                    <div
                      className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full opacity-25 blur-[90px]"
                      style={{ backgroundColor: quickStart.accent }}
                    />
                    <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-center">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                            style={{ backgroundColor: `${quickStart.accent}26`, color: quickStart.accent }}
                          >
                            <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                              {quickStart.icon}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <h4 className="truncate font-headline text-lg font-bold text-blue-100 sm:text-xl">{quickStart.name}</h4>
                            <span className="text-[10px] font-bold uppercase tracking-widest text-[#8c909f]">{quickStart.provider}</span>
                          </div>
                          {quickStart.badge && (
                            <span
                              className="ml-auto shrink-0 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
                              style={{ backgroundColor: `${quickStart.accent}26`, color: quickStart.accent }}
                            >
                              {quickStart.badge}
                            </span>
                          )}
                        </div>

                        <div className="mt-4 rounded-lg border border-white/5 bg-[#070d1f] p-3">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-[#6b7a8f]">{t("Starter prompt")}</span>
                          <p className="mt-1 text-xs leading-5 text-[#aeb6c8] line-clamp-2 md:line-clamp-none">{quickStart.prompt}</p>
                        </div>
                      </div>

                      <div className="md:w-60 md:shrink-0">
                        <Link
                          href={buildPlaygroundHref(quickStart.modelId, quickStart.prompt)}
                          className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-[#03203f] transition-transform hover:scale-[1.02] active:scale-95"
                          style={{ background: `linear-gradient(135deg, ${quickStart.accent}, #4d8eff)` }}
                        >
                          <span className="material-symbols-outlined text-[18px]">bolt</span>
                          {t("Start in Playground")}
                        </Link>
                      </div>
                    </div>
                  </div>

                  {resolvedQuickStarts.length > 1 && (
                    <div className="mt-4 flex justify-center gap-2">
                      {resolvedQuickStarts.map((entry, index) => (
                        <button
                          key={entry.modelId}
                          type="button"
                          onClick={() => setActiveQuickStartIndex(index)}
                          aria-label={`Show ${entry.name}`}
                          className={`h-2 rounded-full transition-all ${
                            index === activeQuickStartIndex % resolvedQuickStarts.length
                              ? "w-6 bg-[#adc6ff]"
                              : "w-2 bg-white/15 hover:bg-white/30"
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </>
              );
            })()
          )}
        </div>
      </section>

      <section className="space-y-6">
        <div className="flex items-end justify-between gap-3">
          <h3 className="font-headline text-xl font-bold tracking-tight sm:text-2xl">{t("Latest Generations")}</h3>
          <Link href="/gallery" className="flex items-center gap-1 text-sm font-medium text-[#adc6ff] hover:underline">
            {t("Explore Gallery")} <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </Link>
        </div>

        <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:grid md:grid-cols-4 md:overflow-visible md:pr-0 md:pb-0 2xl:grid-cols-5">
          {historyLoading
            ? Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="group w-[58vw] max-w-[220px] shrink-0 snap-start cursor-pointer md:w-auto md:max-w-none">
                  <div className="relative mb-3 aspect-[4/5] overflow-hidden rounded-xl border border-white/5 bg-[#151b2d]">
                    <div className="flex h-full w-full items-center justify-center bg-[#151b2d] text-white/20">
                      <span className="material-symbols-outlined text-[72px]">hourglass_top</span>
                    </div>
                  </div>
                  <h4 className="font-semibold text-blue-100">{t("Loading...")}</h4>
                  <p className="text-xs text-[#c2c6d6]">{t("Syncing...")}</p>
                </div>
              ))
            : latestItems.map((entry) => (
                <div key={entry.id} className="group w-[58vw] max-w-[220px] shrink-0 snap-start cursor-pointer md:w-auto md:max-w-none">
                  <div className="relative mb-3 aspect-[4/5] overflow-hidden rounded-xl border border-white/5 bg-[#151b2d]">
                    {isSampleEntry(entry.id) ? (
                      <div className="absolute left-2 top-2 z-10 rounded bg-[#0c1324]/85 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#adc6ff] backdrop-blur-md rtl:left-auto rtl:right-2">
                        {t("Example")}
                      </div>
                    ) : null}
                    {isRenderableImageUrl(entry.imageUrl) ? (
                      <AuthenticatedImage src={entry.imageUrl || ""} alt={entry.prompt} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[#151b2d] text-white/20">
                        <span className="material-symbols-outlined text-[72px]">description</span>
                      </div>
                    )}
                    <div className="absolute inset-0 flex items-end bg-gradient-to-t from-[#0c1324]/80 to-transparent p-4 opacity-0 transition-opacity group-hover:opacity-100">
                      <span className="rounded bg-[#4d8eff]/40 px-2 py-1 text-xs font-bold text-white backdrop-blur-md">
                        {entry.model || "VIBE-X"}
                      </span>
                    </div>
                  </div>
                  <h4 className="font-semibold text-blue-100">{entry.prompt.slice(0, 24) || t("Untitled")}</h4>
                  <p className="text-xs text-[#c2c6d6]">
                    {entry.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </div>
              ))}
        </div>
      </section>

      <div className="grid grid-cols-12 gap-8 sm:gap-10">
        <section className="col-span-12 space-y-8 xl:col-span-8">
          {/* Recommended models */}
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h3 className="font-headline text-xl font-bold tracking-tight sm:text-2xl">{t("Recommended")}</h3>
                <span className="rounded bg-[#adc6ff]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#adc6ff]">
                  {t("Top picks")}
                </span>
              </div>
              <Link href="/studio/chat" className="flex items-center gap-1 text-sm font-medium text-[#adc6ff] hover:underline">
                {t("Open Playground")} <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </Link>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {recommendedModels.length === 0
                ? Array.from({ length: 2 }).map((_, index) => (
                    <div key={index} className="h-[240px] animate-pulse rounded-2xl border border-white/5 bg-[#151b2d]" />
                  ))
                : recommendedModels.map((model) => {
                    const provider = normalizeProvider(model.provider || "");
                    const badges = modelOutputBadges(model.outputModalities || []);
                    return (
                      <Link
                        key={model.id}
                        href={buildPlaygroundHref(model.id)}
                        className="group relative flex flex-col overflow-hidden rounded-2xl border border-[#adc6ff]/15 bg-[#151b2d] p-6 transition-all hover:border-[#adc6ff]/40 hover:bg-[#191f31]"
                      >
                        <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-[#4d8eff]/10 blur-[80px] transition-opacity duration-500 group-hover:opacity-70" />
                        <div className="relative z-10 flex flex-1 flex-col">
                          <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#4d8eff]/15 text-[#adc6ff]">
                              <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                                {getProviderIcon(provider)}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <h4 className="truncate font-headline text-lg font-bold text-blue-100 transition-colors group-hover:text-[#adc6ff]">
                                {model.displayName || model.id}
                              </h4>
                              <span className="text-[10px] font-bold uppercase tracking-widest text-[#8c909f]">{provider}</span>
                            </div>
                          </div>

                          <p className="mt-4 flex-1 text-sm leading-6 text-[#c2c6d6] line-clamp-2">
                            {model.description || t("Available in the Playground.")}
                          </p>

                          {(badges.length > 0 || model.supportsImageInput) && (
                            <div className="mt-4 flex flex-wrap gap-1.5">
                              {badges.map((badge) => (
                                <span
                                  key={badge}
                                  className="rounded border border-white/5 bg-white/[0.03] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#aeb6c8]"
                                >
                                  {t(badge)}
                                </span>
                              ))}
                              {model.supportsImageInput && (
                                <span className="rounded border border-white/5 bg-white/[0.03] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#aeb6c8]">
                                  {t("Image input")}
                                </span>
                              )}
                            </div>
                          )}

                          <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-[#adc6ff]">
                            {t("Open in Playground")}
                            <span className="material-symbols-outlined text-[16px] transition-transform group-hover:translate-x-1">
                              arrow_forward
                            </span>
                          </span>
                        </div>
                      </Link>
                    );
                  })}
            </div>
          </div>

          {/* Providers */}
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="font-headline text-xl font-bold tracking-tight sm:text-2xl">{t("Providers")}</h3>
                {playgroundModels.length > 0 && (
                  <span className="rounded bg-[#adc6ff]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#adc6ff]">
                    {playgroundModels.length} {t("models")}
                  </span>
                )}
              </div>
              {providerSummaries.length > 0 && (
                <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {t("All active")}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {providerSummaries.length === 0
                ? Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="h-[92px] animate-pulse rounded-xl border border-white/5 bg-[#151b2d]" />
                  ))
                : providerSummaries.map((provider) => (
                    <div
                      key={provider.title}
                      className="flex flex-col gap-2 rounded-xl border border-white/5 bg-[#070d1f] p-4"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#4d8eff]/10 text-[#adc6ff]">
                          <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                            {provider.icon}
                          </span>
                        </div>
                        <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          {t("Active")}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <h5 className="truncate text-sm font-bold text-blue-100">{provider.title}</h5>
                        <p className="text-[10px] font-medium text-[#8c909f]">
                          {provider.count} {provider.count === 1 ? t("model") : t("models")}
                        </p>
                      </div>
                    </div>
                  ))}
            </div>
          </div>
        </section>

        <aside className="col-span-12 space-y-8 xl:col-span-4">
          <section className="space-y-4">
            <h3 className="font-headline text-xl font-bold tracking-tight sm:text-2xl">{t("Studio News")}</h3>
            <div className="relative h-48 overflow-hidden rounded-xl border border-blue-400/20 bg-[#151b2d]">
              {newsItems.map((item, index) => {
                const localized = localizedNews(item, language);
                return (
                <div
                  key={item.id}
                  aria-hidden={index !== activeNewsIndex}
                  className={`absolute inset-0 flex flex-col justify-between p-6 transition-all duration-700 ${
                    index === activeNewsIndex ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${newsBadgeClass(item.tone)}`}>
                      {item.badge}
                    </span>
                    <span className="text-[10px] font-bold text-slate-500">{formatRelativeTime(item.updatedAt ?? item.createdAt)}</span>
                  </div>
                  <div>
                    <h4 className="mb-1 text-lg font-bold text-blue-100">{localized.title}</h4>
                    <p className="text-xs leading-relaxed text-[#c2c6d6]">{localized.description}</p>
                  </div>
                  {(localized.linkLabel || item.linkHref) ? (
                    <Link href={item.linkHref || "/studio"} className="flex items-center gap-1 self-start text-xs font-bold text-[#adc6ff] hover:underline">
                      {localized.linkLabel || t("Learn more")} <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </Link>
                  ) : null}
                </div>
                );
              })}
              <div className="absolute bottom-4 right-6 flex gap-1.5">
                {newsItems.map((item, index) => (
                  <div
                    key={`dot-${item.id}`}
                    className={`h-1.5 w-1.5 rounded-full ${index === activeNewsIndex ? "bg-blue-400 opacity-100" : "bg-slate-600"}`}
                  />
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="font-headline text-xl font-bold tracking-tight sm:text-2xl">{t("System Updates")}</h3>
            <div className="relative overflow-hidden rounded-xl border border-emerald-500/15 bg-[#191f31] p-6">
              <div className="absolute right-0 top-0 p-3">
                <span className="flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">{t("Status")}</span>
              <h4 className="mt-3 flex items-center gap-2 font-bold text-blue-100">
                <span className="material-symbols-outlined text-[20px] text-emerald-400" style={{ fontVariationSettings: "'FILL' 1" }}>
                  check_circle
                </span>
                {t("All systems operational")}
              </h4>
              <p className="mt-2 text-xs leading-relaxed text-[#c2c6d6]">
                {t("All providers are online and available. No incidents reported.")}
              </p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
