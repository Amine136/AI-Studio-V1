"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import { trackCustom } from "../lib/pixel";

/** Last surface reported, held at module scope rather than in a ref.
 *
 * RequireActiveUser drops back to its loader — unmounting its children — on
 * every pathname change AND whenever the Firebase user object changes identity,
 * so this component is destroyed and rebuilt constantly. Per-instance state
 * resets with it and would let one visit report several times; only state that
 * outlives the mount can tell a real surface change from a remount. It resets
 * on a full page load, which is correct: that is a genuine new entry. */
let lastSurface: string | null = null;

/** Which generation surface a route is, for the EnterStudio breakdown.
 *
 * A pack's own pages (/packs/[id], .../batch) are still "Packs": they are one
 * visit to the same surface, not three separate entries into the studio. */
function surfaceFor(pathname: string): string | null {
  if (pathname === "/playground") return "Playground";
  if (pathname === "/create") return "Create";
  if (pathname.startsWith("/packs")) return "Packs";
  return null;
}

/**
 * Reports EnterStudio — "a signed-in user reached a generation surface".
 *
 * This deliberately does not live in MetaPixel's route table. That table runs
 * on every route change with no knowledge of auth, so a logged-out visitor
 * opening /create fired EnterStudio in the moment before the guard bounced them
 * to /auth: an "entered the studio" for someone who was shown a sign-in wall.
 *
 * Gating the route table on auth instead would mean moving MetaPixel inside
 * AuthProvider, which couples *every PageView* — the highest-volume event we
 * have — to provider mount timing. Firing from inside the guarded layouts costs
 * nothing and cannot produce the false positive in the first place.
 */
export default function EnterStudioTracker() {
  const pathname = usePathname();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || !user || !pathname) return;

    // Keyed on the surface, not the path, so moving between a pack and its
    // batch page does not re-report entering Packs.
    const surface = surfaceFor(pathname);
    if (!surface || lastSurface === surface) return;

    lastSurface = surface;
    trackCustom("EnterStudio", { content_name: surface });
  }, [pathname, user, loading]);

  return null;
}
