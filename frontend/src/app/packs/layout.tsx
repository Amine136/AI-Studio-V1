"use client";

import { useEffect, useState } from "react";
import AppSidebar from "../../components/app-shell/AppSidebar";
import RequireActiveUser from "../../components/auth/RequireActiveUser";
import { useAuth } from "../../context/AuthContext";
import { useLanguage, type Language } from "../../context/LanguageContext";
import { getProfile } from "../../lib/credits";
import { fmtNum, pt } from "./packsShared";

const LANGS: { code: Language; label: string }[] = [
  { code: "en", label: "EN" },
  { code: "fr", label: "FR" },
  { code: "ar", label: "ع" },
];

export default function PacksLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { language, setLanguage, isRtl } = useLanguage();
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    function refresh() {
      if (!user) return;
      void getProfile()
        .then((p) => {
          if (!cancelled) setCredits(p.credits ?? 0);
        })
        .catch(() => {
          if (!cancelled) setCredits(null);
        });
    }
    refresh();
    window.addEventListener("studio-credits-refresh", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("studio-credits-refresh", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [user]);

  return (
    <RequireActiveUser>
      <div className="flex min-h-screen overflow-x-hidden bg-[#0d1320] text-[#eaedf6] selection:bg-white/20">
        <AppSidebar activePath="/packs" hideMobileNav={false} />

        <main
          className="flex min-w-0 flex-1 flex-col lg:ml-48"
          style={isRtl ? { fontFamily: "'Tajawal', sans-serif" } : undefined}
        >
          <header className="sticky top-0 z-40 flex h-[60px] items-center justify-between border-b border-white/[.08] bg-[#0d1320]/80 px-4 backdrop-blur-xl sm:px-8">
            <div className="flex items-baseline gap-2 font-['Bricolage_Grotesque'] tracking-tight">
              <span className="text-lg font-bold text-[#eaedf6]">{pt(language, "brand")}</span>
              <span className="text-[#606d8a]">·</span>
              <span className="text-lg font-semibold text-[#93a0bd]">{pt(language, "packs")}</span>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-full border border-white/[.08] bg-[#161d2c] px-3 py-1.5">
                <span className="material-symbols-outlined text-sm text-[#e7ad4d]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  bolt
                </span>
                <span className="font-mono text-xs font-semibold text-[#eaedf6] sm:text-sm">
                  {credits === null ? "…" : fmtNum(language, credits)}
                </span>
              </div>

              <div dir="ltr" className="flex items-center gap-1 rounded-full border border-white/[.08] bg-[#121826] p-0.5">
                {LANGS.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => setLanguage(l.code)}
                    className={`rounded-full px-2.5 py-1 font-mono text-xs font-bold transition ${
                      language === l.code ? "bg-[#eaedf6] text-[#0d1320]" : "text-[#93a0bd] hover:text-white"
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          </header>

          {children}
        </main>
      </div>
    </RequireActiveUser>
  );
}
