"use client";

import AppSidebar from "../../components/app-shell/AppSidebar";
import RequireActiveUser from "../../components/auth/RequireActiveUser";

// No page header: the rail already names the section, so the old sticky bar
// (page title + avatar) was a second, redundant label. Content starts at the
// top of the main column.
export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return (
    // Pricing is browsable logged-out (like the Playground): the catalogue is
    // public information, and Buy Codes / redemption still require an account.
    <RequireActiveUser allowAnonymous>
      <div className="flex min-h-screen overflow-x-hidden bg-[#0c1324] text-[#dce1fb] selection:bg-[#adc6ff]/30">
        <AppSidebar activePath="/pricing" />

        <main className="flex min-w-0 flex-1 flex-col lg:ms-48">
          <div className="flex-1 pb-24 lg:pb-0">{children}</div>
        </main>
      </div>
    </RequireActiveUser>
  );
}
