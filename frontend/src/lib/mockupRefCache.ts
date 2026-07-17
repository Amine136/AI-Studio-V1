"use client";

// Remembers the uploaded file_id for a scene template so opening the same pack
// variant twice doesn't upload the same image twice.
//
// Without this, the packs studio re-uploaded the template on every mount: one
// scene accumulated 24 identical copies for a single user, and the whole
// uploaded_images table was ~92% duplicated templates.

import { isPrivateFileUrl } from "../components/AuthenticatedImage";

export type CachedMockupRef = {
  file_id: string;
  name?: string;
  mime_type?: string;
  url: string;
  created_at: number;
};

const KEY = "vc:mockupRefs";
// Comfortably inside the server's 30-day sweep of uploaded_input, so a cached
// id is very unlikely to be dead. `mockupRefStillExists` covers the rest.
const TTL_MS = 20 * 24 * 60 * 60 * 1000;

type Store = Record<string, CachedMockupRef>;

// The template a variant points at can change; keying on the source url means a
// swapped image invalidates its own entry instead of serving the old upload.
export function mockupCacheKey(uid: string, variantId: string, sourceUrl: string): string {
  return `${uid}::${variantId}::${sourceUrl}`;
}

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Cache is an optimization; a failed write just means we re-upload.
  }
}

export function readMockupRef(key: string): CachedMockupRef | null {
  const entry = read()[key];
  if (!entry || typeof entry.file_id !== "string") return null;
  if (Date.now() - entry.created_at > TTL_MS) return null;
  return entry;
}

export function writeMockupRef(key: string, ref: Omit<CachedMockupRef, "created_at">): void {
  const store = read();
  store[key] = { ...ref, created_at: Date.now() };
  write(store);
}

export function dropMockupRef(key: string): void {
  const store = read();
  if (!(key in store)) return;
  delete store[key];
  write(store);
}

/** Cheap liveness check before trusting a cached id — asks for one byte, not the file.
 *
 * GET with a Range rather than HEAD: the backend declares /files/{id} as GET only
 * and answers HEAD with 405, which would make every cached ref look dead and send
 * us back to re-uploading on every mount.
 */
export async function mockupRefStillExists(
  user: { getIdToken: () => Promise<string> } | null,
  url: string,
): Promise<boolean> {
  try {
    const headers: HeadersInit = { Range: "bytes=0-0" };
    if (isPrivateFileUrl(url)) {
      if (!user) return false;
      headers.Authorization = `Bearer ${await user.getIdToken()}`;
    }
    const res = await fetch(url, { method: "GET", headers });
    return res.ok; // 200 (range ignored) or 206 (honored) both mean it's there.
  } catch {
    return false;
  }
}
