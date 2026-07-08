"use client";

// Visual output-shape picker for the confirm modal: each option a model accepts
// (ratio strings like "16:9", pixel sizes like "1024x1024", or the "auto" token)
// is drawn as a little proportioned box so the user picks a shape, not a dropdown
// string. Shared by the freeform (PackChat) and non-freeform ([id]) confirm modals.
import { parseShapeRatio, prettyShape } from "./packsShared";

const FRAME = 34; // px — the square each shape is fitted into (compact for laptops)
const MIN = 10; // px — floor so extreme ratios (21:9, 1x3) stay visible
// Recommended/selected accent for the confirm-modal params is gold (#e7ad4d).

export default function AspectShapePicker({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const ratio = parseShapeRatio(opt);
        const selected = value === opt;

        let w = FRAME;
        let h = FRAME;
        if (ratio && ratio >= 1) h = Math.max(MIN, Math.round(FRAME / ratio));
        else if (ratio && ratio < 1) w = Math.max(MIN, Math.round(FRAME * ratio));

        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            aria-pressed={selected}
            className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border px-2.5 py-1.5 transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e7ad4d]/60 motion-reduce:transition-none ${
              selected
                ? "border-[#e7ad4d] bg-[#e7ad4d]/15"
                : "border-white/10 bg-[#111826] hover:border-white/25"
            }`}
          >
            <span className="flex h-9 w-9 items-center justify-center">
              {ratio === null ? (
                // non-shape token (e.g. "auto") — dashed frame + glyph
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-md border border-dashed ${
                    selected ? "border-[#e7ad4d] text-[#e7ad4d]" : "border-white/30 text-[#8a96b8]"
                  }`}
                >
                  <span className="material-symbols-outlined text-[17px]">crop_free</span>
                </span>
              ) : (
                <span
                  style={{ width: w, height: h }}
                  className={`rounded-[3px] border-2 transition-colors motion-reduce:transition-none ${
                    selected
                      ? "border-[#e7ad4d] bg-[#e7ad4d]/25"
                      : "border-[#5b6a8c] bg-white/[.06] hover:border-[#7f8fb5]"
                  }`}
                />
              )}
            </span>
            <span className={`font-mono text-[11px] leading-none ${selected ? "text-[#e7ad4d]" : "text-[#93a0bd]"}`}>
              {prettyShape(opt)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
