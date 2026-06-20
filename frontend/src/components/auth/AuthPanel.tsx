"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  signInWithGoogle,
  signOutUser,
  sendEmailSignInLink,
  isEmailSignInLink,
  getStoredSignInEmail,
  completeEmailLinkSignIn,
} from "@/lib/auth";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { api } from "@/services/api";

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
  if (normalized.includes("auth/invalid-email")) {
    return "Please enter a valid email address.";
  }
  if (
    normalized.includes("auth/invalid-action-code") ||
    normalized.includes("auth/expired-action-code")
  ) {
    return "This sign-in link has expired or was already used. Please request a new one.";
  }
  if (
    normalized.includes("auth/too-many-requests") ||
    normalized.includes("auth/quota-exceeded")
  ) {
    return "Too many requests. Please try again later.";
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

interface AuthPanelProps {
  /** Wrapper width/utility classes. Defaults to a centered max-w-md column. */
  className?: string;
}

/**
 * Self-contained sign-in card (Google + passwordless email link). Owns all auth
 * state, the email-link completion flow, and the post-sign-in redirect to
 * /dashboard or /onboarding. Reused on the /auth page and embedded in the
 * landing page. The redirect effect only fires after the user signs in, so
 * mounting it for an already-signed-in visitor is the caller's responsibility
 * (the landing page renders it for signed-out visitors only).
 */
export default function AuthPanel({ className = "w-full max-w-md" }: AuthPanelProps) {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { t, language } = useLanguage();

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [validatingSession, setValidatingSession] = useState(false);
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);

  // Passwordless email-link state.
  const [email, setEmail] = useState("");
  const [sendingLink, setSendingLink] = useState(false);
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  const [completingLink, setCompletingLink] = useState(false);
  const [needsEmailToComplete, setNeedsEmailToComplete] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const ua = navigator.userAgent || navigator.vendor || (window as any).opera || "";
      if (/FBAN|FBAV|Instagram|Threads/i.test(ua)) {
        setIsInAppBrowser(true);
      }
    }
  }, []);

  // Complete a passwordless sign-in when the user lands back here from the
  // email link. Once signed in, onAuthStateChanged fires and the session-
  // validation effect below performs the profile check + safe redirect.
  const finishLinkSignIn = useCallback(async (emailToUse: string) => {
    setError("");
    setNeedsEmailToComplete(false);
    setCompletingLink(true);
    try {
      await completeEmailLinkSignIn(emailToUse, window.location.href);
      // Success: onAuthStateChanged + the redirect effect take over from here.
    } catch (err: unknown) {
      setError(mapAuthErrorMessage(err));
    } finally {
      setCompletingLink(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isEmailSignInLink(window.location.href)) return;
    const stored = getStoredSignInEmail();
    if (stored) {
      void finishLinkSignIn(stored);
    } else {
      // Link opened on a different device/browser — ask for the email it was sent to.
      setNeedsEmailToComplete(true);
    }
  }, [finishLinkSignIn]);

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
      .then((profile) => {
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
        // New accounts (e.g. email-link sign-ups with no name) must pick a
        // display name + username before entering the app.
        if (profile?.requiresProfileSetup) {
          router.replace(`/onboarding?next=${encodeURIComponent(safeNext)}`);
          return;
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

  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleSendLink = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!emailIsValid) {
      setError("Please enter a valid email address.");
      return;
    }
    setError("");
    setSendingLink(true);
    try {
      const next = new URLSearchParams(window.location.search).get("next");
      const target = email.trim();
      await sendEmailSignInLink(target, next, language);
      // If this was the cross-device "confirm your email" step, finish it.
      if (needsEmailToComplete && isEmailSignInLink(window.location.href)) {
        await finishLinkSignIn(target);
        return;
      }
      setLinkSentTo(target);
    } catch (err: unknown) {
      setError(mapAuthErrorMessage(err));
    } finally {
      setSendingLink(false);
    }
  };

  // When the link is opened on a new device we already have the oobCode in the
  // URL; the email input just needs to confirm which address it was sent to.
  const handleConfirmEmail = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!emailIsValid) {
      setError("Please enter a valid email address.");
      return;
    }
    await finishLinkSignIn(email.trim());
  };

  // While the session is being validated / a link is being completed, show a
  // contained loader (sized to the card) instead of taking over the page.
  if (authLoading || completingLink || (user && validatingSession)) {
    return (
      <div className={`flex min-h-[360px] items-center justify-center ${className}`}>
        <div className="auth-loader" />
      </div>
    );
  }

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
    <div className={`rounded-2xl border border-[#adc6ff]/30 bg-[rgba(25,31,49,0.74)] px-5 py-8 sm:p-10 text-center backdrop-blur-[24px] shadow-[0_0_0_1px_rgba(173,198,255,0.08),0_24px_70px_-18px_rgba(77,142,255,0.45)] ${className}`}>
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

      {needsEmailToComplete ? (
        <form onSubmit={handleConfirmEmail} className="text-left rtl:text-right">
          <p className="mb-3 text-sm text-[#c2c6d6]">{t("Confirm your email to finish signing in")}</p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("Enter your email")}
            dir="ltr"
            autoFocus
            className="w-full rounded-md border border-[#adc6ff]/15 bg-[#0c1324]/60 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors focus:border-[#4d8eff]/50"
          />
          <button
            type="submit"
            disabled={!emailIsValid}
            className="font-headline mt-3 flex w-full items-center justify-center gap-3 rounded-md bg-gradient-to-br from-[#adc6ff] to-[#4d8eff] px-6 py-3.5 font-bold text-[#002e6a] transition-all duration-300 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
          >
            <span className="tracking-wide">{t("Finish sign-in")}</span>
          </button>
        </form>
      ) : linkSentTo ? (
        <div className="rounded-xl border border-[#adc6ff]/15 bg-[#2e3447]/20 px-5 py-7 text-center">
          <div className="mb-4 flex justify-center">
            <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 p-3">
              <span className="material-symbols-outlined text-2xl text-emerald-300">mark_email_read</span>
            </div>
          </div>
          <h3 className="font-headline mb-2 text-lg font-medium text-slate-100">{t("Check your inbox")}</h3>
          <p className="mb-1 text-sm text-[#c2c6d6]">
            {t("We sent a sign-in link to")} <span className="font-semibold text-[#adc6ff]" dir="ltr">{linkSentTo}</span>
          </p>
          <p className="mb-5 text-xs leading-relaxed text-slate-400">
            {t("Click the link in the email to finish signing in. The link expires in 1 hour.")}
          </p>
          <button
            type="button"
            onClick={() => { setLinkSentTo(null); setEmail(""); }}
            className="font-label text-[11px] uppercase tracking-[0.16em] text-[#adc6ff] underline underline-offset-4 hover:text-white"
          >
            {t("Use a different email")}
          </button>
        </div>
      ) : (
        <>
          <div className="mb-7 text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">
              <span className="material-symbols-outlined text-[13px]">bolt</span>
              {t("Free to start")}
            </span>
            <h2 className="font-headline mt-4 text-2xl font-bold leading-tight text-[#eef1ff] sm:text-[28px]">
              {t("Start creating for free")}
            </h2>
            <p className="mt-2 text-sm text-[#c2c6d6]">
              {t("No password needed — just your email.")}
            </p>
          </div>

          {/* In-app browsers (FB/Instagram/Threads) can't run the Google popup,
              so we hide it there and let users sign in with the email link below. */}
          {!isInAppBrowser && (
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

          {!isInAppBrowser && (
            <div className="my-6 flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-[#adc6ff]/15" />
              <span className="font-label text-[10px] uppercase tracking-widest text-slate-500">{t("or")}</span>
              <span className="h-px flex-1 bg-[#adc6ff]/15" />
            </div>
          )}

          <form onSubmit={handleSendLink} className="text-left rtl:text-right">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("Enter your email")}
              dir="ltr"
              className="w-full rounded-md border border-[#adc6ff]/15 bg-[#0c1324]/60 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors focus:border-[#4d8eff]/50"
            />
            <button
              type="submit"
              disabled={sendingLink || !emailIsValid}
              className={`font-headline mt-3 flex w-full items-center justify-center gap-3 rounded-md px-6 py-3.5 font-bold transition-all duration-300 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
                isInAppBrowser
                  ? "bg-gradient-to-br from-[#adc6ff] to-[#4d8eff] text-[#002e6a] hover:brightness-110"
                  : "border border-[#adc6ff]/25 bg-[#2e3447]/30 text-[#dce1fb] hover:bg-[#2e3447]/60"
              }`}
            >
              {sendingLink ? (
                <span className="auth-spinner" aria-hidden="true" />
              ) : (
                <span className="material-symbols-outlined text-[20px]">mail</span>
              )}
              <span className="tracking-wide">{sendingLink ? t("Sending…") : t("Email me a sign-in link")}</span>
            </button>
          </form>
        </>
      )}

      <p className="mt-8 text-center text-[11px] leading-relaxed text-slate-500">
        {t("By continuing, you acknowledge")}{" "}
        <a
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#adc6ff] underline underline-offset-2 transition-colors hover:text-white"
        >
          {t("Vibecraft's Privacy Policy")}
        </a>
      </p>
    </div>
  );
}
