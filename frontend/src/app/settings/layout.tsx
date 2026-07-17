"use client";

import AppSidebar from "../../components/app-shell/AppSidebar";
import RequireActiveUser from "../../components/auth/RequireActiveUser";

// No page header: the rail already names the section, so the old sticky bar
// (page title + avatar) was a second, redundant label. Content starts at the
// top of the main column.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    // Settings is browsable logged-out: theme/accent/language work locally for
    // anyone; the account card shows a labelled sample and every server-backed
    // action (profile save, notification toggles) walls to /auth.
    <RequireActiveUser allowAnonymous>
      <div className="flex min-h-screen overflow-x-hidden bg-[#0c1324] text-[#dce1fb] selection:bg-[#adc6ff]/30">
        <AppSidebar activePath="/settings" />

        <main className="flex min-w-0 flex-1 flex-col lg:ms-48">
          <div className="mx-auto w-full max-w-6xl space-y-8 px-4 pb-28 pt-8 sm:space-y-12 sm:p-8 lg:p-12">{children}</div>
        </main>
      </div>
    </RequireActiveUser>
  );
}
