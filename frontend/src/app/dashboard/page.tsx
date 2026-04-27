"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { getHistory, type HistoryEntry } from "../../lib/history";
import { getProfile } from "../../lib/credits";
import { api } from "../../services/api";
import type { ModelCatalogEntry, SystemConfig } from "../../types";

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
  minimum: number;
  description: string;
  type: string;
  inputModalities: string[];
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

function flattenModelCatalog(models: Record<string, ModelCatalogEntry> | undefined): DashboardModelCard[] {
  return Object.entries(models || {}).map(([id, item]) => ({
    id,
    name: item.display_name || id,
    provider: item.provider || "unknown",
    modelId: item.model_id || id,
    minimum: typeof item.pricing?.minimum === "number" ? item.pricing.minimum : 0,
    description: item.description || "No description available in the current catalog cache.",
    type: item.type || "standard",
    inputModalities: item.input_modalities || [],
    outputModalities: item.output_modalities || [],
  }));
}

function groupModelsByProvider(models: DashboardModelCard[]) {
  return models.reduce<Record<string, DashboardModelCard[]>>((acc, model) => {
    const provider = model.provider || "unknown";
    if (!acc[provider]) acc[provider] = [];
    acc[provider].push(model);
    return acc;
  }, {});
}

function formatProviderName(value: string) {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatMinimumCredits(value: number) {
  if (value > 0 && value < 0.01) {
    return `${value.toFixed(3)} Cr`;
  }
  return `${value.toFixed(2)} Cr`;
}

function isRenderableImageUrl(value?: string) {
  return Boolean(value && (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/")));
}

const newsItems = [
  {
    badge: "New Launch",
    when: "Just Now",
    title: "Quick and Smart workflows are active",
    description: "Move straight to generation when you want speed, or pay the Smart analysis fee for extra prompt optimization.",
    link: "Learn more",
    badgeClass: "bg-blue-400/10 text-blue-400",
    slideClass: "slide-1",
  },
  {
    badge: "Community",
    when: "2h Ago",
    title: "Failed delivery protection is enabled",
    description: "When Vibecraft cannot deliver a usable result, reserved generation credits are released instead of captured.",
    link: "Review flow",
    badgeClass: "bg-[#d0bcff]/10 text-[#d0bcff]",
    slideClass: "slide-2",
  },
  {
    badge: "Platform",
    when: "Yesterday",
    title: "Admin protections already run live",
    description: "Login lockouts, warnings, rate limits, and audit flows are active across the admin surface.",
    link: "Open warnings",
    badgeClass: "bg-[#b9c8de]/10 text-[#b9c8de]",
    slideClass: "slide-3",
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
  }, [fetchConfig, fetchHistoryData, fetchProfile, user]);

  const imageModels = useMemo(() => flattenModelCatalog(config?.model_catalog?.image), [config]);
  const textModels = useMemo(() => flattenModelCatalog(config?.model_catalog?.caption), [config]);
  const imageProviders = useMemo(() => groupModelsByProvider(imageModels), [imageModels]);
  const textProviders = useMemo(() => groupModelsByProvider(textModels), [textModels]);
  const featuredHistory = history[0] ?? null;
  const latestItems = history.slice(0, 4);
  const heroProject = featuredHistory?.prompt || "Neural Landscapes v4";
  const featuredModel =
    imageModels.find((model) => /gemini/i.test(model.name) || /gemini/i.test(model.modelId)) ||
    imageModels[0] ||
    textModels[0] ||
    null;
  const secondaryModels = [...imageModels, ...textModels]
    .filter((model) => model.id !== featuredModel?.id)
    .sort((a, b) => a.minimum - b.minimum)
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
    <div className="space-y-12">
      <style jsx global>{`
        .slide-1 {
          animation: dashboardFadeInOut 15s infinite;
          animation-delay: 0s;
        }

        .slide-2 {
          animation: dashboardFadeInOut 15s infinite;
          animation-delay: 5s;
          opacity: 0;
        }

        .slide-3 {
          animation: dashboardFadeInOut 15s infinite;
          animation-delay: 10s;
          opacity: 0;
        }

        @keyframes dashboardFadeInOut {
          0% {
            opacity: 0;
            transform: translateY(10px);
            visibility: hidden;
          }
          2% {
            opacity: 1;
            transform: translateY(0);
            visibility: visible;
          }
          31% {
            opacity: 1;
            transform: translateY(0);
            visibility: visible;
          }
          33% {
            opacity: 0;
            transform: translateY(-10px);
            visibility: hidden;
          }
          100% {
            opacity: 0;
            visibility: hidden;
          }
        }
      `}</style>

      <section className="relative">
        <div className="space-y-2">
          <h2 className="font-headline text-4xl font-bold tracking-tighter text-blue-100">
            Welcome back, {user.displayName?.split(" ")[0] || user.email?.split("@")[0] || "Creator"}
          </h2>
          <p className="text-lg text-[#c2c6d6]">Your studio is ready for new dimensions.</p>
        </div>

        <div className="mt-8 grid grid-cols-12 gap-6">
          <div className="relative col-span-12 flex min-h-[240px] flex-col justify-between overflow-hidden rounded-xl border border-white/5 bg-[#151b2d] p-8 xl:col-span-8">
            <div className="absolute right-0 top-0 -mr-32 -mt-32 h-64 w-64 rounded-full bg-[#adc6ff]/10 blur-[80px]" />
            <div className="z-10">
              <span className="mb-4 block text-sm font-bold uppercase tracking-widest text-[#adc6ff]">Active Project</span>
              <h3 className="mb-2 font-headline text-2xl font-bold">{heroProject}</h3>
              <p className="max-w-md text-[#c2c6d6]">
                {featuredHistory
                  ? "Continue working on your high-fidelity concept and push it toward the next campaign deliverable."
                  : "Start a new session and build your next visual, caption, or multimodal concept from one studio."}
              </p>
            </div>
            <div className="z-10 flex gap-4">
              <Link href="/studio" className="rounded-md border border-white/5 bg-[#33394c] px-6 py-2 text-sm font-semibold transition-colors hover:bg-[#2e3447]">
                Resume Session
              </Link>
              <Link href="/gallery" className="px-6 py-2 text-sm font-semibold text-[#adc6ff] hover:underline">
                View All Files
              </Link>
            </div>
          </div>

          <div className="col-span-12 flex flex-col items-center justify-center space-y-4 rounded-xl border border-[#adc6ff]/10 bg-[#2e3447] p-8 text-center xl:col-span-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#571bc1]/30">
              <span className="material-symbols-outlined text-3xl text-[#d0bcff]" style={{ fontVariationSettings: "'FILL' 1" }}>
                bolt
              </span>
            </div>
            <div>
              <span className="font-headline text-4xl font-bold text-blue-100">
                {currentCredits === null ? "..." : currentCredits.toFixed(2)}
              </span>
              <p className="mt-1 text-sm font-medium text-[#c2c6d6]">Available Credits</p>
            </div>
            <Link href="/credits" className="w-full rounded-md border border-white/5 bg-[#23293c] py-2 text-xs font-bold uppercase tracking-widest transition-all hover:border-[#adc6ff]/40">
              Top Up Balance
            </Link>
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className="flex items-end justify-between">
          <h3 className="font-headline text-2xl font-bold tracking-tight">Latest Generations</h3>
          <Link href="/gallery" className="flex items-center gap-1 text-sm font-medium text-[#adc6ff] hover:underline">
            Explore Gallery <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
          {historyLoading
            ? Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="group cursor-pointer">
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
                <div key={entry.id} className="group cursor-pointer">
                  <div className="relative mb-3 aspect-[4/5] overflow-hidden rounded-xl border border-white/5 bg-[#151b2d]">
                    {isRenderableImageUrl(entry.imageUrl) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={entry.imageUrl} alt={entry.prompt} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" />
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

      <div className="grid grid-cols-12 gap-10">
        <section className="col-span-12 space-y-6 xl:col-span-8">
          <div className="flex items-center gap-3">
            <h3 className="font-headline text-2xl font-bold tracking-tight">Available Models</h3>
            <span className="rounded bg-[#adc6ff]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#adc6ff]">
              New Arrivals
            </span>
          </div>

          {featuredModel ? (
            <div className="overflow-hidden rounded-xl border border-[#adc6ff]/20 bg-[#151b2d]">
              <div className="space-y-6 p-8">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[#4d8eff]/20">
                      <span className="material-symbols-outlined text-3xl text-[#adc6ff]" style={{ fontVariationSettings: "'FILL' 1" }}>
                        temp_preferences_custom
                      </span>
                    </div>
                    <div>
                      <h4 className="font-headline text-xl font-bold text-blue-100">{featuredModel.name}</h4>
                      <div className="mt-1 flex gap-3">
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
                  <div className="text-right">
                    <span className="font-headline text-2xl font-bold text-[#adc6ff]">{formatMinimumCredits(featuredModel.minimum)}</span>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#c2c6d6]">Minimum</p>
                  </div>
                </div>

                <p className="max-w-2xl leading-relaxed text-[#dce1fb]">{featuredModel.description}</p>

                <div className="grid grid-cols-2 gap-4 border-y border-white/5 py-4">
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Input Formats</p>
                    <div className="flex gap-2">
                      {(featuredModel.inputModalities.length ? featuredModel.inputModalities : ["TEXT"]).map((item) => (
                        <span key={item} className="rounded-full bg-[#191f31] px-3 py-1 text-xs font-medium">
                          {item.toUpperCase()}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Output Formats</p>
                    <div className="flex gap-2">
                      {(featuredModel.outputModalities.length ? featuredModel.outputModalities : ["TEXT"]).map((item) => (
                        <span key={item} className="rounded-full bg-[#191f31] px-3 py-1 text-xs font-medium">
                          {item.toUpperCase()}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <Link href="/studio" className="block w-full rounded-xl bg-[linear-gradient(135deg,#adc6ff_0%,#4d8eff_100%)] py-3 text-center font-bold text-[#002e6a] transition-opacity hover:opacity-90">
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
                className="group flex items-center justify-between rounded-xl border border-white/5 bg-[#070d1f] p-5 transition-colors hover:bg-[#151b2d]"
              >
                <div className="flex items-center gap-4">
                  <div className={`flex h-10 w-10 items-center justify-center rounded ${index === 0 ? "bg-[#571bc1]/20 text-[#d0bcff]" : "bg-[#8392a6]/20 text-[#b9c8de]"}`}>
                    <span className="material-symbols-outlined">{index === 0 ? "brush" : "high_quality"}</span>
                  </div>
                  <div>
                    <h5 className="font-bold text-blue-100">{model.name}</h5>
                    <p className="text-xs text-[#c2c6d6]">{model.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <span className="text-sm font-bold text-slate-300">{formatMinimumCredits(model.minimum)}</span>
                    <p className="text-[8px] font-bold uppercase text-slate-500">Minimum</p>
                  </div>
                  <span className="material-symbols-outlined text-slate-600 transition-colors group-hover:text-[#adc6ff]">arrow_forward_ios</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <aside className="col-span-12 space-y-8 xl:col-span-4">
          <section className="space-y-4">
            <h3 className="font-headline text-2xl font-bold tracking-tight">Studio News</h3>
            <div className="relative h-48 overflow-hidden rounded-xl border border-blue-400/20 bg-[#151b2d]">
              {newsItems.map((item) => (
                <div key={item.title} className={`absolute inset-0 flex flex-col justify-between p-6 ${item.slideClass}`}>
                  <div className="flex items-center justify-between">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${item.badgeClass}`}>
                      {item.badge}
                    </span>
                    <span className="text-[10px] font-bold text-slate-500">{item.when}</span>
                  </div>
                  <div>
                    <h4 className="mb-1 text-lg font-bold text-blue-100">{item.title}</h4>
                    <p className="text-xs leading-relaxed text-[#c2c6d6]">{item.description}</p>
                  </div>
                  <Link href="/studio" className="flex items-center gap-1 self-start text-xs font-bold text-[#adc6ff] hover:underline">
                    {item.link} <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                  </Link>
                </div>
              ))}
              <div className="absolute bottom-4 right-6 flex gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-blue-400 opacity-100" />
                <div className="h-1.5 w-1.5 rounded-full bg-slate-600" />
                <div className="h-1.5 w-1.5 rounded-full bg-slate-600" />
              </div>
            </div>
          </section>

          <section className="space-y-6">
            <h3 className="font-headline text-2xl font-bold tracking-tight">System Updates</h3>
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
