"use client";

// Confirm-modal model selector: collapsed to just the currently-chosen model
// (the agent's recommendation by default) with a toggle to reveal the rest, so
// the modal leads with the suggestion but still lets the user pick any model.
// Selected/recommended state is gold (#e7ad4d) to read as "recommended".
// Shared by the freeform (PackChat) and non-freeform ([id]) confirm modals.
import { useState } from "react";
import type { Language } from "../../../context/LanguageContext";
import type { PackModelOption } from "../../../types";
import { pt } from "./packsShared";

export default function ModelPicker({
  models,
  value,
  recommended,
  onSelect,
  language,
}: {
  models: PackModelOption[];
  value: string;
  recommended: string | null;
  onSelect: (id: string) => void;
  language: Language;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? models : models.filter((m) => m.id === value);

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-[#606d8a]">
          {pt(language, "model")}
        </label>
        {!showAll && value === recommended && (
          <span className="rounded-full border border-[#e7ad4d]/40 bg-[#e7ad4d]/10 px-2 py-[1px] text-[9.5px] font-semibold uppercase tracking-wide text-[#e7ad4d]">
            {pt(language, "recommended")}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {shown.map((m) => {
          const selected = m.id === value;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelect(m.id)}
              className={`cursor-pointer rounded-xl border px-3 py-1.5 text-sm transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e7ad4d]/60 motion-reduce:transition-none ${
                selected
                  ? "border-[#e7ad4d] bg-[#e7ad4d]/15 font-semibold text-[#e7ad4d]"
                  : "border-white/10 bg-[#111826] text-[#aebbe0] hover:border-white/20"
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {models.length > 1 && (
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          className="mt-1.5 inline-flex cursor-pointer items-center gap-0.5 text-xs font-medium text-[#93a0bd] transition hover:text-white focus-visible:outline-none focus-visible:text-white"
        >
          <span className="material-symbols-outlined text-[16px]">{showAll ? "expand_less" : "expand_more"}</span>
          {showAll ? pt(language, "fewerModels") : pt(language, "otherModels")}
        </button>
      )}
    </div>
  );
}
