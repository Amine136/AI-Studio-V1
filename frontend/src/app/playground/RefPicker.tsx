"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AuthenticatedImage from "../../components/AuthenticatedImage";
import { type RecentUpload } from "../../lib/recentUploads";
import {
  useRefPickerData,
  REF_PICKER_PAGE,
  type RefTab,
  type RefGalleryItem,
} from "../../lib/useRefPickerData";

const PANEL_WIDTH = 560;
const PANEL_MAX_HEIGHT = 360;

/**
 * The Packs reference picker, ported to the Playground composer. A "+" trigger
 * opens a Gallery / Uploaded / Upload-drop panel; picking a tile attaches it as
 * an input image.
 *
 * Positioning follows ModelPickerPopover: a portal to <body> so the composer's
 * overflow/transform ancestors can't clip it, opening upward (the composer sits
 * at the bottom of the viewport) and clamped to the viewport on both axes.
 */
export default function RefPicker({
  disabled = false,
  uid,
  room,
  busyUrl,
  onPickGallery,
  onPickUpload,
  onFiles,
  isRtl = false,
  t,
}: {
  disabled?: boolean;
  /** Scopes the locally-tracked upload history to the signed-in user. */
  uid: string | null;
  /** Attachment slots still free. The picker closes itself once they run out. */
  room: number;
  /** URL of the tile currently being converted into an attachment, if any. */
  busyUrl: string | null;
  onPickGallery: (url: string) => void;
  onPickUpload: (item: RecentUpload) => void;
  onFiles: (files: FileList | File[] | null) => void;
  isRtl?: boolean;
  t: (key: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const place = () => {
      const b = btnRef.current?.getBoundingClientRect();
      if (!b) return;
      const margin = 8;
      const width = Math.min(PANEL_WIDTH, window.innerWidth - 2 * margin);
      const left = Math.min(
        Math.max(margin, isRtl ? b.right - width : b.left),
        window.innerWidth - width - margin,
      );
      // Open upward — the composer lives at the bottom of the screen.
      const height = Math.min(PANEL_MAX_HEIGHT, window.innerHeight - 2 * margin);
      let top = b.top - height - 8;
      if (top < margin) top = Math.min(b.bottom + 8, window.innerHeight - height - margin);
      setPos({ top, left, width });
    };
    place();

    const onDown = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, isRtl]);

  // Gallery/uploads fetching + per-tab paging (shared with the Packs picker).
  const { tab, setTab, shown, setShown, items, loading, visible, failed } =
    useRefPickerData({ open, uid });

  // Close once every slot is full, so the picker doesn't linger uselessly.
  useEffect(() => {
    if (open && room <= 0) setOpen(false);
  }, [open, room]);

  const pick = useCallback(
    (item: RefGalleryItem | RecentUpload) => {
      if (room <= 0 || busyUrl) return;
      if (tab === "gallery") onPickGallery(item.url);
      else onPickUpload(item as RecentUpload);
      // Dismiss on select; the attach continues in the background (its progress
      // shows on the composer's attachment strip).
      setOpen(false);
    },
    [room, busyUrl, tab, onPickGallery, onPickUpload],
  );

  const tabButton = (id: RefTab, label: string, icon: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`flex items-center gap-2 rounded-[12px] px-3 py-2.5 text-[13px] transition ${
        tab === id ? "bg-white/10 text-white light:text-slate-900" : "text-[#93a0bd] hover:bg-white/5 hover:text-white"
      }`}
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
      {label}
    </button>
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={t("Add image")}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`chat-attach-btn ${open ? "!text-[#adc6ff] !bg-white/[0.06]" : ""}`}
      >
        <span className="material-symbols-outlined text-[17px]">add_photo_alternate</span>
      </button>

      {open && pos && typeof document !== "undefined"
        ? createPortal(
          <div
            ref={popRef}
            dir={isRtl ? "rtl" : "ltr"}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
            className="z-[9999] rounded-2xl border border-white/10 bg-[#0d1320]/95 p-2 shadow-[0_24px_60px_-12px_rgba(0,0,0,.8)] backdrop-blur-xl"
          >
            <div className="flex gap-2">
              <div className="flex w-[168px] shrink-0 flex-col gap-1.5">
                {tabButton("gallery", t("Gallery"), "photo_library")}
                {tabButton("uploaded", t("Uploaded"), "history")}

                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    onFiles(e.dataTransfer.files);
                    setOpen(false);
                  }}
                  className={`mt-0.5 flex flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed px-3 py-6 text-center text-[12px] leading-snug transition ${
                    dragging
                      ? "border-[#adc6ff]/60 bg-white/10 text-white light:text-slate-900"
                      : "border-white/15 bg-white/[.03] text-[#93a0bd] hover:bg-white/[.07] hover:text-white"
                  }`}
                >
                  <span className="material-symbols-outlined text-[22px]">upload</span>
                  {t("Upload or drop images")}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      onFiles(e.target.files);
                      setOpen(false);
                    }}
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
                    {t("Couldn't load images.")}
                  </p>
                ) : visible.length === 0 ? (
                  <p className="flex h-full items-center justify-center px-4 text-center text-[12px] text-[#606d8a]">
                    {tab === "gallery" ? t("Nothing generated yet.") : t("No uploads yet.")}
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
                            className="group relative aspect-square overflow-hidden rounded-[10px] ring-1 ring-white/10 transition hover:ring-[#adc6ff]/60 disabled:cursor-not-allowed disabled:opacity-50"
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
                        onClick={() => setShown((n) => n + REF_PICKER_PAGE)}
                        className="mx-auto mt-2 block rounded-full border border-white/10 px-3 py-1 text-[11px] text-[#93a0bd] transition hover:bg-white/5 hover:text-white"
                      >
                        {t("Show more")}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )
        : null}
    </>
  );
}
