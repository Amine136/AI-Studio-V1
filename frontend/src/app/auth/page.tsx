"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithGoogle, signOutUser } from "../../lib/auth";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";

function mapAuthErrorMessage(error: unknown): string {
  const rawMessage =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: string }).message || "")
      : "";
  const normalized = rawMessage.toLowerCase();

  if (normalized.includes("auth/popup-closed-by-user")) {
    return "Google sign-in was canceled before completion.";
  }
  if (normalized.includes("auth/cancelled-popup-request")) {
    return "A Google sign-in request was canceled. Please try again.";
  }
  if (normalized.includes("auth/popup-blocked")) {
    return "Your browser blocked the Google sign-in popup. Allow popups and try again.";
  }
  if (normalized.includes("auth/network-request-failed")) {
    return "A network error interrupted Google sign-in. Please try again.";
  }
  if (normalized.includes("auth/account-exists-with-different-credential")) {
    return "This email is already linked with a different sign-in method.";
  }
  if (normalized.includes("deactivated")) {
    return "Your account has been deactivated. You no longer have access to this account or its data. Review our Privacy Policy and Terms of Service for more information.";
  }
  return rawMessage || "Google sign-in failed.";
}

function formatSuspensionEndsAt(raw: string, language: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const locale = language === "ar" ? "ar" : language === "fr" ? "fr-FR" : "en-US";
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(d) + " UTC";
}

import { useLanguage } from "../../context/LanguageContext";

