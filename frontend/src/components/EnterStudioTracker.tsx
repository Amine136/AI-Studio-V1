"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import { trackCustom } from "../lib/pixel";

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
  // Keyed on the surface, not the path, so moving between a pack and its batch
  // page does not re-report entering Packs.
  const lastSurface = useRef<string | null>(null);

  useEffect(() => {
    if (loading || !user || !pathname) return;

    const surface = surfaceFor(pathname);
    if (!surface || lastSurface.current === surface) return;

    lastSurface.current = surface;
    trackCustom("EnterStudio", { content_name: surface });
  }, [pathname, user, loading]);

  return null;
}
