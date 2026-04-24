"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithGoogle } from "../../lib/auth";
import { useAuth } from "../../context/AuthContext";

const valuePoints = [
  "Google-only sign-in for a simpler and safer MVP",
  "Quick mode for lower-cost creation",
  "Smart mode for analyze and optimize before generation",
];

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
      <main className="min-h-screen flex items-center justify-center">
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
    <main className="auth-scene min-h-screen overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(circle at 18% 14%, rgba(59,130,246,0.20), transparent 24%), radial-gradient(circle at 78% 18%, rgba(139,92,246,0.18), transparent 24%), radial-gradient(circle at 60% 80%, rgba(34,197,94,0.08), transparent 22%)",
        }}
      />

      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden px-8 py-10 lg:flex lg:flex-col lg:justify-between lg:px-12 xl:px-16">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 shadow-[0_0_30px_rgba(59,130,246,0.18)]">
                <span className="text-lg font-black text-white">V</span>
              </div>
              <div>
                <div className="text-lg font-semibold tracking-tight text-white">Vibecraft</div>
                <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                  AI content studio
                </div>
              </div>
            </Link>

            <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300">
              Access
            </div>
          </div>

          <div className="max-w-2xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300">
              <span className="h-2 w-2 rounded-full bg-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.8)]" />
              Google sign-in only
            </div>

            <h1 className="max-w-2xl text-5xl font-black leading-[1.04] tracking-tight text-white xl:text-6xl">
              Get into the studio without adding auth complexity the MVP does not need.
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-400">
              Vibecraft is using Google sign-in only for the launch phase so onboarding stays simple, safer, and easier
              to operate while the product is still evolving.
            </p>

            <div className="mt-10 space-y-4">
              {valuePoints.map((item) => (
                <div key={item} className="glass-surface flex items-center gap-4 px-5 py-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-300">
                    <span className="text-sm font-black">+</span>
                  </div>
                  <div className="text-sm leading-6 text-slate-300">{item}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card max-w-xl p-6">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Launch note</div>
            <div className="mt-3 text-base leading-7 text-slate-400">
              Account limits, credit rules, abuse protection, and refund behavior are already enforced on the backend.
              The goal of this auth flow is only to get the right user into the studio with the least friction.
            </div>
          </div>
        </section>

        <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8 lg:px-12 xl:px-16">
          <div className="w-full max-w-xl animate-fade-in-up">
            <div className="mb-8 flex items-center justify-between lg:hidden">
              <Link href="/" className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                  <span className="text-base font-black text-white">V</span>
                </div>
                <div>
                  <div className="text-base font-semibold tracking-tight text-white">Vibecraft</div>
                  <div className="text-[10px] uppercase tracking-[0.24em] text-slate-500">AI content studio</div>
                </div>
              </Link>
              <Link href="/" className="text-sm text-slate-400 transition-colors hover:text-white">
                Back
              </Link>
            </div>

            <div className="glass-card overflow-hidden">
              <div className="border-b border-white/8 px-6 py-6 sm:px-8">
                <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Authentication</div>
                <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
                  Enter Vibecraft
                </h1>
                <p className="mt-3 max-w-lg text-sm leading-7 text-slate-400 sm:text-base">
                  Continue with Google to access the studio, your credits, generation history, and the new Quick or
                  Smart workflow.
                </p>
              </div>

              <div className="px-6 py-6 sm:px-8 sm:py-8">
                {error ? (
                  <div className="mb-5 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                    {error}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="auth-google-btn w-full justify-center rounded-2xl px-5 py-4 text-base font-semibold"
                >
                  {loading ? (
                    <span className="auth-spinner" aria-hidden="true" />
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                    </svg>
                  )}
                  <span>{loading ? "Signing you in…" : "Continue with Google"}</span>
                </button>

                <div className="mt-6 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.24em] text-slate-500">What happens next</div>
                  <div className="mt-3 space-y-2 text-sm leading-6 text-slate-400">
                    <p>You will land in the studio on the authenticated route.</p>
                    <p>Your credits, history, limits, and suspension state will be loaded from the backend automatically.</p>
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    By continuing, you agree to the{" "}
                    <Link href="/policy" className="text-slate-300 transition-colors hover:text-white">
                      Usage Policy
                    </Link>{" "}
                    and{" "}
                    <Link href="/privacy" className="text-slate-300 transition-colors hover:text-white">
                      Privacy Policy
                    </Link>
                    .
                  </div>
                  <Link href="/" className="text-slate-300 transition-colors hover:text-white">
                    Back to home
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
