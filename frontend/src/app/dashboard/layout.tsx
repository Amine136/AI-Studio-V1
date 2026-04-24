"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { getProfile } from "../../lib/credits";
import AppSidebar from "../../components/app-shell/AppSidebar";

function initialsFromName(value?: string | null) {
  if (!value) return "VC";
  const parts = value.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "VC";
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [credits, setCredits] = useState<number | null>(null);

  const displayName = user?.displayName || user?.email?.split("@")[0] || "Creative Studio";
  const photoUrl = user?.photoURL || null;

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        const profile = await getProfile();
        if (!cancelled) {
          setCredits(profile.credits ?? 0);
        }
      } catch {
        if (!cancelled) {
          setCredits(null);
        }
      }
    }

    if (user) {
      void loadProfile();
    }

    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <div className="flex min-h-screen bg-[#0c1324] text-[#dce1fb] selection:bg-[#adc6ff]/30">
      <AppSidebar activePath="/dashboard" />

      <main className="ml-0 min-h-screen flex-1 bg-[#0c1324] md:ml-64">
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-white/5 bg-[#0c1324]/80 px-8 py-4 font-headline tracking-tight shadow-xl shadow-blue-900/10 backdrop-blur-xl">
          <div className="flex flex-1 items-center">
            <h2 className="text-xl font-bold tracking-tight text-[#dce1fb]">Dashboard</h2>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 rounded-full border border-white/5 bg-[#23293c] px-4 py-1.5">
              <span className="material-symbols-outlined text-sm text-[#adc6ff]" style={{ fontVariationSettings: "'FILL' 1" }}>
                bolt
              </span>
              <span className="text-sm font-bold text-blue-100">
                {credits === null ? "..." : `${credits.toFixed(2)} Credits`}
              </span>
            </div>
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 border-[#adc6ff]/20 transition-colors hover:border-[#adc6ff]/50">
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt={displayName} className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs font-bold text-[#adc6ff]">{initialsFromName(displayName)}</span>
              )}
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl space-y-12 p-8">{children}</div>
      </main>
    </div>
  );
}
