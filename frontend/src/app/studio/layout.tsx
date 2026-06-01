"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import AppSidebar from "../../components/app-shell/AppSidebar";
import { getProfile } from "../../lib/credits";
import RequireActiveUser from "../../components/auth/RequireActiveUser";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const [credits, setCredits] = useState<number | null>(null);

  const displayName = user?.displayName || user?.email?.split("@")[0] || "Studio User";
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

  useEffect(() => {
    function handleCreditsRefresh() {
      if (!user) return;
      void getProfile()
        .then((profile) => {
          setCredits(profile.credits ?? 0);
        })
        .catch(() => {
          setCredits(null);
        });
    }

    window.addEventListener("studio-credits-refresh", handleCreditsRefresh);
    window.addEventListener("focus", handleCreditsRefresh);
    return () => {
      window.removeEventListener("studio-credits-refresh", handleCreditsRefresh);
      window.removeEventListener("focus", handleCreditsRefresh);
    };
  }, [user]);

  const hideSharedHeader = pathname === "/studio/chat";
  const showMobileNav = pathname === "/studio";

  return (
    <RequireActiveUser>
      <div className="flex min-h-screen overflow-x-hidden bg-[#0c1324] text-[#dce1fb] selection:bg-[#4d8eff] selection:text-[#00285d]">
        {!hideSharedHeader && <AppSidebar activePath="/studio" hideMobileNav={!showMobileNav} />}

        <main className={`flex min-w-0 flex-1 flex-col ${hideSharedHeader ? "" : "lg:ml-48"}`}>
          {hideSharedHeader ? null : (
            <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-white/10 bg-[#0c1324]/80 px-4 font-headline shadow-[0_16px_40px_rgba(0,0,0,0.2)] backdrop-blur-xl sm:px-8">
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-bold tracking-tight text-[#dce1fb]">Studio</h2>
              </div>

              <div className="flex items-center gap-2 sm:gap-4">
                <div className="flex items-center gap-2 rounded-full border border-white/5 bg-[#23293c] px-3 py-1.5 sm:px-4">
                  <span className="material-symbols-outlined text-sm text-[#adc6ff]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    bolt
                  </span>
                  <span className="text-xs font-bold text-blue-100 sm:text-sm">
                    {credits === null ? "..." : `${credits.toFixed(2)} Credits`}
                  </span>
                </div>
                <div
                  className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-md border bg-[#1a2333]"
                  style={{
                    borderColor: "var(--workspace-accent-ring)",
                    boxShadow: "0 0 0 1px var(--workspace-accent-soft)",
                  }}
                >
                  {photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrl} alt={displayName} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs font-bold text-[#adc6ff]">{displayName.slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
              </div>
            </header>
          )}

          <div className={showMobileNav ? "pb-24 lg:pb-0" : ""}>{children}</div>
        </main>
      </div>
    </RequireActiveUser>
  );
}
