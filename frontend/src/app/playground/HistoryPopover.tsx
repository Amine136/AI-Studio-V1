"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PlainChatConversationItem } from "../../types";

const POPOVER_WIDTH = 320;
const POPOVER_MAX_HEIGHT = 440;

/**
 * Recent-conversation history, opened from the chat topbar. Follows the same
 * portal + viewport-clamp pattern as ModelPickerPopover, but opens *downward*
 * (the trigger lives at the top of the screen).
 *
 * Data lives in the page: this component only renders what it is handed and
 * calls back. `onOpenChange(true)` is the page's cue to fetch the first page;
 * "Load more" bumps the page's limit by 10 up to the backend's cap of 100.
 */
export default function HistoryPopover({
  activeId,
  items,
  loading,
  error,
  canLoadMore,
  onOpenChange,
  onSelect,
  onLoadMore,
  language,
  isRtl = false,
  t,
}: {
  activeId: string;
  items: PlainChatConversationItem[];
  loading: boolean;
  error: string | null;
  canLoadMore: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
  language: string;
  isRtl?: boolean;
  t: (key: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const setOpenState = (next: boolean) => {
    setOpen(next);
    onOpenChange(next);
  };

  useEffect(() => {
    if (!open) return;

    const place = () => {
      const b = btnRef.current?.getBoundingClientRect();
      if (!b) return;
      const margin = 8;
      // Clamp to the viewport so the card keeps a margin on a 360px phone.
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - 2 * margin);
      const left = Math.min(
        Math.max(margin, isRtl ? b.right - width : b.left),
        window.innerWidth - width - margin,
      );
      const top = b.bottom + 6;
      const maxHeight = Math.min(POPOVER_MAX_HEIGHT, window.innerHeight - top - margin);
      setPos({ top, left, maxHeight, width });
    };
    place();

    const onDocMouseDown = (event: MouseEvent) => {
      if (!popRef.current?.contains(event.target as Node) && !btnRef.current?.contains(event.target as Node)) {
        setOpenState(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenState(false);
    };

    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);

    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isRtl]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpenState(!open)}
        title={t("History")}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`chat-topbar-btn ${open ? "!text-[#adc6ff]" : ""}`}
      >
        <span className="material-symbols-outlined text-[18px]">history</span>
      </button>

      {open && pos && typeof document !== "undefined"
        ? createPortal(
          <div
            ref={popRef}
            dir={isRtl ? "rtl" : "ltr"}
            role="menu"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
            className="z-[9999] flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0f1626] shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-3 py-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">{t("History")}</span>
              {loading ? (
                <span className="material-symbols-outlined animate-spin text-[15px] text-white/30">progress_activity</span>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {error ? (
                <p className="px-2 py-6 text-center text-[12px] text-red-400/70">{error}</p>
              ) : items.length === 0 && !loading ? (
                <p className="px-2 py-8 text-center text-[12px] text-white/35">{t("No conversations yet.")}</p>
              ) : (
                items.map((item) => {
                  const active = item.id === activeId;
                  const title = item.title?.trim() || t("New Chat");
                  const when = item.lastMessageAt || item.updatedAt || item.createdAt;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onSelect(item.id);
                        setOpenState(false);
                      }}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-start transition-colors ${
                        active ? "bg-[#adc6ff]/10" : "hover:bg-white/[0.04]"
                      }`}
                    >
                      <span
                        className={`material-symbols-outlined text-[16px] ${active ? "text-[#adc6ff]" : "text-white/25"}`}
                      >
                        chat_bubble
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-[13px] ${active ? "font-medium text-[#adc6ff]" : "text-white/85"}`}>
                          {title}
                        </span>
                        {when ? (
                          <span className="mt-0.5 block text-[10.5px] text-white/30">{formatRelative(when, language)}</span>
                        ) : null}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {canLoadMore && !error ? (
              <div className="shrink-0 border-t border-white/[0.06] p-1.5">
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[12px] font-medium text-white/55 transition-colors hover:bg-white/[0.04] hover:text-white/85 disabled:cursor-not-allowed disabled:opacity-40 light:text-slate-700 light:hover:text-slate-900"
                >
                  <span className="material-symbols-outlined text-[15px]">expand_more</span>
                  {t("Load more")}
                </button>
              </div>
            ) : null}
          </div>,
          document.body,
        )
        : null}
    </>
  );
}

const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

/** Localised "5 minutes ago" via Intl, so all three languages render natively. */
function formatRelative(timestamp: number, language: string): string {
  // Backend timestamps are epoch SECONDS; JS Date works in ms. Anything below
  // ~1e12 (year 2001 in ms) is really seconds, so scale it up — otherwise a
  // 2026 timestamp reads as ~1970 ("57 years ago").
  const timestampMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  try {
    const rtf = new Intl.RelativeTimeFormat(language || "en", { numeric: "auto" });
    let duration = (timestampMs - Date.now()) / 1000;
    for (const division of DIVISIONS) {
      if (Math.abs(duration) < division.amount) {
        return rtf.format(Math.round(duration), division.unit);
      }
      duration /= division.amount;
    }
  } catch {
    // Intl or a bad timestamp — fall through to a plain date.
  }
  return new Date(timestampMs).toLocaleDateString();
}
