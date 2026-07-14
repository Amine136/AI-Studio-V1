"use client";

import { useLanguage } from "../context/LanguageContext";
import { setTheme, useThemeMode } from "../lib/theme";

export default function ThemeToggle({ className }: { className?: string }) {
  const { t } = useLanguage();
  const theme = useThemeMode();
  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      aria-label={next === "light" ? t("Switch to light mode") : t("Switch to dark mode")}
      title={next === "light" ? t("Light Mode") : t("Dark Mode")}
      onClick={() => setTheme(next)}
      className={
        className ??
        "flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-slate-300 transition-colors hover:bg-white/[0.06] hover:text-white light:border-slate-900/10 light:bg-slate-900/[0.03] light:text-slate-600 light:hover:bg-slate-900/[0.06] light:hover:text-slate-900"
      }
    >
      <span className="material-symbols-outlined text-[20px]">
        {theme === "dark" ? "light_mode" : "dark_mode"}
      </span>
    </button>
  );
}
