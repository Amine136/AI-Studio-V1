"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../context/AuthContext";
import { useLanguage } from "../../../context/LanguageContext";
import { getProfile } from "../../../lib/credits";
import { fmtNum, pt } from "./packsShared";

export default function PacksLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { language, isRtl, t } = useLanguage();
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
    <div className="flex min-w-0 flex-1 flex-col" style={isRtl ? { fontFamily: "'Tajawal', sans-serif" } : undefined}>
      <header className="sticky top-0 z-40 flex h-[60px] items-center justify-between border-b border-white/[.08] bg-[#0d1320]/80 px-4 backdrop-blur-xl sm:px-8">
        <div className="flex items-center gap-2">
          <Link href="/playground" title={t("Back to Playground")} className="chat-topbar-btn">
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          </Link>
          <div className="flex items-baseline gap-2 font-['Bricolage_Grotesque'] tracking-tight">
            <span className="text-lg font-bold text-[#eaedf6]">{pt(language, "brand")}</span>
            <span className="text-[#606d8a]">·</span>
            <span className="text-lg font-semibold text-[#93a0bd]">{pt(language, "packs")}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-full border border-white/5 bg-[#23293c] px-3 py-1.5 sm:px-4">
          <span className="material-symbols-outlined text-sm text-[#adc6ff]" style={{ fontVariationSettings: "'FILL' 1" }}>
            bolt
          </span>
          <span className="text-xs font-bold text-blue-100 sm:text-sm">
            {credits === null ? "..." : `${t("Balance:")} ${credits.toFixed(2)}`}
          </span>
        </div>
      </header>

      {children}
    </div>
  );
}
