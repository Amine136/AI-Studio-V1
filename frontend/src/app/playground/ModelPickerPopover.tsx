"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface PickerModel {
  id: string;
  displayName: string;
  tags: string[];
  minimumCost: number;
  recommended: boolean;
  affordable: boolean;
}

export interface PickerGroup {
  provider: string;
  label: string;
  icon: string;
  models: PickerModel[];
}

const POPOVER_WIDTH = 340;
const POPOVER_MAX_HEIGHT = 420;

/**
 * The model selector that replaced the full-screen catalogue gate. It opens from
 * the composer, next to the image-attach button, so picking a model never costs
 * a page transition.
 *
 * Models are grouped strictly by provider (one list per provider); the curated
 * picks carry an inline "Recommended" badge rather than living in their own
 * section. Descriptions are intentionally omitted to keep rows compact.
 *
 * Positioning follows ColorPickerPopover: a portal to <body> so the composer's
 * overflow/transform ancestors can't clip it, opening upward (the trigger sits
 * at the bottom of the viewport) and clamped to the viewport on both axes.
 */
export default function ModelPickerPopover({
  groups,
  value,
  onSelect,
  disabled = false,
  isRtl = false,
  t,
}: {
  groups: PickerGroup[];
  value: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  isRtl?: boolean;
  t: (key: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => groups.flatMap((group) => group.models).find((model) => model.id === value) || null,
    [groups, value],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((group) => ({
        ...group,
        models: group.models.filter((model) =>
          `${model.displayName} ${model.tags.join(" ")}`.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.models.length > 0);
  }, [groups, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    const place = () => {
      const b = btnRef.current?.getBoundingClientRect();
      if (!b) return;
      const margin = 8;
      // Never wider than the viewport: 340px on a 360px phone would otherwise sit
      // edge to edge with no breathing room.
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - 2 * margin);
      const left = Math.min(
        Math.max(margin, isRtl ? b.right - width : b.left),
        window.innerWidth - width - margin,
      );
      // Prefer opening upward — the composer lives at the bottom of the screen.
      const height = Math.min(POPOVER_MAX_HEIGHT, window.innerHeight - 2 * margin);
      let top = b.top - height - 6;
      if (top < margin) top = Math.min(b.bottom + 6, window.innerHeight - height - margin);
      setPos({ top, left, width });
    };
    place();

    const onDocMouseDown = (event: MouseEvent) => {
      if (!popRef.current?.contains(event.target as Node) && !btnRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);

    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.clearTimeout(focusTimer);
    };
  }, [open, isRtl]);

  return (
    <>
      {/* No leading `tune` glyph on the trigger: the Model Settings button beside it
          is also a `tune`, and two identical icons either side of a truncated name
          read as one control. The chevron alone says "this opens a list", and dropping
          the icon buys back the ~20px that was truncating "Nano Banana 2". */}
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        title={t("Change model")}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex min-h-[44px] min-w-0 max-w-[190px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0 sm:max-w-[220px] ${
          open
            ? "border-[#adc6ff]/40 bg-white/[0.05] text-[#adc6ff]"
            : "border-white/[0.07] text-white/45 hover:border-white/15 hover:text-white/75"
        }`}
      >
        <span className="truncate">{selected?.displayName || t("Model")}</span>
        <span className="material-symbols-outlined shrink-0 text-[15px] opacity-60">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {open && pos && typeof document !== "undefined"
        ? createPortal(
          <div
            ref={popRef}
            dir={isRtl ? "rtl" : "ltr"}
            role="listbox"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, maxHeight: POPOVER_MAX_HEIGHT }}
            className="z-[9999] flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0f1626] shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
          >
            <div className="shrink-0 border-b border-white/[0.06] p-2">
              <div className="relative">
                <span className="material-symbols-outlined pointer-events-none absolute top-1/2 -translate-y-1/2 text-[16px] text-white/25 ltr:left-2 rtl:right-2">
                  search
                </span>
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("Search models...")}
                  className="w-full rounded-lg border border-white/[0.06] bg-[#0a0f1e] py-2 text-[12px] text-white/85 outline-none placeholder:text-white/20 focus:border-[#adc6ff]/40 ltr:pl-8 ltr:pr-3 rtl:pl-3 rtl:pr-8"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {filtered.length === 0 ? (
                <p className="px-2 py-6 text-center text-[12px] text-white/35">
                  {t("No models available for the current search.")}
                </p>
              ) : (
                filtered.map((group) => (
                  <div key={group.provider} className="mb-1 last:mb-0">
                    <div className="flex items-center gap-1.5 px-2 pb-1 pt-2">
                      <span className="material-symbols-outlined text-[13px] text-white/25">{group.icon}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/30">
                        {group.label}
                      </span>
                    </div>

                    {group.models.map((model) => {
                      const active = model.id === value;
                      return (
                        <button
                          key={`${group.provider}-${model.id}`}
                          type="button"
                          role="option"
                          aria-selected={active}
                          disabled={!model.affordable}
                          onClick={() => {
                            if (!model.affordable) return;
                            onSelect(model.id);
                            setOpen(false);
                          }}
                          className={`group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start transition-colors ${
                            !model.affordable
                              ? "cursor-not-allowed opacity-40"
                              : active
                                ? "bg-[#adc6ff]/10"
                                : "hover:bg-white/[0.04]"
                          }`}
                        >
                          <span
                            className={`material-symbols-outlined text-[16px] ${active ? "text-[#adc6ff]" : "text-transparent"}`}
                          >
                            check_circle
                          </span>

                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className={`truncate text-[13px] font-medium ${active ? "text-[#adc6ff]" : "text-white/85"}`}>
                                {model.displayName}
                              </span>
                              {model.recommended ? (
                                <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-[#e8c46a]/25 bg-[#e8c46a]/10 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-[0.04em] text-[#e8c46a]">
                                  <span className="material-symbols-outlined text-[10px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                                    star
                                  </span>
                                  {t("Recommended")}
                                </span>
                              ) : null}
                            </span>

                            {!model.affordable ? (
                              <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-wide text-red-400/60">
                                {t("Need")} {model.minimumCost.toFixed(2)} {t("Credits")}
                              </span>
                            ) : model.tags.length > 0 ? (
                              <span className="mt-1 flex flex-wrap gap-1">
                                {model.tags.map((tag) => (
                                  <span
                                    key={tag}
                                    className="rounded-full border border-white/[0.07] px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-[0.06em] text-white/30"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </span>
                            ) : null}
                          </span>

                          <span className="shrink-0 self-start pt-0.5 font-mono text-[10px] tabular-nums text-white/30">
                            {model.minimumCost > 0 ? `${model.minimumCost.toFixed(2)} Cr` : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {/* Pinned so the full rate card stays reachable while the list scrolls. */}
            <div className="shrink-0 border-t border-white/[0.06] p-1.5">
              <Link
                href="/pricing"
                onClick={() => setOpen(false)}
                className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-[11px] font-medium text-white/40 transition-colors hover:bg-white/[0.04] hover:text-white/75"
              >
                <span className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px]">payments</span>
                  {t("Model Pricing")}
                </span>
                <span className="material-symbols-outlined text-[14px] opacity-50 rtl:rotate-180">arrow_forward</span>
              </Link>
            </div>
          </div>,
          document.body,
        )
        : null}
    </>
  );
}