function AuthContent() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { t, language, setLanguage } = useLanguage();

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [validatingSession, setValidatingSession] = useState(false);
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const ua = navigator.userAgent || navigator.vendor || (window as any).opera || "";
      if (/FBAN|FBAV|Instagram|Threads/i.test(ua)) {
        setIsInAppBrowser(true);
      }
    }
  }, []);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const reason = searchParams.get("reason");
    if (!reason) return;

    if (reason === "deactivated") {
      setError(
        "Your account has been deactivated. You no longer have access to this account or its data. Review our Privacy Policy and Terms of Service for more information.",
      );
      return;
    }

    if (reason === "suspended") {
      setError("Your account has been suspended. Access to Vibecraft is currently unavailable.");
      return;
    }

    if (reason === "unauthorized") {
      setError("You need an active Vibecraft account to access that page.");
    }
  }, []);

  useEffect(() => {
    if (authLoading || !user) return;

    let cancelled = false;
    setValidatingSession(true);
    setError("");

    void api
      .getProfile()
      .then(() => {
        if (cancelled) return;
        const rawNext = new URLSearchParams(window.location.search).get("next");
        let safeNext = "/dashboard";
        if (rawNext) {
          try {
            const url = new URL(rawNext, window.location.origin);
            const path = `${url.pathname}${url.search}`;
            if (url.origin === window.location.origin && !path.startsWith("/auth")) {
              safeNext = path;
            }
          } catch {
            /* malformed next */
          }
        }
        router.replace(safeNext);
      })
      .catch(async (err: unknown) => {
        if (cancelled) return;
        const message = mapAuthErrorMessage(err);
        if (message.toLowerCase().includes("deactivated")) {
          await signOutUser().catch(() => undefined);
          if (cancelled) return;
          setError(message);
        } else {
          setError(message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setValidatingSession(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, router]);

  if (authLoading || (user && validatingSession)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0c1324]">
        <div className="auth-loader" />
      </main>
    );
  }

  const handleGoogleSignIn = async () => {
    setError("");
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      setError(mapAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const isDynamicSuspension = /your account is suspended/i.test(error);
  let suspensionReason = "";
  let suspensionEndsLabel = "";
  if (isDynamicSuspension) {
    const endsMatch = error.match(/Suspension ends at\s+([^.]+)\./i);
    suspensionEndsLabel = endsMatch ? formatSuspensionEndsAt(endsMatch[1].trim(), language) : "";
    suspensionReason = error
      .replace(/^Your account is suspended:\s*/i, "")
      .replace(/^Your account is suspended\.?\s*/i, "")
      .replace(/\s*Suspension ends at\s+[^.]+\.\s*/i, "")
      .trim();
  }

  return (
    <main className="relative flex min-h-screen w-full flex-col lg:flex-row overflow-hidden bg-[#0c1324] text-[#dce1fb]" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <Link href="/" className="absolute top-6 left-6 z-50 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-[#081121]/80 text-slate-400 backdrop-blur-md transition-all hover:border-blue-500/30 hover:bg-blue-500/10 hover:text-white hover:shadow-[0_0_15px_rgba(59,130,246,0.2)] rtl:left-auto rtl:right-6">
        <span className="material-symbols-outlined text-[18px]">home</span>
      </Link>
      <div className="absolute top-6 right-6 z-50 flex items-center rounded-full border border-white/10 bg-[#081121]/80 p-1 backdrop-blur-md rtl:right-auto rtl:left-6" dir="ltr">
        {(
          [
            { id: "en", label: "EN" },
            { id: "fr", label: "FR" },
            { id: "ar", label: "AR" },
          ] as const
        ).map((lang) => (
          <button
            key={lang.id}
            onClick={() => setLanguage(lang.id)}
            className={`relative px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
              language === lang.id
                ? "text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {language === lang.id && (
              <div className="absolute inset-0 rounded-full bg-blue-500/20 shadow-[inset_0_0_10px_rgba(59,130,246,0.3)]" />
            )}
            <span className="relative z-10">{lang.label}</span>
          </button>
        ))}
      </div>
      <div className="relative hidden lg:flex w-1/2 items-center justify-center border-r border-[#adc6ff]/10 bg-[#0c1324] rtl:lg:order-2">
        <img 
          src="/landing/auth-art.svg" 
          alt="Vibecraft Art" 
          className="absolute inset-0 h-full w-full object-cover" 
        />
        <div className="absolute inset-0 bg-gradient-to-r from-transparent to-[#0c1324]" />
      </div>

      <div className="relative flex w-full lg:w-1/2 flex-col items-center justify-center px-6 pt-24 pb-10 lg:pt-24 lg:pb-10 rtl:lg:order-1">

        <div
          className="pointer-events-none absolute inset-0 z-0"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(circle at 50% 50%, rgba(77, 142, 255, 0.08) 0%, rgba(12, 19, 36, 0) 70%)",
          }}
        />
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-40">
          <svg className="absolute h-full w-full" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
            <defs>
              <linearGradient id="glowAuth" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#4d8eff" stopOpacity="0.8"/>
                <stop offset="50%" stopColor="#d0bcff" stopOpacity="0.4"/>
                <stop offset="100%" stopColor="#0c1324" stopOpacity="0"/>
              </linearGradient>
              <filter id="blurAuth" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="60" />
              </filter>
            </defs>
            <path d="M-100 200 C 300 100, 400 600, 1000 300 S 1400 100, 2000 500" stroke="url(#glowAuth)" strokeWidth="40" fill="none" filter="url(#blurAuth)" />
            <path d="M-100 800 C 400 500, 600 900, 1200 400 S 1600 200, 2200 600" stroke="url(#glowAuth)" strokeWidth="60" fill="none" filter="url(#blurAuth)" opacity="0.6"/>
            <path d="M-100 500 C 200 800, 500 200, 1100 700 S 1500 500, 2000 800" stroke="url(#glowAuth)" strokeWidth="30" fill="none" filter="url(#blurAuth)" opacity="0.4"/>
          </svg>
        </div>

        <div className="relative z-10 w-full max-w-md">
        <header className="mb-12 text-center">
          <div className="mb-2 flex items-center justify-center gap-3">
            <img
              src="/best-version/logo-192.png?v=20260506-1210"
              alt="Vibecraft logo"
              className="h-11 w-11 object-contain"
            />
            <h1 className="font-headline text-3xl font-bold uppercase tracking-[0.16em] text-[#dce1fb] sm:text-4xl sm:tracking-[0.25em]">
              Vibecraft
            </h1>
          </div>

        </header>

        <div className="rounded-xl border border-[#adc6ff]/15 bg-[rgba(25,31,49,0.6)] px-5 py-8 sm:p-10 text-center backdrop-blur-[24px]">
          <div className="mb-8 flex justify-center">
            <div className="rounded-full border border-[#adc6ff]/15 bg-[#2e3447]/40 p-4">
              <span className="material-symbols-outlined text-3xl text-[#adc6ff]">fingerprint</span>
            </div>
          </div>

          <h2 className="font-headline mb-4 text-2xl font-medium tracking-tight text-slate-100">
            {t("The Digital Architect.")}
          </h2>
          <p className="mx-auto mb-10 max-w-[280px] text-sm leading-relaxed text-[#c2c6d6]">
            {t("Engineered for creative excellence. Access your private workspace.")}
          </p>

          {error ? (
            <div className="mb-5 rounded-md border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {isDynamicSuspension ? (
                <p>
                  {t("Your account is suspended:")}
                  {suspensionReason ? " " + t(suspensionReason) : ""}
                  {suspensionEndsLabel ? " " + t("Your suspension ends on") + " " + suspensionEndsLabel + "." : ""}
                </p>
              ) : (
                <p>{t(error)}</p>
              )}
              {error.toLowerCase().includes("deactivated") ? (
                <div className="mt-3 flex flex-wrap gap-4 text-[11px] uppercase tracking-[0.16em]">
                  <Link href="/privacy" className="text-[#ffd6d1] underline underline-offset-4">
                    {t("Privacy Policy")}
                  </Link>
                  <Link href="/policy" className="text-[#ffd6d1] underline underline-offset-4">
                    {t("Terms of Service")}
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}

          {isInAppBrowser ? (
            <div className="mb-6 w-full rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 sm:p-5 text-left rtl:text-right shadow-[0_4px_24px_rgba(245,158,11,0.05)] backdrop-blur-md">
              <div className="flex items-start gap-3 sm:gap-4">
                <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/10 shadow-[inset_0_0_10px_rgba(245,158,11,0.1)]">
                  <span className="material-symbols-outlined text-[20px] sm:text-[24px] text-amber-400">gpp_maybe</span>
                </div>
                <div className="flex flex-col pt-0 sm:pt-0.5">
                  <h3 className="mb-1 sm:mb-1.5 font-headline text-[11px] sm:text-[12px] font-bold tracking-[0.1em] sm:tracking-[0.15em] text-amber-400 uppercase">
                    {t("Action Required")}
                  </h3>
                  <p className="text-[12px] sm:text-[13px] leading-relaxed text-[#c2c6d6]">
                    {t("For security reasons, Google Sign-In does not work inside social media browsers.")}
                  </p>
                </div>
              </div>
              
              <div className="mt-4 sm:mt-5 flex flex-col gap-3 sm:gap-3.5 pl-[3.25rem] sm:pl-[4rem] rtl:pl-0 sm:rtl:pl-0 rtl:pr-[3.25rem] sm:rtl:pr-[4rem]">
                <div className="flex items-start gap-2 sm:gap-3">
                  <span className="mt-0.5 flex h-4 w-4 sm:h-5 sm:w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-[9px] sm:text-[10px] font-bold text-amber-400">
                    1
                  </span>
                  <p className="text-[12px] sm:text-[13px] text-[#c2c6d6]">
                    {t("Tap the")} <span className="mx-1 inline-block rounded-md bg-[#0c1324] border border-white/10 px-1.5 py-0.5 font-mono text-[9px] sm:text-[10px] font-bold tracking-widest text-white shadow-sm">•••</span> {t("icon in your browser header.")}
                  </p>
                </div>
                <div className="flex items-start gap-2 sm:gap-3">
                  <span className="mt-0.5 flex h-4 w-4 sm:h-5 sm:w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-[9px] sm:text-[10px] font-bold text-amber-400">
                    2
                  </span>
                  <p className="text-[12px] sm:text-[13px] text-[#c2c6d6]">
                    {t("Select")} <span className="font-semibold text-amber-200">{t('"Open in browser"')}</span> {t("to continue securely.")}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="font-headline group relative flex w-full items-center justify-center gap-4 rounded-md bg-gradient-to-br from-[#adc6ff] to-[#4d8eff] px-6 py-4 font-bold text-[#002e6a] transition-all duration-300 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? (
                <span className="auth-spinner" aria-hidden="true" />
              ) : (
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
              )}
              <span className="tracking-wide">{loading ? t("Signing in…") : t("Sign in with Google")}</span>
            </button>
          )}

          <div className="mt-8 flex items-center justify-center gap-2 opacity-40">
            <span className="material-symbols-outlined text-xs">verified_user</span>
            <span className="font-label text-[10px] uppercase tracking-widest">{t("End-to-end Encrypted Sessions")}</span>
          </div>
        </div>

        <footer className="mt-12 text-center">
          <p className="font-label text-[10px] uppercase tracking-[0.2em] text-slate-500">
            &copy; {new Date().getFullYear()} Vibecraft AI Studio. {t("All rights reserved.")}
          </p>
          <div className="mt-4 flex justify-center gap-6">
            <Link
              href="/privacy"
              className="font-label text-[10px] uppercase tracking-[0.2em] text-slate-600 transition-colors hover:text-[#adc6ff]"
            >
              {t("Privacy")}
            </Link>
            <Link
              href="/policy"
              className="font-label text-[10px] uppercase tracking-[0.2em] text-slate-600 transition-colors hover:text-[#adc6ff]"
            >
              {t("Terms")}
            </Link>
            <a
              href="mailto:ouni@novanode.tn"
              className="font-label text-[10px] uppercase tracking-[0.2em] text-slate-600 transition-colors hover:text-[#adc6ff]"
            >
              {t("Support")}
            </a>
          </div>
        </footer>
      </div>
    </div>

      <div className="pointer-events-none fixed bottom-0 left-0 h-1 w-full bg-gradient-to-r from-transparent via-[#adc6ff]/20 to-transparent" />
    </main>
  );
}

export default function AuthPage() {
  return <AuthContent />;
}

