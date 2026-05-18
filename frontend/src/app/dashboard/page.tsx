"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import AuthenticatedImage from "../../components/AuthenticatedImage";
import { getHistory, type HistoryEntry } from "../../lib/history";
import { getProfile } from "../../lib/credits";
import { api } from "../../services/api";
import type { DashboardNewsItem, ModelCatalogEntry, OutputType, SystemConfig } from "../../types";

interface SuspensionState {
  reason: string;
  endsAt: string | null;
  endsAtLabel: string | null;
}

type DashboardModelCard = {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  description: string;
  type: string;
  inputModalities: string[];
  outputModalities: string[];
};

type DashboardTemplate = {
  title: string;
  description: string;
  href: string;
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

function flattenModelCatalog(models: Record<string, ModelCatalogEntry> | undefined): DashboardModelCard[] {
  return Object.entries(models || {}).map(([id, item]) => ({
    id,
    name: item.display_name || id,
    provider: item.provider || "unknown",
    modelId: item.model_id || id,
    description: item.description || "No description available in the current catalog cache.",
    type: item.type || "standard",
    inputModalities: item.input_modalities || [],
    outputModalities: item.output_modalities || [],
  }));
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

function buildTemplateHref(outputs: OutputType[], idea: string) {
  const params = new URLSearchParams({
    idea,
    outputs: outputs.join(","),
  });
  return `/studio/create?${params.toString()}`;
}

const dashboardTemplates: DashboardTemplate[] = [
  {
    title: "Viral Script",
    description: "Hook a trend fast with a punchy social concept built for comments, saves, and reposts.",
    href: buildTemplateHref(
      ["caption"],
      "Write a short, high-engagement social script with a bold hook, a fast payoff, and a CTA people want to comment on.",
    ),
  },
  {
    title: "Product Art",
    description: "Seed a premium product-shot direction with polished lighting, tactile detail, and campaign-ready framing.",
    href: buildTemplateHref(
      ["image"],
      "Create a premium product-shot concept with luxury lighting, refined materials, crisp reflections, and a clean editorial backdrop.",
    ),
  },
  {
    title: "Blog Outline",
    description: "Start article planning with a structured concept that turns one idea into a clear publishable outline.",
    href: buildTemplateHref(
      ["caption"],
      "Build a structured blog outline with a sharp working title, key sections, talking points, and practical takeaways for readers.",
    ),
  },
];

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [currentCredits, setCurrentCredits] = useState<number | null>(null);
  const [suspension, setSuspension] = useState<SuspensionState | null>(null);
  const [newsItems, setNewsItems] = useState<DashboardNewsItem[]>(defaultNewsItems);
  const [activeTemplateIndex, setActiveTemplateIndex] = useState(0);
  const [activeNewsIndex, setActiveNewsIndex] = useState(0);

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

  const fetchConfig = useCallback(async () => {
    const nextConfig = await api.getConfig();
    setConfig(nextConfig);
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
    void fetchConfig();
    void fetchProfile();
    void fetchDashboardNews();
  }, [fetchConfig, fetchDashboardNews, fetchHistoryData, fetchProfile, user]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setActiveTemplateIndex((current) => (current + 1) % dashboardTemplates.length);
    }, 6000);

    return () => window.clearInterval(intervalId);
  }, []);

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

  const imageModels = useMemo(() => flattenModelCatalog(config?.model_catalog?.image), [config]);
  const textModels = useMemo(() => flattenModelCatalog(config?.model_catalog?.caption), [config]);
  const latestItems = history.slice(0, 4);
  const featuredModel =
    imageModels.find((model) => model.id === "gemini-3-pro-image-preview" || /nano banana pro/i.test(model.name)) ||
    imageModels.find((model) => /gemini/i.test(model.name) || /gemini/i.test(model.modelId)) ||
    imageModels[0] ||
    textModels[0] ||
    null;
  const secondaryModels = [...imageModels, ...textModels]
    .filter((model) => model.id !== featuredModel?.id)
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 2);
  const systemCards = [
    {
      title: imageModels[0] ? formatProviderName(imageModels[0].provider) : "Retro-Future Challenge",
      subtitle: imageModels[0] ? "Provider • Active" : "Community • Ends in 2d",
      icon: "image",
    },
    {
      title: textModels[0] ? formatProviderName(textModels[0].provider) : "Color Theory Mastery",
      subtitle: textModels[0] ? "Provider • Active" : "Tutorial • New",
      icon: "notes",
    },
  ];

  if (authLoading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="auth-loader" />
      </main>
    );
  }

  if (suspension) {
    return (
      <section className="rounded-xl border border-[#93000a]/20 bg-[#151b2d] p-10">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-md border border-[#93000a]/30 bg-[#93000a]/10 text-[#ffb4ab]">
            <span className="material-symbols-outlined text-3xl">gpp_bad</span>
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#ffb4ab]/80">Account Restricted</p>
          <h2 className="mt-3 font-headline text-3xl font-bold text-[#dce1fb]">This account is currently suspended</h2>
          <p className="mt-4 text-sm leading-7 text-[#c2c6d6]">{suspension.reason}</p>
          <div className="mt-6 rounded-md border border-white/10 bg-[#070d1f] px-5 py-4 text-left">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8c909f]">Status</p>
            <p className="mt-2 text-base font-semibold text-[#dce1fb]">{suspension.endsAtLabel || "Suspended until admin review"}</p>
          </div>
          <div className="mt-6">
            <Link href="/policy" className="inline-flex rounded-sm border border-white/10 bg-[#070d1f] px-4 py-2 text-sm text-[#c2c6d6] transition hover:border-[#adc6ff]/30 hover:text-[#dce1fb]">
              View Usage Policy
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-8 sm:space-y-12">
      <section className="relative">
        <div className="space-y-2">
          <h2 className="font-headline text-2xl font-bold tracking-tighter text-blue-100 sm:text-4xl">
            Welcome, {user.displayName?.split(" ")[0] || user.email?.split("@")[0] || "Creator"}
          </h2>
          <p className="text-sm text-[#c2c6d6] sm:text-lg">Your studio is ready for new dimensions.</p>
        </div>

        <div className="mt-6 grid grid-cols-12 gap-4 sm:mt-8 sm:gap-6">
          <div className="relative col-span-12 min-h-[220px] overflow-hidden rounded-xl border border-white/5 bg-[#151b2d] p-5 sm:min-h-[240px] sm:p-8 xl:col-span-8">
            <div className="absolute right-0 top-0 -mr-32 -mt-32 h-64 w-64 rounded-full bg-[#adc6ff]/10 blur-[80px]" />
            <div className="relative z-10 h-full min-h-[180px] sm:min-h-[176px]">
              {dashboardTemplates.map((template, index) => {
                const isActive = index === activeTemplateIndex;
                return (
                  <div
                    key={template.title}
                    aria-hidden={!isActive}
                    className={`absolute inset-0 flex h-full flex-col justify-between transition-all duration-700 ${
                      isActive ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"
                    }`}
                  >
                    <div>
                      <span className="mb-3 block text-xs font-bold uppercase tracking-widest text-[#adc6ff] sm:mb-4 sm:text-sm">
                        Quick Start Templates
                      </span>
                      <h3 className="mb-2 font-headline text-2xl font-bold text-blue-100 sm:mb-3 sm:text-3xl">{template.title}</h3>
                      <p className="max-w-xl text-sm leading-6 text-[#c2c6d6] sm:text-base sm:leading-7">{template.description}</p>
                    </div>

                    <div className="flex items-end justify-between gap-3">
                      <div className="flex gap-2">
                        {dashboardTemplates.map((item, dotIndex) => (
                          <span
                            key={item.title}
                            className={`h-2 w-2 rounded-full transition-colors ${
                              dotIndex === activeTemplateIndex ? "bg-[#adc6ff]" : "bg-white/15"
                            }`}
                          />
                        ))}
                      </div>
                      <Link
                        href={template.href}
                        className="rounded-md border border-[#adc6ff]/30 bg-[#adc6ff] px-4 py-2.5 text-sm font-bold text-[#032a61] transition-colors hover:bg-[#c1d5ff] sm:px-6 sm:py-3"
                      >
                        Use Template
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="col-span-12 flex items-center justify-between gap-4 rounded-xl border border-[#adc6ff]/10 bg-[#2e3447] p-5 text-left sm:flex-col sm:justify-center sm:space-y-4 sm:p-8 sm:text-center xl:col-span-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#571bc1]/30 sm:h-16 sm:w-16">
              <span className="material-symbols-outlined text-3xl text-[#d0bcff]" style={{ fontVariationSettings: "'FILL' 1" }}>
                bolt
              </span>
            </div>
            <div>
              <span className="font-headline text-2xl font-bold text-blue-100 sm:text-4xl">
                {currentCredits === null ? "..." : currentCredits.toFixed(2)}
              </span>
              <p className="mt-1 text-sm font-medium text-[#c2c6d6]">Available Credits</p>
            </div>
            <Link href="/credits" className="shrink-0 rounded-md border border-white/5 bg-[#23293c] px-4 py-2 text-xs font-bold uppercase tracking-widest transition-all hover:border-[#adc6ff]/40 sm:w-full">
              Top Up Balance
            </Link>
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className="flex items-end justify-between gap-3">
          <h3 className="font-headline text-xl font-bold tracking-tight sm:text-2xl">Latest Generations</h3>
          <Link href="/gallery" className="flex items-center gap-1 text-sm font-medium text-[#adc6ff] hover:underline">
            Explore Gallery <span className="material-symbols-outlined text-sm">arrow_forward</span>
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
                  <h4 className="font-semibold text-blue-100">Loading...</h4>
                  <p className="text-xs text-[#c2c6d6]">Syncing...</p>
                </div>
              ))
            : latestItems.map((entry) => (
                <div key={entry.id} className="group w-[58vw] max-w-[220px] shrink-0 snap-start cursor-pointer md:w-auto md:max-w-none">
                  <div className="relative mb-3 aspect-[4/5] overflow-hidden rounded-xl border border-white/5 bg-[#151b2d]">
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
                  <h4 className="font-semibold text-blue-100">{entry.prompt.slice(0, 24) || "Untitled"}</h4>
                  <p className="text-xs text-[#c2c6d6]">
                    {entry.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </div>
              ))}
        </div>
      </section>

      <div className="grid grid-cols-12 gap-8 sm:gap-10">
        <section className="col-span-12 space-y-6 xl:col-span-8">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-headline text-xl font-bold tracking-tight sm:text-2xl">Available Models</h3>
            <span className="rounded bg-[#adc6ff]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#adc6ff]">
              New Arrivals
            </span>
          </div>

          {featuredModel ? (
            <div className="overflow-hidden rounded-xl border border-[#adc6ff]/20 bg-[#151b2d]">
              <div className="space-y-5 p-5 sm:space-y-6 sm:p-8">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[#4d8eff]/20">
                      <span className="material-symbols-outlined text-3xl text-[#adc6ff]" style={{ fontVariationSettings: "'FILL' 1" }}>
                        temp_preferences_custom
                      </span>
                    </div>
                    <div>
                      <h4 className="font-headline text-lg font-bold text-blue-100 sm:text-xl">{featuredModel.name}</h4>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        <span className="flex items-center gap-1 text-[10px] font-bold uppercase text-[#c2c6d6]">
                          <span className="h-1 w-1 rounded-full bg-[#adc6ff]" />
                          {formatProviderName(featuredModel.provider)}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] font-bold uppercase text-[#c2c6d6]">
                          <span className="h-1 w-1 rounded-full bg-[#adc6ff]" />
                          {featuredModel.modelId}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <p className="max-w-2xl leading-relaxed text-[#dce1fb]">{featuredModel.description}</p>

                <Link href="/studio/start" className="block w-full rounded-xl bg-[linear-gradient(135deg,#adc6ff_0%,#4d8eff_100%)] py-3 text-center font-bold text-[#002e6a] transition-opacity hover:opacity-90">
                  Launch {featuredModel.name} Studio
                </Link>
              </div>
            </div>
          ) : null}

          <div className="space-y-4">
            {secondaryModels.map((model, index) => (
              <Link
                key={model.id}
                href="/studio"
                className="group flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-[#070d1f] p-4 transition-colors hover:bg-[#151b2d] sm:p-5"
              >
                <div className="flex items-center gap-4">
                  <div className={`flex h-10 w-10 items-center justify-center rounded ${index === 0 ? "bg-[#571bc1]/20 text-[#d0bcff]" : "bg-[#8392a6]/20 text-[#b9c8de]"}`}>
                    <span className="material-symbols-outlined">{index === 0 ? "brush" : "high_quality"}</span>
                  </div>
                  <div className="min-w-0">
                    <h5 className="font-bold text-blue-100">{model.name}</h5>
                    <p className="line-clamp-2 text-xs text-[#c2c6d6]">{model.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <span className="material-symbols-outlined text-slate-600 transition-colors group-hover:text-[#adc6ff]">arrow_forward_ios</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <aside className="col-span-12 space-y-8 xl:col-span-4">
          <section className="space-y-4">
            <h3 className="font-headline text-xl font-bold tracking-tight sm:text-2xl">Studio News</h3>
            <div className="relative h-48 overflow-hidden rounded-xl border border-blue-400/20 bg-[#151b2d]">
              {newsItems.map((item, index) => (
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
                    <h4 className="mb-1 text-lg font-bold text-blue-100">{item.title}</h4>
                    <p className="text-xs leading-relaxed text-[#c2c6d6]">{item.description}</p>
                  </div>
                  <Link href={item.linkHref || "/studio"} className="flex items-center gap-1 self-start text-xs font-bold text-[#adc6ff] hover:underline">
                    {item.linkLabel || "Learn more"} <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                  </Link>
                </div>
              ))}
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

          <section className="space-y-6">
            <h3 className="font-headline text-xl font-bold tracking-tight sm:text-2xl">System Updates</h3>
            <div className="space-y-6">
              <div className="relative overflow-hidden rounded-xl border border-white/5 bg-[#191f31] p-6">
                <div className="absolute right-0 top-0 p-2">
                  <span className="flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#adc6ff] opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[#adc6ff]" />
                  </span>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#adc6ff]">Maintenance</span>
                <h4 className="mt-3 font-bold text-blue-100">V4 Engine Migration</h4>
                <p className="mt-2 text-xs leading-relaxed text-[#c2c6d6]">
                  We&apos;re upgrading our underlying inference engine. Expect 2x faster generations and cleaner model routing after the rollout.
                </p>
              </div>

              <div className="space-y-4">
                {systemCards.map((item) => (
                  <div key={item.title} className="group flex cursor-pointer gap-4">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-[#151b2d] grayscale transition-all group-hover:grayscale-0">
                      <div className="flex h-full w-full items-center justify-center text-[#adc6ff]">
                        <span className="material-symbols-outlined">{item.icon}</span>
                      </div>
                    </div>
                    <div>
                      <h5 className="text-sm font-bold text-blue-100 transition-colors group-hover:text-[#adc6ff]">{item.title}</h5>
                      <p className="mt-1 text-[10px] font-bold uppercase text-slate-500">{item.subtitle}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
