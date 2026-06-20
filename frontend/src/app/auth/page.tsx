"use client";

import Link from "next/link";
import { useLanguage } from "../../context/LanguageContext";
import AuthPanel from "../../components/auth/AuthPanel";

function AuthContent() {
  const { t, language, setLanguage } = useLanguage();

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

          <AuthPanel className="w-full" />

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
                href="mailto:contact@ouni.space"
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
