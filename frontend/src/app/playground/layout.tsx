"use client";

import AppSidebar from "../../components/app-shell/AppSidebar";
import RequireActiveUser from "../../components/auth/RequireActiveUser";

// The Playground is the logged-in home. It brings its own topbar (conversation
// title, token/credit counters, model controls), so this layout supplies only
// the app rail: rail = navigation, topbar = conversation. The page itself is
// full-height, so `main` must not add padding or scroll of its own.
export default function PlaygroundLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireActiveUser>
      <div className="flex min-h-screen overflow-x-hidden bg-[#0c1324] text-[#dce1fb] selection:bg-[#4d8eff] selection:text-[#00285d]">
        <AppSidebar activePath="/playground" />
        <main className="flex min-w-0 flex-1 flex-col lg:ml-48">{children}</main>
      </div>
    </RequireActiveUser>
  );
}
