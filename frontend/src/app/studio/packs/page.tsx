"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { api } from "../../../services/api";
import { useLanguage } from "../../../context/LanguageContext";
import type { PackCapability, PackCard, PackVariant } from "../../../types";
import Specimen from "./Specimen";
import {
  CRAFT_HEX,
  CRAFT_ORDER,
  PINNED_SECTORS,
  SECTOR_ORDER,
  capabilityLabel,
  pt,
  sectorDesc,
  sectorLabel,
} from "./packsShared";

// "Mockup sectors" don't show category cards — they show the mockups (variants) of a
// single freeform "studio" pack directly, each linking straight into the agent studio
// via ?variant=. Mirrors e-commerce's mockup-picker, one level up. sector -> pack id.
const MOCKUP_SECTORS: Record<string, string> = {
  social: "social-profile-studio",
  quote: "quote-studio",
  digital: "digital-products-studio",
};
const MOCKUPS_WORD: Record<string, string> = { en: "mockups", fr: "mockups", ar: "مشاهد" };

// Small "what you bring" glyph: a photo (needs an upload) vs. text lines (describe).
function NeedIcon({ img }: { img: boolean }) {
  return img ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.6" />
      <path d="M4 18l5-5 4 3 3-3 4 4" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
      <path d="M5 7h14M5 12h14M5 17h9" />
    </svg>
  );
}

