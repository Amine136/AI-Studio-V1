"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../services/api";
import AuthenticatedImage from "../../../../components/AuthenticatedImage";
import type { Language } from "../../../../context/LanguageContext";
import { listRecentUploads, type RecentUpload } from "../../../../lib/recentUploads";
import { pt } from "../packsShared";

// Marks a drag that started on a result tile inside the app. Chrome puts a real
// File in dataTransfer when an <img> is dragged out of the page, so without this
// an internal drag is indistinguishable from a file off the user's disk — and we
// would re-upload an image the server already has.
export const REF_DND_TYPE = "application/x-vibecraft-ref";

type Tab = "gallery" | "uploaded";

// Each tile does a full authenticated image fetch (there are no thumbnails), so
// the grid reveals a page at a time instead of firing one request per row the
// user may never scroll to. Mirrors the /gallery page's own budget.
const PAGE = 12;

type GalleryItem = { id: string; url: string };

export default function RefPicker({
  open,
  onClose,
  language,
  isRtl,
  uid,
  room,
  busyUrl,
  onPickGallery,
  onPickUpload,
  onFiles,
  onDropRefUrl,
}: {
  open: boolean;
  onClose: () => void;
  language: Language;
  isRtl: boolean;
  /** Scopes the locally-tracked upload history to the signed-in user. */
  uid: string | null;
  /** Ref slots still free. The picker closes itself once the caller runs out. */
  room: number;
  /** URL of the tile currently being converted into a ref, if any. */
  busyUrl: string | null;
  onPickGallery: (url: string) => void;
  onPickUpload: (item: RecentUpload) => void;
  onFiles: (files: FileList | File[] | null) => void;
  /** A result dragged in from the canvas — referenced by url, never uploaded. */
  onDropRefUrl: (url: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("gallery");
  const [gallery, setGallery] = useState<GalleryItem[] | null>(null);
  const [uploads, setUploads] = useState<RecentUpload[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Dismiss on outside click / Escape, the way the rest of the studio's
  // overlays behave.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // Fetch each list once per opening, lazily per tab.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        if (tab === "gallery" && gallery === null) {
          const res = await api.getHistory(60);
          const entries: Array<{ id?: string; imageUrl?: string }> = res?.entries ?? [];
          const items = entries
            .filter((e) => typeof e.imageUrl === "string" && e.imageUrl)
            .map((e, i) => ({ id: String(e.id ?? i), url: e.imageUrl as string }));
          if (!cancelled) setGallery(items);
        } else if (tab === "uploaded" && uploads === null) {
          if (!cancelled) setUploads(listRecentUploads(uid));
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tab, gallery, uploads, uid]);

  useEffect(() => {
    setShown(PAGE);
  }, [tab]);

  // Re-read the upload history every time the picker opens: a file dropped while
  // it was closed (or on the canvas) would otherwise be missing from the tab.
  // It's a localStorage read, so this costs nothing.
  useEffect(() => {
    if (open) setUploads(null);
  }, [open]);

  const items = tab === "gallery" ? gallery : uploads;
  const loading = items === null && !failed;
  const visible = useMemo(() => (items ?? []).slice(0, shown), [items, shown]);

  const pick = useCallback(
    (item: GalleryItem | RecentUpload) => {
      if (room <= 0 || busyUrl) return;
      if (tab === "gallery") onPickGallery(item.url);
      else onPickUpload(item as RecentUpload);
    },
    [room, busyUrl, tab, onPickGallery, onPickUpload],
  );

  if (!open) return null;

  const tabButton = (id: Tab, label: string, icon: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`flex items-center gap-2 rounded-[12px] px-3 py-2.5 text-[13px] transition ${
        tab === id
          ? "bg-white/10 text-white"
          : "text-[#93a0bd] hover:bg-white/5 hover:text-white"
      }`}
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
      {label}
    </button>
  );

  // The composer bar is pinned to the TOP of the canvas, so the picker drops
  // downward over the results grid rather than up off-screen.
  return (
    <div
      ref={rootRef}
      dir={isRtl ? "rtl" : "ltr"}
      className="absolute top-full start-0 z-40 mt-2 w-[560px] max-w-[calc(100vw-2.5rem)] rounded-2xl border border-white/10 bg-[#0d1320]/95 p-2 shadow-[0_24px_60px_-12px_rgba(0,0,0,.8)] backdrop-blur-xl"
    >
      <div className="flex gap-2">
        <div className="flex w-[168px] shrink-0 flex-col gap-1.5">
          {tabButton("gallery", pt(language, "refGallery"), "photo_library")}
          {tabButton("uploaded", pt(language, "refUploaded"), "history")}

          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const refUrl = e.dataTransfer.getData(REF_DND_TYPE);
              if (refUrl) {
                onDropRefUrl(refUrl);
                return;
              }
              onFiles(e.dataTransfer.files);
            }}
            className={`mt-0.5 flex flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed px-3 py-6 text-center text-[12px] leading-snug transition ${
              dragging
                ? "border-[color:var(--accent-60)] bg-white/10 text-white"
                : "border-white/15 bg-white/[.03] text-[#93a0bd] hover:bg-white/[.07] hover:text-white"
            }`}
          >
            <span className="material-symbols-outlined text-[22px]">upload</span>
            {pt(language, "refUploadBox")}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => onFiles(e.target.files)}
            />
          </label>
        </div>

        <div className="max-h-[288px] min-h-[224px] flex-1 overflow-y-auto rounded-[14px] bg-white/[.02] p-1.5">
          {loading ? (
            <div className="grid grid-cols-4 gap-1.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="aspect-square animate-pulse rounded-[10px] bg-white/5" />
              ))}
            </div>
          ) : failed ? (
            <p className="flex h-full items-center justify-center px-4 text-center text-[12px] text-[#606d8a]">
              {pt(language, "refLoadFailed")}
            </p>
          ) : visible.length === 0 ? (
            <p className="flex h-full items-center justify-center px-4 text-center text-[12px] text-[#606d8a]">
              {pt(language, tab === "gallery" ? "refEmptyGallery" : "refEmptyUploads")}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-1.5">
                {visible.map((item) => {
                  const busy = busyUrl === item.url;
                  const key = "file_id" in item ? item.file_id : item.id;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={room <= 0 || !!busyUrl}
                      onClick={() => pick(item)}
                      className="group relative aspect-square overflow-hidden rounded-[10px] ring-1 ring-white/10 transition hover:ring-[color:var(--accent-60)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <AuthenticatedImage src={item.url} alt="" className="h-full w-full object-cover" />
                      {busy && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/60">
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {(items?.length ?? 0) > shown && (
                <button
                  type="button"
                  onClick={() => setShown((n) => n + PAGE)}
                  className="mx-auto mt-2 block rounded-full border border-white/10 px-3 py-1 text-[11px] text-[#93a0bd] transition hover:bg-white/5 hover:text-white"
                >
                  {pt(language, "refShowMore")}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
