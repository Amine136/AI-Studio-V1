import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { listRecentUploads, type RecentUpload } from "./recentUploads";

export type RefTab = "gallery" | "uploaded";
export type RefGalleryItem = { id: string; url: string };

// Each tile does a full authenticated image fetch (there are no thumbnails), so
// the grid reveals a page at a time instead of firing one request per row the
// user may never scroll to. Mirrors the /gallery page's own budget.
export const REF_PICKER_PAGE = 12;

/**
 * Shared data layer for the two reference pickers (Packs studio + Playground
 * composer). Owns gallery/uploads fetching, per-tab paging, and the derived
 * list state — the slice that is byte-identical in both.
 *
 * The pickers deliberately keep their own, genuinely different, presentation:
 * Packs is a controlled inline overlay with per-pack i18n and internal
 * result-drag; Playground is a self-triggered portal popover with viewport
 * positioning. Only this data slice is shared, so it can't silently drift.
 */
export function useRefPickerData({ open, uid }: { open: boolean; uid: string | null }) {
  const [tab, setTab] = useState<RefTab>("gallery");
  const [gallery, setGallery] = useState<RefGalleryItem[] | null>(null);
  const [uploads, setUploads] = useState<RecentUpload[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(REF_PICKER_PAGE);

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
    setShown(REF_PICKER_PAGE);
  }, [tab]);

  // Re-read the (localStorage) upload history every time the picker opens so a
  // file added while it was closed still shows up. Costs nothing.
  useEffect(() => {
    if (open) setUploads(null);
  }, [open]);

  const items = tab === "gallery" ? gallery : uploads;
  const loading = items === null && !failed;
  const visible = useMemo(() => (items ?? []).slice(0, shown), [items, shown]);

  return { tab, setTab, shown, setShown, items, loading, visible, failed };
}
