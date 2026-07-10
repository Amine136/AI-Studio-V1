"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { signOutUser } from "../../lib/auth";
import { api } from "../../services/api";
import type { CurrentUserProfile } from "../../types";

function resolveInactiveReason(profile?: CurrentUserProfile | null, error?: unknown): "deactivated" | "suspended" | "unauthorized" {
  if (profile?.isDeactivated) return "deactivated";
  if (profile?.isSuspended) return "suspended";

  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: string }).message || "").toLowerCase()
      : "";

  if (message.includes("deactivated")) return "deactivated";
  if (message.includes("suspended")) return "suspended";
  return "unauthorized";
}

export default function RequireActiveUser({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();
  const [allowed, setAllowed] = useState(false);
  const [validating, setValidating] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    let cancelled = false;

    async function validateAccess() {
      if (!user) {
        if (typeof window !== "undefined" && sessionStorage.getItem("signingOut") === "true") {
          sessionStorage.removeItem("signingOut");
          router.replace("/auth");
        } else {
          // Preserve the full path AND query string (e.g. /credits?code=VC-...) so the
          // user lands back on the exact deep link after logging in. usePathname()
          // drops the query, so read it from window.location.
          const target =
            typeof window !== "undefined"
              ? `${window.location.pathname}${window.location.search}`
              : pathname || "/playground";
          router.replace(`/auth?reason=unauthorized&next=${encodeURIComponent(target)}`);
        }
        return;
      }

      try {
        const profile = await api.getProfile();
        if (cancelled) return;

        if (profile.isDeactivated || profile.isSuspended) {
          const reason = resolveInactiveReason(profile);
          await signOutUser().catch(() => undefined);
          if (cancelled) return;
          router.replace(`/auth?reason=${reason}`);
          return;
        }

        setAllowed(true);
      } catch (error: unknown) {
        const reason = resolveInactiveReason(undefined, error);
        await signOutUser().catch(() => undefined);
        if (cancelled) return;
        router.replace(`/auth?reason=${reason}`);
      } finally {
        if (!cancelled) {
          setValidating(false);
        }
      }
    }

    setAllowed(false);
    setValidating(true);
    void validateAccess();

    return () => {
      cancelled = true;
    };
  }, [authLoading, pathname, router, user]);

  if (authLoading || validating || !allowed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0c1324]">
        <div className="auth-loader" />
      </main>
    );
  }

  return <>{children}</>;
}
