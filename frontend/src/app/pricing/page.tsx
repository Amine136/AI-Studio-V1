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
  if (!normalized) return "AI Provider";
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

  // Caption models from catalog — these have the raw billing.text with token prices
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

function collectAllImageSizeColumns(rows: ImageModelRow[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.sizePrices)) {
      set.add(key);
    }
  }
  return Array.from(set);
}

/* ── Skeleton ── */

function TableSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-0">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-6 border-b border-white/[0.06] px-8 py-5 last:border-b-0">
          <div className="h-5 w-40 animate-shimmer rounded-md" />
          <div className="ml-auto h-4 w-20 animate-shimmer rounded-md" />
          <div className="h-4 w-20 animate-shimmer rounded-md" />
        </div>
      ))}
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
  const imageSizeColumns = useMemo(() => collectAllImageSizeColumns(imageModels), [imageModels]);

  if (authLoading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0c1324]">
        <div className="auth-loader" />
      </main>
    );
  }

  return (
    <div className="relative min-h-full overflow-hidden">
      {/* Background Atmospheric Glows */}
      <div className="pointer-events-none fixed inset-0 z-0" style={{ background: "radial-gradient(circle at 50% 50%, rgba(59,130,246,0.06) 0%, transparent 70%)" }} />
      <div className="pointer-events-none fixed left-[-10%] top-[-10%] z-0 h-[40%] w-[40%] rounded-full bg-[#3b82f6]/5 blur-[120px]" />
      <div className="pointer-events-none fixed bottom-[-10%] right-[-10%] z-0 h-[40%] w-[40%] rounded-full bg-[#8b5cf6]/5 blur-[120px]" />

      <div className="relative z-10 mx-auto w-full max-w-5xl space-y-12 px-4 py-8 sm:px-6 sm:py-16 md:space-y-20 md:py-24">
        {/* Header */}
        <header className="mx-auto max-w-2xl text-center animate-fade-in-up">
          <h1 className="mb-4 font-headline text-4xl font-bold tracking-tighter leading-tight gradient-text sm:mb-6 md:text-6xl">
            Model Pricing
          </h1>
          <p className="text-sm leading-6 text-[#94a3b8] sm:text-lg sm:leading-relaxed md:text-xl">
            Transparent, usage-based pricing. Pay only for the tokens you compute and the images you generate.
          </p>
        </header>

        {/* ── Text Models ── */}
        <section className="animate-fade-in-up" style={{ animationDelay: "160ms" }}>
          <div className="mb-4 flex items-center gap-3 sm:mb-6 sm:gap-4 sm:pl-4">
            <span className="material-symbols-outlined text-3xl text-[#3b82f6]" style={{ fontVariationSettings: "'FILL' 1" }}>
              description
            </span>
            <h2 className="font-headline text-2xl font-semibold tracking-tight sm:text-3xl">Text Models</h2>
            <span className="ml-auto text-[10px] uppercase tracking-[0.22em] text-[#64748b]">Per 1M Tokens</span>
          </div>

          <div className="pricing-table-wrapper">
            <div className="pricing-table-glow pricing-table-glow--blue" />
            <div className="pricing-table-inner">
              {pricingLoading ? (
                <TableSkeleton rows={4} />
              ) : textModels.length ? (
                <>
                  {/* Header */}
                  <div className="hidden grid-cols-12 gap-4 border-b border-white/[0.06] px-8 py-5 sm:grid">
                    <div className="col-span-4 text-xs font-bold uppercase tracking-[0.15em] text-[#94a3b8]">Model Name</div>
                    <div className="col-span-3 text-right text-xs font-bold uppercase tracking-[0.15em] text-[#94a3b8]">
                      Input <span className="ml-1 font-normal normal-case tracking-normal text-[#64748b]">/ 1M tokens</span>
                    </div>
                    <div className="col-span-3 text-right text-xs font-bold uppercase tracking-[0.15em] text-[#94a3b8]">
                      Output <span className="ml-1 font-normal normal-case tracking-normal text-[#64748b]">/ 1M tokens</span>
                    </div>
                    <div className="col-span-2 text-right text-xs font-bold uppercase tracking-[0.15em] text-[#94a3b8]">
                      Cached
                    </div>
                  </div>
                  {/* Rows */}
                  {textModels.map((model, idx) => (
                    <div
                      key={model.id}
                      className={`grid gap-3 px-5 py-4 transition-colors duration-200 hover:bg-white/[0.02] sm:grid-cols-12 sm:gap-4 sm:px-8 sm:py-5 ${
                        idx < textModels.length - 1 ? "border-b border-white/[0.06]" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3 sm:col-span-4">
                        <span className="font-headline text-base font-medium text-[#f1f5f9]">{model.name}</span>
                      </div>
                      <div className="flex items-center justify-between text-[#94a3b8] sm:col-span-3 sm:justify-end">
                        <span className="text-xs uppercase text-[#64748b] sm:hidden">Input</span>{formatPrice(model.inputTokenPrice)}
                      </div>
                      <div className="flex items-center justify-between text-[#94a3b8] sm:col-span-3 sm:justify-end">
                        <span className="text-xs uppercase text-[#64748b] sm:hidden">Output</span>{formatPrice(model.outputTokenPrice)}
                      </div>
                      <div className="flex items-center justify-between text-[#64748b] sm:col-span-2 sm:justify-end">
                        <span className="text-xs uppercase sm:hidden">Cached</span>{model.cachedInputTokenPrice ? formatPrice(model.cachedInputTokenPrice) : "—"}
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <div className="px-8 py-12 text-center text-sm text-[#64748b]">
                  No text model pricing is available right now.
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── Image Models ── */}
        <section className="animate-fade-in-up" style={{ animationDelay: "240ms" }}>
          <div className="mb-4 flex items-center gap-3 sm:mb-6 sm:gap-4 sm:pl-4">
            <span className="material-symbols-outlined text-3xl text-[#8b5cf6]" style={{ fontVariationSettings: "'FILL' 1" }}>
              image
            </span>
            <h2 className="font-headline text-2xl font-semibold tracking-tight sm:text-3xl">Image Models</h2>
            <span className="ml-auto text-[10px] uppercase tracking-[0.22em] text-[#64748b]">Per Image</span>
          </div>

          <div className="pricing-table-wrapper">
            <div className="pricing-table-glow pricing-table-glow--purple" />
            <div className="pricing-table-inner overflow-x-auto">
              {pricingLoading ? (
                <TableSkeleton rows={3} />
              ) : imageModels.length ? (
                <div className={imageSizeColumns.length > 3 ? "min-w-[700px]" : ""}>
                  {/* Header */}
                  <div className="flex border-b border-white/[0.06] px-8 py-5">
                    <div className="w-[200px] shrink-0 text-xs font-bold uppercase tracking-[0.15em] text-[#94a3b8]">Model Name</div>
                    {imageSizeColumns.map((col) => (
                      <div key={col} className="flex-1 text-right text-xs font-bold uppercase tracking-[0.15em] text-[#94a3b8]">
                        {col}
                      </div>
                    ))}
                  </div>
                  {/* Rows */}
                  {imageModels.map((model, idx) => (
                    <div
                      key={model.id}
                      className={`flex px-8 py-5 transition-colors duration-200 hover:bg-white/[0.02] ${
                        idx < imageModels.length - 1 ? "border-b border-white/[0.06]" : ""
                      }`}
                    >
                      <div className="w-[200px] shrink-0 flex items-center">
                        <span className="font-headline text-base font-medium text-[#f1f5f9]">{model.name}</span>
                      </div>
                      {imageSizeColumns.map((col) => (
                        <div key={col} className="flex-1 flex items-center justify-end text-[#94a3b8]">
                          {model.sizePrices[col] ? formatPrice(model.sizePrices[col]) : "—"}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-8 py-12 text-center text-sm text-[#64748b]">
                  No image model pricing is available right now.
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Info Footer */}
        <section className="animate-fade-in-up mx-auto max-w-3xl" style={{ animationDelay: "320ms" }}>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-5 py-5 text-center sm:px-8 sm:py-6">
            <p className="text-sm leading-relaxed text-[#64748b]">
              All prices are in <span className="font-semibold text-[#94a3b8]">Credits (Cr)</span>. Text model costs are per 1 million tokens processed. Image model costs are per generated image at the specified resolution. Smart Creation adds the analysis fee before applying model costs. Prices update in real time from the server.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
