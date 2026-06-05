"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const PRESET_COLORS = [
  "#000000", "#ffffff", "#64748b", "#94a3b8", "#1e293b", "#334155",
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e",
  "#10b981", "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
  "#a855f7", "#d946ef", "#ec4899", "#f43f5e", "#78350f", "#0f766e",
];

/**
 * A self-positioning color picker popover. The native <input type="color">
 * popup is browser-positioned and overflows when the trigger sits in the
 * far-right controls panel, so this renders its own portal popover that opens
 * leftward and is clamped to the viewport. Pick a preset or type a hex value.
 */
export function ColorPickerPopover({
  value,
  onChange,
  onClear,
}: {
  value: string;
  onChange: (hex: string) => void;
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const hex = HEX_RE.test(value) ? value : "";
  const [draft, setDraft] = useState(hex || "#10b981");

  useEffect(() => {
    setDraft(hex || "#10b981");
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;

    const place = () => {
      const b = btnRef.current?.getBoundingClientRect();
      if (!b) return;
      const width = 232;
      const height = 232;
      const margin = 8;
      const left = Math.min(Math.max(margin, b.right - width), window.innerWidth - width - margin);
      let top = b.bottom + 6;
      if (top + height > window.innerHeight - margin) {
        top = Math.max(margin, b.top - height - 6);
      }
      setPos({ top, left });
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
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const commitDraft = (raw: string) => {
    const next = raw.startsWith("#") ? raw : `#${raw}`;
    setDraft(next);
    if (HEX_RE.test(next)) onChange(next);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Pick color"
        className="h-7 w-9 rounded border border-white/15"
        style={{
          backgroundColor: hex || "transparent",
          backgroundImage: hex ? undefined : "repeating-conic-gradient(#444 0% 25%, #666 0% 50%) 50% / 8px 8px",
        }}
      />
      {open && pos && typeof document !== "undefined"
        ? createPortal(
          <div
            ref={popRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: 232 }}
            className="z-[9999] rounded-lg border border-white/10 bg-[#161d2e] p-3 shadow-[0_16px_40px_rgba(0,0,0,0.5)]"
          >
            <div className="grid grid-cols-6 gap-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={color}
                  onClick={() => {
                    onChange(color);
                    setOpen(false);
                  }}
                  className={`h-6 w-6 rounded border ${hex.toLowerCase() === color ? "border-white" : "border-white/10"}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span
                className="h-7 w-7 shrink-0 rounded border border-white/10"
                style={{ backgroundColor: HEX_RE.test(draft) ? draft : "transparent" }}
              />
              <input
                value={draft}
                spellCheck={false}
                onChange={(event) => commitDraft(event.target.value)}
                placeholder="#10b981"
                className="w-full rounded border border-white/10 bg-[#101728] px-2 py-1 font-mono text-xs text-white outline-none focus:border-[#adc6ff]/40"
              />
            </div>
            {onClear ? (
              <button
                type="button"
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
                className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-[#8c909f] hover:text-[#dce1fb]"
              >
                Clear
              </button>
            ) : null}
          </div>,
          document.body,
        )
        : null}
    </>
  );
}
