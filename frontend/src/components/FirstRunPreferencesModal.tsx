"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import { api } from "../services/api";
import { LANGUAGES, type Language } from "../lib/language";
import { readStoredTheme, setTheme, type ThemeMode } from "../lib/theme";

/* First-run preferences card. Shown exactly once, right after a new account's
   first sign-in (gated server-side by needsPreferencesSetup). Lets the user pick
   their language + theme up front — the language is persisted server-side so
   later emails can be sent in it. Both Save and Skip mark the prompt as answered
   so the card never reappears; the user can still change everything in Settings. */

const LANGUAGE_META: Record<Language, { native: string; key: string; hint: string }> = {
  en: { native: "English", key: "English", hint: "EN" },
  fr: { native: "Français", key: "French", hint: "FR" },
  ar: { native: "العربية", key: "Arabic", hint: "AR" },
};

export default function FirstRunPreferencesModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t, language, setLanguage } = useLanguage();
  const [lang, setLang] = useState<Language>(language);
  const [theme, setThemeChoice] = useState<ThemeMode>("dark");
  const [saving, setSaving] = useState(false);
  const [entered, setEntered] = useState(false);

  // Seed from the live values every time the card opens, and lock body scroll.
  useEffect(() => {
    if (!open) return;
    setLang(language);
    setThemeChoice(readStoredTheme());
    setSaving(false);
    const raf = requestAnimationFrame(() => setEntered(true));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void finish(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      setEntered(false);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, language]);

  if (!open) return null;

  // Save = persist language + apply theme; Skip = keep defaults. Either way the
  // one-time prompt is marked answered so the card is never shown again. The
  // network call is best-effort: closing must never depend on it succeeding.
  async function finish(save: boolean) {
    if (saving) return;
    setSaving(true);
    if (save) {
      setLanguage(lang); // cookie + localStorage + <html lang/dir>, used by SSR/UI
      setTheme(theme); // localStorage + live re-theme
    }
    try {
      await api.updateNotificationPreferences({
        preferencesPrompted: true,
        ...(save ? { preferredLanguage: lang } : {}),
      });
    } catch {
      /* best-effort: the prompt-answered flag will also be set on the next save */
    }
    onClose();
  }

  const rtl = lang === "ar";

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t("Welcome to Vibecraft")}
    >
      {/* Scrim */}
      <button
        type="button"
        aria-label={t("Skip for now")}
        onClick={() => void finish(false)}
        className={`absolute inset-0 cursor-default bg-black/60 backdrop-blur-[3px] transition-opacity duration-300 motion-reduce:transition-none ${
          entered ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Card */}
      <div
        dir={rtl ? "rtl" : "ltr"}
        className={`relative w-full max-w-md overflow-hidden rounded-3xl border transition-all duration-300 ease-out motion-reduce:transition-none motion-reduce:transform-none ${
          entered ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-[0.97] opacity-0"
        } ${rtl ? "font-sans-arabic" : ""}`}
        style={{
          background: "var(--bg-elevated)",
          borderColor: "var(--border-default)",
          boxShadow: "var(--shadow-lg)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
        }}
      >
        {/* Accent header wash */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-32"
          style={{ background: "var(--gradient-surface)" }}
        />

        <div className="relative px-6 pt-7 pb-6 sm:px-8">
          <header className="mb-6 text-center">
            <div
              className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border"
              style={{
                borderColor: "var(--border-default)",
                background: "var(--accent-blue-soft)",
                color: "var(--accent-blue)",
              }}
            >
              <span className="material-symbols-outlined text-[30px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                settings_suggest
              </span>
            </div>
            <h2 className="font-headline text-xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
              {t("Welcome to Vibecraft")}
            </h2>
            <p className="mx-auto mt-2 max-w-[19rem] text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {t("Set your language and theme to get started. You can change these anytime in Settings.")}
            </p>
          </header>

          {/* Language */}
          <section className="mb-5">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]" style={{ color: "var(--text-muted)" }}>
                translate
              </span>
              <p className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
                {t("Language")}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {LANGUAGES.map((code) => {
                const meta = LANGUAGE_META[code];
                const active = lang === code;
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setLang(code)}
                    aria-pressed={active}
                    dir={code === "ar" ? "rtl" : "ltr"}
                    className="group relative flex min-h-[64px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-2xl border px-2 py-3 transition-all duration-200 motion-reduce:transition-none"
                    style={{
                      borderColor: active ? "var(--accent-blue)" : "var(--border-default)",
                      background: active ? "var(--accent-blue-soft)" : "var(--bg-surface)",
                    }}
                  >
                    <span
                      className="text-sm font-bold"
                      style={{ color: active ? "var(--accent-blue)" : "var(--text-primary)" }}
                    >
                      {meta.native}
                    </span>
                    <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
                      {t(meta.key)}
                    </span>
                    {active && (
                      <span
                        className="absolute end-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full"
                        style={{ background: "var(--accent-blue)", color: "var(--color-on-primary, #fff)" }}
                      >
                        <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                          check
                        </span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Theme */}
          <section className="mb-7">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]" style={{ color: "var(--text-muted)" }}>
                palette
              </span>
              <p className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
                {t("Theme")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {([
                { id: "dark" as ThemeMode, label: "Dark Mode", icon: "dark_mode", swatch: "#0b1220", bars: ["#334155", "#1e293b"], dot: "#3b82f6" },
                { id: "light" as ThemeMode, label: "Light Mode", icon: "light_mode", swatch: "#f4f6fb", bars: ["#cbd5e1", "#e2e8f0"], dot: "#2563eb" },
              ]).map((opt) => {
                const active = theme === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setThemeChoice(opt.id)}
                    aria-pressed={active}
                    className="group relative cursor-pointer overflow-hidden rounded-2xl border p-3 text-start transition-all duration-200 motion-reduce:transition-none rtl:text-right"
                    style={{
                      borderColor: active ? "var(--accent-blue)" : "var(--border-default)",
                      background: active ? "var(--accent-blue-soft)" : "var(--bg-surface)",
                    }}
                  >
                    {/* Mini preview swatch — fixed colors so each card always shows its theme */}
                    <div
                      className="mb-2.5 flex h-12 items-center gap-1.5 rounded-lg px-2"
                      style={{ background: opt.swatch, boxShadow: "inset 0 0 0 1px rgba(127,127,127,0.15)" }}
                    >
                      <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: opt.dot }} />
                      <span className="flex flex-1 flex-col gap-1">
                        <span className="h-1.5 w-3/4 rounded-full" style={{ background: opt.bars[0] }} />
                        <span className="h-1.5 w-1/2 rounded-full" style={{ background: opt.bars[1] }} />
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="material-symbols-outlined text-[18px]"
                        style={{ color: active ? "var(--accent-blue)" : "var(--text-secondary)" }}
                      >
                        {opt.icon}
                      </span>
                      <span
                        className="text-sm font-bold"
                        style={{ color: active ? "var(--accent-blue)" : "var(--text-primary)" }}
                      >
                        {t(opt.label)}
                      </span>
                    </div>
                    {active && (
                      <span
                        className="absolute end-2 top-2 flex h-5 w-5 items-center justify-center rounded-full"
                        style={{ background: "var(--accent-blue)", color: "var(--color-on-primary, #fff)" }}
                      >
                        <span className="material-symbols-outlined text-[13px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                          check
                        </span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void finish(false)}
              disabled={saving}
              className="cursor-pointer rounded-xl px-4 py-3 text-sm font-bold transition-colors duration-200 disabled:opacity-50 motion-reduce:transition-none"
              style={{ color: "var(--text-muted)" }}
            >
              {t("Skip for now")}
            </button>
            <button
              type="button"
              onClick={() => void finish(true)}
              disabled={saving}
              className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white shadow-sm transition-transform duration-200 hover:brightness-110 active:scale-[0.98] disabled:opacity-60 motion-reduce:transition-none motion-reduce:active:scale-100"
              style={{ background: "var(--gradient-primary)" }}
            >
              {saving ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <span className="material-symbols-outlined text-[18px]">check_circle</span>
              )}
              {t("Save preferences")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
