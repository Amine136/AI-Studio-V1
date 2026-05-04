"use client";

import { useAuth } from "../../context/AuthContext";
import AppSidebar from "../../components/app-shell/AppSidebar";
import RequireActiveUser from "../../components/auth/RequireActiveUser";

function initialsFromName(value?: string | null) {
  if (!value) return "VC";
  const parts = value.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "VC";
}

export default function GalleryLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  const displayName = user?.displayName || user?.email?.split("@")[0] || "Vibecraft";
  const photoUrl = user?.photoURL || null;

  return (
    <RequireActiveUser>
      <div className="flex min-h-screen bg-[#0c1324] text-[#dce1fb] selection:bg-[#adc6ff]/30">
        <AppSidebar activePath="/gallery" />

        <main className="flex min-w-0 flex-1 flex-col md:ml-48">
          <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-white/10 bg-[#0c1324]/80 px-4 font-headline shadow-[0_16px_40px_rgba(0,0,0,0.2)] backdrop-blur-xl sm:px-8">
            <div className="flex items-center gap-4">
              <h2 className="text-xl font-bold tracking-tight text-[#dce1fb]">Gallery</h2>
            </div>

            <div className="flex items-center">
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
                  <span className="text-xs font-bold text-[#adc6ff]">{initialsFromName(displayName)}</span>
                )}
              </div>
            </div>
          </header>

          <div className="mx-auto w-full max-w-6xl space-y-12 p-8 lg:p-12">{children}</div>
        </main>
      </div>
    </RequireActiveUser>
  );
}