export default function PacksGalleryPage() {
  const { language, isRtl } = useLanguage();
  const [packs, setPacks] = useState<PackCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSector, setActiveSector] = useState<string | null>(null);
  const [craft, setCraft] = useState<PackCapability | "all">("all");
  const [query, setQuery] = useState("");
  // Variants of each mockup sector's studio pack (social, quote), keyed by sector —
  // rendered directly as that sector's grid instead of pack cards.
  const [mockupVariants, setMockupVariants] = useState<Record<string, PackVariant[]>>({});
  // True until the mockup studio packs have been fetched — drives the skeleton grid.
  const [mockupLoading, setMockupLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listPacks({ lang: language })
      .then((res) => {
        if (cancelled) return;
        setPacks(res.packs);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? "Failed to load packs");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [language]);

  // Mockup sectors show mockups directly: fetch each studio pack's variants for its grid.
  useEffect(() => {
    let cancelled = false;
    setMockupLoading(true);
    Promise.all(
      Object.entries(MOCKUP_SECTORS).map(([sector, packId]) =>
        api
          .getPack(packId, language)
          .then((d) => [sector, d.variants ?? []] as const)
          .catch(() => [sector, [] as PackVariant[]] as const),
      ),
    )
      .then((entries) => {
        if (!cancelled) setMockupVariants(Object.fromEntries(entries));
      })
      .finally(() => {
        if (!cancelled) setMockupLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [language]);

  // Sectors present in the data, split into ordered + pinned "home market".
  const { ordered, pinned } = useMemo(() => {
    const present = new Set(packs.map((p) => p.sector));
    const inOrder = SECTOR_ORDER.filter((s) => present.has(s));
    const extra = [...present].filter((s) => !SECTOR_ORDER.includes(s));
    const all = [...inOrder, ...extra];
    return {
      ordered: all.filter((s) => !PINNED_SECTORS.has(s)),
      pinned: all.filter((s) => PINNED_SECTORS.has(s)),
    };
  }, [packs]);

  const allSectors = useMemo(() => [...ordered, ...pinned], [ordered, pinned]);

  useEffect(() => {
    if (allSectors.length && (activeSector === null || !allSectors.includes(activeSector))) {
      setActiveSector(allSectors[0]);
    }
  }, [allSectors, activeSector]);

  const countFor = (sector: string) =>
    MOCKUP_SECTORS[sector] ? (mockupVariants[sector]?.length ?? 0) : packs.filter((p) => p.sector === sector).length;

  const activeMockupPack = activeSector ? MOCKUP_SECTORS[activeSector] : undefined;
  const isMockup = !!activeMockupPack;

  // A mockup sector's grid = its studio pack's mockups, filtered by the search box (by title).
  const mockupTiles = useMemo(() => {
    const vs = activeSector ? mockupVariants[activeSector] ?? [] : [];
    const q = query.trim().toLowerCase();
    return q ? vs.filter((v) => v.title.toLowerCase().includes(q)) : vs;
  }, [mockupVariants, activeSector, query]);

  // Packs in the active sector (before the craft filter) — drives the filter counts.
  const sectorPacks = useMemo(
    () => packs.filter((p) => !activeSector || p.sector === activeSector),
    [packs, activeSector],
  );

  // Crafts present in the active sector, in canonical order.
  const craftsPresent = useMemo(
    () => CRAFT_ORDER.filter((c) => sectorPacks.some((p) => p.capability === c)),
    [sectorPacks],
  );

  useEffect(() => {
    // Reset craft filter when it no longer applies to the active sector.
    if (craft !== "all" && !craftsPresent.includes(craft)) setCraft("all");
  }, [craftsPresent, craft]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      // Search spans all sectors.
      return packs.filter((p) => `${p.title} ${p.promise} ${p.tags.join(" ")}`.toLowerCase().includes(q));
    }
    return sectorPacks.filter((p) => craft === "all" || p.capability === craft);
  }, [packs, sectorPacks, craft, query]);

  const displayClass = isRtl ? "" : "font-['Bricolage_Grotesque']";

  const UNLOCKED_SECTORS = ["ecommerce", "social", "quote", "digital"];

  const sectorButton = (s: string, marker: ReactNode) => {
    const active = s === activeSector;
    const locked = !UNLOCKED_SECTORS.includes(s);

    if (locked) {
      return (
        <div
          key={s}
          className="flex w-full cursor-not-allowed items-center gap-3 rounded-[10px] px-2.5 py-2.5 opacity-40"
        >
          {marker}
          <span className={`flex-1 truncate text-sm font-medium text-[#93a0bd] ${displayClass}`}>{sectorLabel(language, s)}</span>
          <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-widest text-white/50">Soon</span>
        </div>
      );
    }

    return (
      <button
        key={s}
        type="button"
        onClick={() => {
          setActiveSector(s);
          setCraft("all");
          setQuery("");
        }}
        className={`flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2.5 text-start transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40 ${
          active ? "bg-white/[.06] text-[#eaedf6]" : "text-[#93a0bd] hover:bg-white/[.04] hover:text-[#eaedf6]"
        }`}
      >
        {marker}
        <span className={`flex-1 truncate text-sm font-medium ${displayClass}`}>{sectorLabel(language, s)}</span>
        <span className="font-mono text-[11px] text-[#606d8a]">{countFor(s)}</span>
      </button>
    );
  };

  return (
    <div className="flex min-h-[calc(100vh-3.75rem)]">
      {/* Catalog / index rail */}
      <aside className="hidden w-56 shrink-0 border-e border-white/[.08] p-4 sm:block">
        <p className="mb-3.5 px-2.5 font-mono text-[10.5px] uppercase tracking-[0.22em] text-[#606d8a]">
          {pt(language, "catalog")}
        </p>
        <nav className="flex flex-col gap-0.5">
          {ordered.map((s, i) => (
            <span key={s}>
              {sectorButton(s, <span className="w-[18px] shrink-0 font-mono text-[11px] text-[#606d8a]">{String(i + 1).padStart(2, "0")}</span>)}
            </span>
          ))}
        </nav>
        {pinned.length > 0 && (
          <>
            <div className="mx-1.5 my-2.5 h-px bg-white/[.08]" />
            <p className="mb-2 px-2.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-[#606d8a]">
              {pt(language, "homeMarket")}
            </p>
            <nav className="flex flex-col gap-0.5">
              {pinned.map((s) => sectorButton(s, <span className="w-[18px] shrink-0 text-center text-[#e7ad4d]">★</span>))}
            </nav>
          </>
        )}
      </aside>

      {/* Content */}
      <section className="min-w-0 flex-1 px-5 py-7 sm:px-8 lg:px-9">
        {/* Masthead */}
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <h1 className={`text-[clamp(1.9rem,3.5vw,2.5rem)] font-extrabold leading-[1.02] tracking-tight text-[#eaedf6] ${displayClass}`}>
              {activeSector ? sectorLabel(language, activeSector) : pt(language, "packs")}
            </h1>
            {activeSector && !query && (
              <p className="mt-3 max-w-[46ch] text-[15px] leading-relaxed text-[#93a0bd]">
                {sectorDesc(language, activeSector)}
              </p>
            )}
            <p className="mt-3.5 font-mono text-xs tracking-wide text-[#606d8a]">
              {isMockup ? mockupTiles.length : query ? visible.length : sectorPacks.length}{" "}
              {isMockup ? MOCKUPS_WORD[language] ?? MOCKUPS_WORD.en : pt(language, "packsCount")}
            </p>
          </div>
          <div className="relative mt-1.5">
            <span className="material-symbols-outlined pointer-events-none absolute top-1/2 -translate-y-1/2 text-[18px] text-[#606d8a] start-3.5">
              search
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={pt(language, "search")}
              className="w-full rounded-full border border-white/[.13] bg-[#111826] py-2.5 ps-10 pe-4 text-sm text-[#eaedf6] placeholder:text-[#606d8a] focus:border-[#93a0bd] focus:outline-none sm:w-64"
            />
          </div>
        </div>

        {/* Craft filter strip */}
        {!query && !isMockup && craftsPresent.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2 border-t border-white/[.08] pt-5">
            <CraftChip
              active={craft === "all"}
              onClick={() => setCraft("all")}
              label={pt(language, "allCrafts")}
              count={sectorPacks.length}
              dot={
                <span
                  className="h-2.5 w-2.5 rounded-[3px]"
                  style={{
                    background: `conic-gradient(${CRAFT_ORDER.map((c) => CRAFT_HEX[c]).join(",")},${CRAFT_HEX[CRAFT_ORDER[0]]})`,
                  }}
                />
              }
            />
            {craftsPresent.map((c) => (
              <CraftChip
                key={c}
                active={craft === c}
                onClick={() => setCraft(c)}
                label={capabilityLabel(language, c)}
                count={sectorPacks.filter((p) => p.capability === c).length}
                dot={<span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: CRAFT_HEX[c] }} />}
              />
            ))}
          </div>
        )}

        {/* States */}
        {loading && !isMockup && <p className="mt-8 text-sm text-[#93a0bd]">{pt(language, "loading")}</p>}
        {error && !loading && <p className="mt-8 text-sm text-rose-300">{error}</p>}
        {/* Mockup sectors show skeleton tiles while their variants are still loading. */}
        {!error && isMockup && (loading || mockupLoading) && <MockupSkeletonGrid />}
        {!loading && !error && !(isMockup && mockupLoading) &&
          (isMockup ? mockupTiles.length === 0 : visible.length === 0) && (
            <p className="mt-8 text-sm text-[#93a0bd]">{pt(language, "emptySector")}</p>
          )}

        {/* Mockup-sector grid: mockups directly (each opens the studio via ?variant=).
            Masonry — natural aspect ratios, tight gutters, caption on hover. Each tile
            shows a skeleton until its image has loaded. */}
        {isMockup ? (
          mockupLoading ? null : (
            <div className="mt-5 gap-1.5 [column-fill:_balance] columns-2 sm:columns-3 xl:columns-4">
              {mockupTiles.map((v) => (
                <MockupTile
                  key={v.id}
                  href={`/studio/packs/${activeMockupPack}?variant=${v.id}`}
                  title={v.title}
                  src={v.thumbnail_url}
                  displayClass={displayClass}
                />
              ))}
            </div>
          )
        ) : (
        <div className="mt-5 gap-1.5 [column-fill:_balance] columns-2 sm:columns-3 xl:columns-4">
          {visible.map((p) => {
            const color = CRAFT_HEX[p.capability] ?? "#8fa0c4";
            const isNew = p.tags.includes("new");
            return (
              <Link
                key={p.id}
                href={`/studio/packs/${p.id}`}
                className="group relative mb-1.5 block w-full break-inside-avoid overflow-hidden rounded-md border animate-fade-in-up border-white/[.08] bg-[#141b2b] transition duration-200 hover:border-white/[.13] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                {p.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbnail_url} alt={p.title} className="block h-auto w-full transition duration-300 group-hover:scale-[1.03]" />
                ) : (
                  <div className="relative aspect-[4/3] w-full">
                    <Specimen capability={p.capability} id={p.id} isRtl={isRtl} />
                  </div>
                )}
                {isNew && (
                  <span className="absolute top-3 z-[2] rounded-md border border-white/[.13] bg-[#0d1320]/70 px-2 py-[3px] font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#eaedf6] backdrop-blur-sm start-3">
                    {pt(language, "new")}
                  </span>
                )}
                {/* caption overlay — hidden until hover/focus (always shown on touch) */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent p-3.5 pt-10 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100">
                  <h3 className={`text-[15px] font-bold leading-tight tracking-tight text-white drop-shadow-sm ${displayClass}`}>
                    {p.title}
                  </h3>
                  <div className="mt-2 flex items-center justify-between gap-2.5">
                    <span
                      className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em]"
                      style={{ color }}
                    >
                      <span className="h-[7px] w-[7px] rounded-sm" style={{ background: color }} />
                      {capabilityLabel(language, p.capability)}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-white/70">
                      <NeedIcon img={p.requires_image_input} />
                      {p.requires_image_input ? pt(language, "needsPhoto") : pt(language, "justDescribe")}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
        )}
      </section>
    </div>
  );
}

