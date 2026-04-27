"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithGoogle } from "../../lib/auth";
import { useAuth } from "../../context/AuthContext";

export default function AuthPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && user) {
      router.replace("/dashboard");
    }
  }, [authLoading, user, router]);

  if (authLoading || user) {
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
      router.replace("/dashboard");
    } catch (err: unknown) {
      const firebaseError = err as { message?: string };
      setError(firebaseError.message || "Google sign-in failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#0c1324] px-6 py-10 text-[#dce1fb]">
      <div
        className="pointer-events-none fixed inset-0"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgba(77, 142, 255, 0.08) 0%, rgba(12, 19, 36, 0) 70%)",
        }}
      />
      <div className="pointer-events-none fixed left-[-10%] top-[-10%] h-[40%] w-[40%] rounded-full bg-[#adc6ff]/5 blur-[120px]" />
      <div className="pointer-events-none fixed bottom-[-10%] right-[-10%] h-[40%] w-[40%] rounded-full bg-[#d0bcff]/5 blur-[120px]" />

      <div className="relative z-10 w-full max-w-md">
        <header className="mb-12 text-center">
          <h1 className="font-headline mb-2 text-4xl font-bold uppercase tracking-[0.25em] text-[#dce1fb]">
            Vibecraft
          </h1>
          <p className="font-label text-[10px] uppercase tracking-[0.4em] text-[#adc6ff]/60">AI Studio</p>
        </header>

        <div className="rounded-xl border border-[#adc6ff]/15 bg-[rgba(25,31,49,0.6)] p-10 text-center backdrop-blur-[24px]">
          <div className="mb-8 flex justify-center">
            <div className="rounded-full border border-[#adc6ff]/15 bg-[#2e3447]/40 p-4">
              <span className="material-symbols-outlined text-3xl text-[#adc6ff]">fingerprint</span>
            </div>
          </div>

          <h2 className="font-headline mb-4 text-2xl font-medium tracking-tight text-slate-100">
            The Digital Architect.
          </h2>
          <p className="mx-auto mb-10 max-w-[280px] text-sm leading-relaxed text-[#c2c6d6]">
            Engineered for creative excellence. Access your private workspace.
          </p>

          {error ? (
            <div className="mb-5 rounded-md border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}

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
            <span className="tracking-wide">{loading ? "Signing in…" : "Sign in with Google"}</span>
          </button>

          <div className="mt-8 flex items-center justify-center gap-2 opacity-40">
            <span className="material-symbols-outlined text-xs">verified_user</span>
            <span className="font-label text-[10px] uppercase tracking-widest">End-to-end Encrypted Sessions</span>
          </div>
        </div>

        <footer className="mt-12 text-center">
          <p className="font-label text-[10px] uppercase tracking-[0.2em] text-slate-500">
            © 2026 Vibecraft AI Studio. Engineered for the avant-garde.
          </p>
          <div className="mt-4 flex justify-center gap-6">
            <Link
              href="/privacy"
              className="font-label text-[10px] uppercase tracking-[0.2em] text-slate-600 transition-colors hover:text-[#adc6ff]"
            >
              Privacy
            </Link>
            <Link
              href="/policy"
              className="font-label text-[10px] uppercase tracking-[0.2em] text-slate-600 transition-colors hover:text-[#adc6ff]"
            >
              Terms
            </Link>
            <a
              href="mailto:ouni@novanode.tn"
              className="font-label text-[10px] uppercase tracking-[0.2em] text-slate-600 transition-colors hover:text-[#adc6ff]"
            >
              Support
            </a>
          </div>
        </footer>
      </div>

      <div className="pointer-events-none fixed bottom-0 left-0 h-1 w-full bg-gradient-to-r from-transparent via-[#adc6ff]/20 to-transparent" />
    </main>
  );
}
