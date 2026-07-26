"use client";

import AppSidebar from "../../../components/app-shell/AppSidebar";
import RequireActiveUser from "../../../components/auth/RequireActiveUser";

// Mirrors app/credits/layout.tsx. Anonymous visitors may browse the plans and the
// payment details; the wall goes up at submit, which carries them through
// /auth?next= back to this page.
export default function BuyCreditsLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireActiveUser allowAnonymous>
      <div className="vc-lightpage flex min-h-screen overflow-x-hidden bg-[#0c1324] text-[#dce1fb] selection:bg-[#adc6ff]/30">
        <AppSidebar activePath="/credits" />

        <main className="flex min-w-0 flex-1 flex-col lg:ms-48">
          <div className="flex-1 pb-24 lg:pb-0">{children}</div>
        </main>
      </div>
    </RequireActiveUser>
  );
}