// A single mockup tile. Reserves space with a pulsing skeleton (portrait 4:5) until
// its image has loaded, then fades the natural-ratio image in over it. With lazy
// loading, off-screen tiles keep their skeleton until scrolled into view.
function MockupTile({
  href,
  title,
  src,
  displayClass,
}: {
  href: string;
  title: string;
  src: string;
  displayClass: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  // Cache hits can finish before React attaches onLoad (e.g. browser Back, sector
  // remounts) — without this the skeleton would stay stuck over an already-loaded image.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, []);
  return (
    <Link
      href={href}
      className="group relative mb-1.5 block w-full break-inside-avoid overflow-hidden rounded-md border animate-fade-in-up border-white/[.08] bg-[#141b2b] transition duration-200 hover:border-white/[.13] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
    >
      {!loaded && (
        <div
          className="w-full animate-pulse bg-gradient-to-br from-white/[.07] to-white/[.02]"
          style={{ aspectRatio: "4 / 5" }}
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={title}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        className={`w-full transition duration-300 group-hover:scale-[1.03] ${
          loaded ? "block h-auto opacity-100" : "absolute inset-0 h-full object-cover opacity-0"
        }`}
      />
      {/* caption overlay — hidden until hover/focus (always shown on touch) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-3 pt-9 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100">
        <span className={`text-[13px] font-semibold text-white drop-shadow-sm ${displayClass}`}>{title}</span>
      </div>
    </Link>
  );
}

// Placeholder grid shown while a mockup sector's variants are still being fetched.
// Varied heights mimic the masonry layout of real mockups.
function MockupSkeletonGrid() {
  const heights = [232, 300, 260, 340, 244, 288, 320, 252, 300, 228, 292, 272];
  return (
    <div className="mt-5 gap-1.5 [column-fill:_balance] columns-2 sm:columns-3 xl:columns-4">
      {heights.map((h, i) => (
        <div
          key={i}
          className="mb-1.5 w-full break-inside-avoid overflow-hidden rounded-md border border-white/[.08] bg-[#141b2b]"
        >
          <div
            className="w-full animate-pulse bg-gradient-to-br from-white/[.07] to-white/[.02]"
            style={{ height: h }}
          />
        </div>
      ))}
    </div>
  );
}

function CraftChip({
  active,
  onClick,
  label,
  count,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  dot: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-[7px] text-[12.5px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
        active
          ? "border-transparent bg-white/[.08] text-[#eaedf6]"
          : "border-white/[.13] text-[#93a0bd] hover:border-[#93a0bd] hover:text-[#eaedf6]"
      }`}
    >
      {dot}
      {label}
      <span className={`font-mono text-[11px] ${active ? "text-[#93a0bd]" : "text-[#606d8a]"}`}>{count}</span>
    </button>
  );
}
