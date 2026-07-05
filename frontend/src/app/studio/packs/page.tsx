"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { api } from "../../../services/api";
import { useLanguage } from "../../../context/LanguageContext";
import type { PackCapability, PackCard } from "../../../types";
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

  const countFor = (sector: string) => packs.filter((p) => p.sector === sector).length;

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

  const UNLOCKED_SECTOR = "ecommerce";

  const sectorButton = (s: string, marker: ReactNode) => {
    const active = s === activeSector;
    const locked = s !== UNLOCKED_SECTOR;

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
              {(query ? visible.length : sectorPacks.length)} {pt(language, "packsCount")}
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
        {!query && craftsPresent.length > 0 && (
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
        {loading && <p className="mt-8 text-sm text-[#93a0bd]">{pt(language, "loading")}</p>}
        {error && !loading && <p className="mt-8 text-sm text-rose-300">{error}</p>}
        {!loading && !error && visible.length === 0 && (
          <p className="mt-8 text-sm text-[#93a0bd]">{pt(language, "emptySector")}</p>
        )}

        {/* Grid */}
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((p) => {
            const color = CRAFT_HEX[p.capability] ?? "#8fa0c4";
            const isNew = p.tags.includes("new");
            return (
              <Link
                key={p.id}
                href={`/studio/packs/${p.id}`}
                className="group flex flex-col overflow-hidden rounded-2xl border border-white/[.08] bg-[#141b2b] transition duration-200 [transition-timing-function:cubic-bezier(.2,.7,.3,1)] hover:-translate-y-[3px] hover:border-white/[.13] hover:bg-[#1a2233] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <div className="relative aspect-[4/3] overflow-hidden border-b border-white/[.08]">
                  {p.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumbnail_url} alt={p.title} className="h-full w-full object-cover" />
                  ) : (
                    <Specimen capability={p.capability} id={p.id} isRtl={isRtl} />
                  )}
                  {isNew && (
                    <span className="absolute top-3 z-[2] rounded-md border border-white/[.13] bg-[#0d1320]/70 px-2 py-[3px] font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#eaedf6] backdrop-blur-sm start-3">
                      {pt(language, "new")}
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <h3 className={`text-[16.5px] font-bold leading-tight tracking-tight text-[#eaedf6] ${displayClass}`}>
                    {p.title}
                  </h3>
                  <p className="mt-1.5 line-clamp-2 flex-1 text-[13px] leading-snug text-[#93a0bd]">{p.promise}</p>
                  <div className="mt-3.5 flex items-center justify-between gap-2.5">
                    <span
                      className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em]"
                      style={{ color }}
                    >
                      <span className="h-[7px] w-[7px] rounded-sm" style={{ background: color }} />
                      {capabilityLabel(language, p.capability)}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-[#606d8a]">
                      <NeedIcon img={p.requires_image_input} />
                      {p.requires_image_input ? pt(language, "needsPhoto") : pt(language, "justDescribe")}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
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
