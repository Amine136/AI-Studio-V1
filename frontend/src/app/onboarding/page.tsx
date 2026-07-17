"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../context/LanguageContext";
import { api } from "../../services/api";

const USERNAME_RE = /[^a-z0-9._-]+/g;

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase().replace(USERNAME_RE, "").slice(0, 15);
}

function safeNext(): string {
  const raw = new URLSearchParams(window.location.search).get("next");
  if (!raw) return "/playground";
  try {
    const url = new URL(raw, window.location.origin);
    const path = `${url.pathname}${url.search}`;
    if (url.origin === window.location.origin && !path.startsWith("/auth") && !path.startsWith("/onboarding")) {
      return path;
    }
  } catch {
    /* malformed next */
  }
  return "/playground";
}

function OnboardingContent() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { t, language, setLanguage } = useLanguage();

  const [ready, setReady] = useState(false);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Gate: must be signed in; if the profile is already complete, leave.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/auth");
      return;
    }
    let cancelled = false;
    void api
      .getProfile()
      .then((profile) => {
        if (cancelled) return;
        if (!profile?.requiresProfileSetup) {
          router.replace(safeNext());
          return;
        }
        // Prefill the auto-generated username so the user can keep or edit it.
        setUsername(normalizeUsername(profile.username || ""));
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, router]);

  const nameValid = fullName.trim().length > 0;
  const usernameValid = normalizeUsername(username).length > 0;

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!nameValid) {
        setError("Your name is required");
        return;
      }
      if (!usernameValid) {
        setError("Username is required");
        return;
      }
      setError("");
      setSaving(true);
      try {
        await api.completeProfile({ fullName: fullName.trim(), username: normalizeUsername(username) });
        router.replace(safeNext());
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "";
        setError(msg || "Something went wrong. Please try again.");
        setSaving(false);
      }
    },
    [fullName, username, nameValid, usernameValid, router],
  );

  if (authLoading || !ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0c1324]">
        <div className="auth-loader" />
      </main>
    );
  }

  return (
    <main
      className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#0c1324] px-6 py-16 text-[#dce1fb]"
      dir={language === "ar" ? "rtl" : "ltr"}
    >
      <div className="absolute top-6 right-6 z-50 flex items-center rounded-full border border-white/10 bg-[#081121]/80 p-1 backdrop-blur-md rtl:right-auto rtl:left-6" dir="ltr">
        {([
          { id: "en", label: "EN" },
          { id: "fr", label: "FR" },
          { id: "ar", label: "AR" },
        ] as const).map((lang) => (
          <button
            key={lang.id}
            onClick={() => setLanguage(lang.id)}
            className={`relative px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
              language === lang.id ? "text-white" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {language === lang.id && (
              <div className="absolute inset-0 rounded-full bg-blue-500/20 shadow-[inset_0_0_10px_rgba(59,130,246,0.3)]" />
            )}
            <span className="relative z-10">{lang.label}</span>
          </button>
        ))}
      </div>

      <div className="relative z-10 w-full max-w-md">
        <header className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <div className="rounded-full border border-[#adc6ff]/15 bg-[#2e3447]/40 p-4">
              <span className="material-symbols-outlined text-3xl text-[#adc6ff]">badge</span>
            </div>
          </div>
          <h1 className="font-headline mb-3 text-2xl font-medium tracking-tight text-slate-100">
            {t("Complete your profile")}
          </h1>
          <p className="mx-auto max-w-[320px] text-sm leading-relaxed text-[#c2c6d6]">
            {t("Tell us your name to finish setting up your Vibecraft account.")}
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-[#adc6ff]/15 bg-[rgba(25,31,49,0.6)] px-5 py-8 sm:p-8 text-left rtl:text-right backdrop-blur-[24px]"
        >
          {error ? (
            <div className="mb-5 rounded-md border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {t(error)}
            </div>
          ) : null}

          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
            {t("Full Name")}
          </label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder={t("Enter your name")}
            maxLength={80}
            autoFocus
            className="mb-5 w-full rounded-md border border-[#adc6ff]/15 bg-[#0c1324]/60 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors focus:border-[#4d8eff]/50"
          />

          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
            {t("Username")}
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(normalizeUsername(e.target.value))}
            placeholder={t("Choose a username")}
            dir="ltr"
            maxLength={15}
            className="w-full rounded-md border border-[#adc6ff]/15 bg-[#0c1324]/60 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors focus:border-[#4d8eff]/50"
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
            {t("Letters, numbers, dots, underscores, and hyphens only.")}
          </p>

          <button
            type="submit"
            disabled={saving || !nameValid || !usernameValid}
            className="font-headline mt-7 flex w-full items-center justify-center gap-3 rounded-md bg-gradient-to-br from-[#adc6ff] to-[#4d8eff] px-6 py-3.5 font-bold text-[#002e6a] transition-all duration-300 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? <span className="auth-spinner" aria-hidden="true" /> : null}
            <span className="tracking-wide">{saving ? t("Saving...") : t("Finish setup")}</span>
          </button>
        </form>
      </div>
    </main>
  );
}

export default function OnboardingPage() {
  return <OnboardingContent />;
}
