"use client";

import { useEffect } from "react";
import AppSidebar from "../../components/app-shell/AppSidebar";
import RequireActiveUser from "../../components/auth/RequireActiveUser";
import EnterStudioTracker from "../../components/EnterStudioTracker";

/**
 * Pins the chat shell to the *actually visible* viewport.
 *
 * `100dvh` is not enough on Chrome Android: on first paint it can still resolve
 * to the LARGE viewport (toolbar hidden) before the browser settles. The shell
 * then stands one toolbar (~56px) taller than what you can see, the document
 * becomes scrollable by exactly that much, and it opens scrolled — with the chat
 * header pushed up out of view until you swipe it back. visualViewport.height is
 * the only value that always reports the region the user can really see.
 *
 * It also shrinks when the soft keyboard opens, which keeps the composer above
 * the keyboard, and locking the document's overflow means there is no page-level
 * scroll left to strand the header again.
 */
function useVisibleViewportHeight() {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;

    const apply = () => {
      const height = vv?.height ?? window.innerHeight;
      root.style.setProperty("--app-vh", `${Math.round(height)}px`);
    };
    apply();

    vv?.addEventListener("resize", apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);

    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    return () => {
      vv?.removeEventListener("resize", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      root.style.overflow = previousRootOverflow;
      document.body.style.overflow = previousBodyOverflow;
      root.style.removeProperty("--app-vh");
    };
  }, []);
}

// The Playground is the logged-in home. It brings its own topbar (conversation
// title, token/credit counters, model controls), so this layout supplies only
// the app rail: rail = navigation, topbar = conversation. The page itself is
// full-height, so `main` must not add padding or scroll of its own.
export default function PlaygroundLayout({ children }: { children: React.ReactNode }) {
  useVisibleViewportHeight();

  return (
    // Playground is open for anonymous browsing; every operation (send, upload,
    // attach, history) is walled to /auth by the page itself.
    <RequireActiveUser allowAnonymous>
      {/* Anonymous browsing is allowed here, so the tracker's own signed-in
          check is what keeps EnterStudio honest on this route. */}
      <EnterStudioTracker />
      {/* Height comes from --app-vh (the measured visible viewport); 100dvh is only
          the pre-hydration fallback. See useVisibleViewportHeight above. */}
      <div
        className="fixed inset-x-0 top-0 flex overflow-hidden bg-[#0c1324] text-[#dce1fb] selection:bg-[#4d8eff] selection:text-[#00285d]"
        style={{ height: "var(--app-vh, 100dvh)" }}
      >
        <AppSidebar activePath="/playground" />
        <main className="flex min-w-0 flex-1 flex-col lg:ms-48">{children}</main>
      </div>
    </RequireActiveUser>
  );
}
