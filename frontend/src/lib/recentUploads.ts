"use client";

// The user's own recent uploads, tracked in the browser.
//
// Deliberately NOT read back from the server: the backend stores every upload —
// including the scene templates the packs studio uploads on the user's behalf —
// under one `uploaded_input` kind, with nothing to tell them apart. Recording
// here, at the one call site where a *person* picked a file, excludes mockups
// structurally. The trade-off is that this list is per-browser.

export type RecentUpload = {
  file_id: string;
  mime_type: string;
  url: string;
  created_at: number;
};

const KEY = "vc:recentUploads";
const MAX = 40;
// The server sweeps uploaded_input after 30 days; drop entries before then so a
// tile can never point at a file the backend has already deleted.
const TTL_MS = 25 * 24 * 60 * 60 * 1000;

// Scoped per user so a shared browser never shows one account's uploads to another.
function keyFor(uid: string): string {
  return `${KEY}:${uid}`;
}

function fresh(items: RecentUpload[]): RecentUpload[] {
  const cutoff = Date.now() - TTL_MS;
  return items.filter((i) => i.created_at > cutoff);
}

export function listRecentUploads(uid: string | null | undefined): RecentUpload[] {
  if (!uid || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(keyFor(uid));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const items = parsed.filter(
      (i): i is RecentUpload =>
        !!i && typeof i.file_id === "string" && typeof i.url === "string" && typeof i.created_at === "number",
    );
    return fresh(items);
  } catch {
    return [];
  }
}

export function recordRecentUpload(
  uid: string | null | undefined,
  entry: { file_id: string; mime_type?: string; url: string },
): void {
  if (!uid || typeof window === "undefined" || !entry.file_id) return;
  try {
    const next = [
      { file_id: entry.file_id, mime_type: entry.mime_type ?? "image/png", url: entry.url, created_at: Date.now() },
      ...listRecentUploads(uid).filter((i) => i.file_id !== entry.file_id),
    ].slice(0, MAX);
    window.localStorage.setItem(keyFor(uid), JSON.stringify(next));
  } catch {
    // A full or disabled localStorage must never break the upload itself.
  }
}
