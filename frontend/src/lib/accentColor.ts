export const ACCENT_COOKIE_NAME = "workspace_accent";

export const ACCENT_OPTIONS = {
  blue: { solid: "#adc6ff", soft: "rgba(173, 198, 255, 0.22)", ring: "rgba(173, 198, 255, 0.35)" },
  violet: { solid: "#d0bcff", soft: "rgba(208, 188, 255, 0.22)", ring: "rgba(208, 188, 255, 0.35)" },
  red: { solid: "#ef4444", soft: "rgba(239, 68, 68, 0.22)", ring: "rgba(239, 68, 68, 0.35)" },
  green: { solid: "#10b981", soft: "rgba(16, 185, 129, 0.22)", ring: "rgba(16, 185, 129, 0.35)" },
  amber: { solid: "#f59e0b", soft: "rgba(245, 158, 11, 0.22)", ring: "rgba(245, 158, 11, 0.35)" },
  pink: { solid: "#ec4899", soft: "rgba(236, 72, 153, 0.22)", ring: "rgba(236, 72, 153, 0.35)" },
} as const;

export type AccentColorId = keyof typeof ACCENT_OPTIONS;

const DEFAULT_ACCENT: AccentColorId = "blue";

export function isAccentColorId(value: string): value is AccentColorId {
  return value in ACCENT_OPTIONS;
}

export function normalizeAccentColor(value: string | null | undefined): AccentColorId {
  if (value && isAccentColorId(value)) return value;
  return DEFAULT_ACCENT;
}

export function readAccentColorFromCookie(cookieString?: string): AccentColorId {
  const source = cookieString ?? (typeof document !== "undefined" ? document.cookie : "");
  const match = source.match(new RegExp(`(?:^|; )${ACCENT_COOKIE_NAME}=([^;]+)`));
  if (!match) return DEFAULT_ACCENT;
  return normalizeAccentColor(decodeURIComponent(match[1]));
}

export function persistAccentColor(accent: AccentColorId): void {
  if (typeof document === "undefined") return;
  document.cookie = `${ACCENT_COOKIE_NAME}=${encodeURIComponent(accent)}; path=/; max-age=31536000; samesite=lax`;
}

export function applyAccentColorToDocument(accent: AccentColorId): void {
  if (typeof document === "undefined") return;
  const palette = ACCENT_OPTIONS[accent];
  document.documentElement.style.setProperty("--workspace-accent", palette.solid);
  document.documentElement.style.setProperty("--workspace-accent-soft", palette.soft);
  document.documentElement.style.setProperty("--workspace-accent-ring", palette.ring);
}
