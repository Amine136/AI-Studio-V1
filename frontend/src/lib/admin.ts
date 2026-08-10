import type { AdminSession } from "../types";

export const ADMIN_HOST = (process.env.NEXT_PUBLIC_ADMIN_HOST || "prodxvibecraft.ouni.space").toLowerCase();
const STUDIO_URL = process.env.NEXT_PUBLIC_STUDIO_URL || "";
export const ADMIN_CSRF_COOKIE = process.env.NEXT_PUBLIC_ADMIN_CSRF_COOKIE || "vibecraft_admin_csrf";

export function isAdminHost(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.host.toLowerCase().split(":")[0];
  const envAdmin = (process.env.NEXT_PUBLIC_ADMIN_HOST || "").toLowerCase();
  return (
    host === "prodxvibecraft.ouni.space" ||
    host === "adminvibecraft.ouni.space" ||
    host.startsWith("prodxvibecraft") ||
    host.startsWith("adminvibecraft") ||
    (envAdmin !== "" && host === envAdmin)
  );
}

export function getStudioUrl(): string {
  if (STUDIO_URL) return STUDIO_URL;
  if (typeof window === "undefined") return "https://vibecraft.ouni.space";

  const { protocol, host } = window.location;
  if (host.toLowerCase().startsWith("prodxvibecraft.")) {
    return `${protocol}//vibecraft.ouni.space`;
  }
  if (host.toLowerCase().startsWith("admin.")) {
    return `${protocol}//${host.slice("admin.".length)}`;
  }
  return `${protocol}//${host}`;
}

export function formatAdminSessionExpiry(session: AdminSession): string {
  return new Date(session.expiresAt * 1000).toLocaleString();
}

export function getAdminCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const prefix = `${ADMIN_CSRF_COOKIE}=`;
  const part = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(prefix));
  if (!part) return "";
  return decodeURIComponent(part.slice(prefix.length));
}
