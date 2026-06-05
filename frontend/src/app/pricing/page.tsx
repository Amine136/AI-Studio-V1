"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import type { ModelCatalogEntry, PlainChatModelItem, SystemConfig } from "../../types";

/* ── Types ── */

interface TextModelRow {
  id: string;
  name: string;
  provider: string;
  inputTokenPrice: string;
  outputTokenPrice: string;
  cachedInputTokenPrice?: string;
}

interface ImageModelRow {
  id: string;
  name: string;
  provider: string;
  sizePrices: Record<string, string>;
}

/* ── Helpers ── */

function toProviderLabel(provider: string) {
  const normalized = provider.trim().toLowerCase();
  if (!normalized) return "Other";
  return normalized
    .split(/[\s_-]+/)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function formatPrice(raw: string | number | undefined): string {
  if (raw === undefined || raw === null || raw === "") return "—";
  const num = Number(raw);
  if (!Number.isFinite(num)) return "—";
  if (num === 0) return "Free";
  if (num < 0.001) return `${num.toFixed(4)} Cr`;
  if (num < 0.01) return `${num.toFixed(3)} Cr`;
  return `${num.toFixed(2)} Cr`;
}

/* ── Data builders ── */

function buildTextModels(
  plainChatModels: PlainChatModelItem[],
  config: SystemConfig | null,
): TextModelRow[] {
  const seen = new Map<string, TextModelRow>();

  // Build a lookup of plain chat models for display name / provider enrichment
  const chatDisplayNames = new Map<string, { displayName: string; provider: string }>();
  for (const model of plainChatModels) {
    chatDisplayNames.set(model.id.toLowerCase(), {
      displayName: model.displayName,
      provider: model.provider || "",
    });
  }

  // Caption models from catalog
  const captionModels = config?.model_catalog?.caption;
  if (captionModels && typeof captionModels === "object") {
    for (const [modelId, rawEntry] of Object.entries(captionModels)) {
      const entry = rawEntry as ModelCatalogEntry & { billing?: any };
      const billing = entry.billing;
      if (!billing) continue;

      const textBilling = billing.text;
      if (!textBilling || typeof textBilling !== "object") continue;

      const chatInfo = chatDisplayNames.get(modelId.toLowerCase());
      const displayName = entry.display_name || chatInfo?.displayName || modelId;
      const key = displayName.toLowerCase();
      if (seen.has(key)) continue;

      seen.set(key, {
        id: `caption:${modelId}`,
        name: displayName,
        provider: toProviderLabel(entry.provider || chatInfo?.provider || ""),
        inputTokenPrice: textBilling.inputTokenPrice ?? "",
        outputTokenPrice: textBilling.outputTokenPrice ?? "",
        cachedInputTokenPrice: textBilling.cachedInputTokenPrice,
      });
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function buildImageModels(config: SystemConfig | null): ImageModelRow[] {
  const items: ImageModelRow[] = [];

  const imageModels = config?.model_catalog?.image;
  if (imageModels && typeof imageModels === "object") {
    for (const [modelId, rawEntry] of Object.entries(imageModels)) {
      const entry = rawEntry as ModelCatalogEntry & { billing?: any };
      const billing = entry.billing;
      if (!billing) continue;

      const image = billing.image || billing;
      const sizePrices: Record<string, string> = {};

      if (image?.imageSizePrices && typeof image.imageSizePrices === "object") {
        for (const [size, price] of Object.entries(image.imageSizePrices)) {
          sizePrices[size] = String(price);
        }
      }
      if (image?.sampleImageSizePrices && typeof image.sampleImageSizePrices === "object") {
        for (const [size, price] of Object.entries(image.sampleImageSizePrices)) {
          sizePrices[`Sample ${size}`] = String(price);
        }
      }

      // If no size prices, show base price
      if (Object.keys(sizePrices).length === 0 && image?.basePrice) {
        sizePrices["Base"] = String(image.basePrice);
      }
      if (Object.keys(sizePrices).length === 0 && billing?.fixed?.amount) {
        sizePrices["Fixed"] = String(billing.fixed.amount);
      }

      items.push({
        id: `image:${modelId}`,
        name: entry.display_name || modelId,
        provider: toProviderLabel(entry.provider || ""),
        sizePrices,
      });
    }
  }

  return items.sort((a, b) => a.name.localeCompare(b.name));
}

/* ── Skeletons ── */

function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-white/[0.04] bg-white/[0.01] p-6 animate-pulse">
      <div className="flex justify-between items-start mb-6">
        <div className="h-5 w-32 bg-white/[0.05] rounded-md" />
        <div className="h-5 w-16 bg-white/[0.05] rounded-md" />
      </div>
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div className="h-4 w-12 bg-white/[0.05] rounded-md" />
          <div className="h-4 w-16 bg-white/[0.05] rounded-md" />
        </div>
        <div className="flex justify-between items-center">
          <div className="h-4 w-12 bg-white/[0.05] rounded-md" />
          <div className="h-4 w-16 bg-white/[0.05] rounded-md" />
        </div>
      </div>
    </div>
  );
}

/* ── Page ── */

export default function PricingPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [plainChatModels, setPlainChatModels] = useState<PlainChatModelItem[]>([]);
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);
  const [pricingLoading, setPricingLoading] = useState(true);
  const [activeProvider, setActiveProvider] = useState<string>("All");

  useEffect(() => {
    if (!authLoading && !user) router.replace("/auth");
  }, [authLoading, router, user]);

  const fetchPricing = useCallback(async () => {
    if (!user) return;
    setPricingLoading(true);
    try {
      const [plainChatResponse, configResponse] = await Promise.all([
        api.getPlainChatModels(),
        api.getConfig(),
      ]);
      setPlainChatModels(Array.isArray(plainChatResponse.models) ? plainChatResponse.models : []);
      setSystemConfig(configResponse);
    } catch {
      setPlainChatModels([]);
      setSystemConfig(null);
    } finally {
      setPricingLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) void fetchPricing();
  }, [fetchPricing, user]);

  const textModels = useMemo(() => buildTextModels(plainChatModels, systemConfig), [plainChatModels, systemConfig]);
  const imageModels = useMemo(() => buildImageModels(systemConfig), [systemConfig]);

  const allProviders = useMemo(() => {
    const set = new Set<string>();
    textModels.forEach((m) => set.add(m.provider));
    imageModels.forEach((m) => set.add(m.provider));
    return ["All", ...Array.from(set).sort()];
  }, [textModels, imageModels]);

  const filteredTextModels = useMemo(() => {
    return activeProvider === "All" 
      ? textModels 
      : textModels.filter((m) => m.provider === activeProvider);
  }, [textModels, activeProvider]);

  const filteredImageModels = useMemo(() => {
    return activeProvider === "All" 
      ? imageModels 
      : imageModels.filter((m) => m.provider === activeProvider);
  }, [imageModels, activeProvider]);

  if (authLoading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0c1324]">
        <div className="auth-loader" />
      </main>
    );
  }

  return (
    <div className="relative min-h-full overflow-hidden pb-20">
      {/* Background Atmospheric Glows */}
      <div className="pointer-events-none fixed inset-0 z-0" style={{ background: "radial-gradient(circle at 50% 50%, rgba(59,130,246,0.04) 0%, transparent 60%)" }} />
      <div className="pointer-events-none fixed left-[-10%] top-[-10%] z-0 h-[50%] w-[50%] rounded-full bg-[#3b82f6]/5 blur-[120px]" />
      <div className="pointer-events-none fixed bottom-[-10%] right-[-10%] z-0 h-[50%] w-[50%] rounded-full bg-[#8b5cf6]/5 blur-[120px]" />

      <div className="relative z-10 mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-16 md:py-20">
        
        {/* Header */}
        <header className="mx-auto max-w-3xl text-center animate-fade-in-up mb-12 sm:mb-16">
          <h1 className="mb-4 font-headline text-4xl font-bold tracking-tighter leading-tight gradient-text sm:mb-6 md:text-6xl pb-2">
            Model Pricing
          </h1>
          <p className="text-[#94a3b8] text-sm sm:text-lg sm:leading-relaxed">
            Transparent, usage-based pricing. Pay only for the tokens you compute and the images you generate.
          </p>
        </header>

        {/* Filters */}
        {!pricingLoading && allProviders.length > 1 && (
          <div className="flex flex-wrap justify-center gap-2 mb-12 animate-fade-in-up" style={{ animationDelay: "100ms" }}>
            {allProviders.map((provider) => (
              <button
                key={provider}
                onClick={() => setActiveProvider(provider)}
                className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-300 ${
                  activeProvider === provider
                    ? "bg-[#3b82f6] text-white shadow-[0_0_20px_rgba(59,130,246,0.4)] border border-[#3b82f6]"
                    : "bg-white/[0.02] border border-white/[0.08] text-[#94a3b8] hover:text-white hover:bg-white/[0.06] hover:border-white/[0.15]"
                }`}
              >
                {provider}
              </button>
            ))}
          </div>
        )}

        <div className="space-y-16">
          
          {/* ── Text Models ── */}
          <section className="animate-fade-in-up" style={{ animationDelay: "150ms" }}>
            <div className="mb-6 flex items-center gap-3 pl-2 sm:mb-8">
              <span className="material-symbols-outlined text-3xl text-[#3b82f6]" style={{ fontVariationSettings: "'FILL' 1" }}>
                description
              </span>
              <h2 className="font-headline text-2xl font-semibold tracking-tight sm:text-3xl">Text Models</h2>
              <span className="ml-4 text-[10px] uppercase tracking-[0.22em] text-[#3b82f6]/70 border border-[#3b82f6]/20 bg-[#3b82f6]/10 px-2 py-1 rounded-md hidden sm:inline-block">Per 1M Tokens</span>
            </div>

            {pricingLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <CardSkeleton />
                <CardSkeleton />
                <CardSkeleton />
              </div>
            ) : filteredTextModels.length ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredTextModels.map((model) => (
                  <div key={model.id} className="relative group rounded-2xl border border-white/[0.06] bg-white/[0.01] backdrop-blur-sm p-6 transition-all duration-300 hover:border-white/[0.15] hover:bg-white/[0.03] hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
                    <div className="absolute inset-0 bg-gradient-to-br from-[#3b82f6]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-2xl pointer-events-none" />
                    
                    <div className="relative z-10 flex flex-col h-full">
                      <div className="flex justify-between items-start mb-6">
                        <h3 className="font-headline text-lg font-semibold text-[#f1f5f9] leading-snug pr-2">{model.name}</h3>
                        <span className="shrink-0 text-[11px] px-2.5 py-1 rounded-md bg-white/[0.05] text-[#94a3b8] font-medium border border-white/[0.05]">
                          {model.provider}
                        </span>
                      </div>
                      
                      <div className="mt-2 space-y-3">
                        <div className="flex justify-between items-center text-sm border-b border-white/[0.04] pb-3">
                          <span className="text-[#64748b]">Input <span className="text-[10px] uppercase ml-1 opacity-70">/ 1M</span></span>
                          <span className="text-[#f8fafc] font-medium">{formatPrice(model.inputTokenPrice)}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm border-b border-white/[0.04] pb-3">
                          <span className="text-[#64748b]">Output <span className="text-[10px] uppercase ml-1 opacity-70">/ 1M</span></span>
                          <span className="text-[#f8fafc] font-medium">{formatPrice(model.outputTokenPrice)}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm pt-1">
                          <span className="text-[#64748b]">Cached Input</span>
                          <span className="text-[#94a3b8] font-medium">{model.cachedInputTokenPrice ? formatPrice(model.cachedInputTokenPrice) : "—"}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.01] px-8 py-16 text-center text-sm text-[#64748b]">
                No text models available for this provider.
              </div>
            )}
          </section>

          {/* ── Image Models ── */}
          <section className="animate-fade-in-up" style={{ animationDelay: "200ms" }}>
            <div className="mb-6 flex items-center gap-3 pl-2 sm:mb-8">
              <span className="material-symbols-outlined text-3xl text-[#8b5cf6]" style={{ fontVariationSettings: "'FILL' 1" }}>
                image
              </span>
              <h2 className="font-headline text-2xl font-semibold tracking-tight sm:text-3xl">Image Models</h2>
              <span className="ml-4 text-[10px] uppercase tracking-[0.22em] text-[#8b5cf6]/70 border border-[#8b5cf6]/20 bg-[#8b5cf6]/10 px-2 py-1 rounded-md hidden sm:inline-block">Per Image</span>
            </div>

            {pricingLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <CardSkeleton />
                <CardSkeleton />
                <CardSkeleton />
              </div>
            ) : filteredImageModels.length ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredImageModels.map((model) => (
                  <div key={model.id} className="relative group rounded-2xl border border-white/[0.06] bg-white/[0.01] backdrop-blur-sm p-6 transition-all duration-300 hover:border-white/[0.15] hover:bg-white/[0.03] hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)] flex flex-col">
                    <div className="absolute inset-0 bg-gradient-to-br from-[#8b5cf6]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-2xl pointer-events-none" />
                    
                    <div className="relative z-10 flex flex-col h-full">
                      <div className="flex justify-between items-start mb-6">
                        <h3 className="font-headline text-lg font-semibold text-[#f1f5f9] leading-snug pr-2">{model.name}</h3>
                        <span className="shrink-0 text-[11px] px-2.5 py-1 rounded-md bg-white/[0.05] text-[#94a3b8] font-medium border border-white/[0.05]">
                          {model.provider}
                        </span>
                      </div>
                      
                      <div className="mt-2 space-y-3">
                        {Object.entries(model.sizePrices).map(([size, price], idx) => (
                          <div key={size} className={`flex justify-between items-center text-sm ${idx < Object.keys(model.sizePrices).length - 1 ? 'border-b border-white/[0.04] pb-3' : 'pt-1'}`}>
                            <span className="text-[#64748b] truncate pr-4">{size}</span>
                            <span className="text-[#f8fafc] font-medium shrink-0">{formatPrice(price)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.01] px-8 py-16 text-center text-sm text-[#64748b]">
                No image models available for this provider.
              </div>
            )}
          </section>

          {/* Info Footer */}
          <section className="animate-fade-in-up mx-auto max-w-4xl pt-8" style={{ animationDelay: "250ms" }}>
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 text-center shadow-sm">
              <p className="text-sm leading-relaxed text-[#64748b]">
                All prices are in <span className="font-medium text-[#f1f5f9]">Credits (Cr)</span>. Text model costs are per <span className="font-medium text-[#f1f5f9]">1 million tokens</span> processed. Image model costs are per <span className="font-medium text-[#f1f5f9]">generated image</span> at the specified resolution. Smart Creation adds an analysis fee before applying model costs. Prices update in real time.
              </p>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
