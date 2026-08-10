"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "../../../services/api";
import { isAdminHost } from "../../../lib/admin";
import type { AdminSession } from "../../../types";

function isAuthError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("admin authentication required") || normalized.includes("invalid or expired admin session");
}

export function useAdminSession() {
  const router = useRouter();
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!isAdminHost()) {
      router.replace("/");
      return null;
    }

    setLoading(true);
    setError("");
    try {
      const nextSession = await api.getAdminSession();
      setSession(nextSession);
      return nextSession;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to verify admin access.";
      if (isAuthError(message)) {
        if (typeof window !== "undefined") {
          localStorage.removeItem("vibecraft_admin_token");
        }
        setSession(null);
        router.replace("/admin/login");
        return null;
      }
      setError(message);
      setSession(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    session,
    loading,
    error,
    refresh,
  };
}
