"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AuthenticatedImage, { fetchAuthenticatedAsset } from "../../../../components/AuthenticatedImage";
import { api, isContentBlockedError } from "../../../../services/api";
import { useAuth } from "../../../../context/AuthContext";
import { useLanguage } from "../../../../context/LanguageContext";
import type { InputImagePayload, PackDetail, PackSlot } from "../../../../types";
import { addHistoryEntry } from "../../../../lib/history";
import { capabilityLabel, fmtNum, pt } from "../../packsShared";

const LARGE_SPEND_CREDITS = 50;

type RowStatus = "idle" | "running" | "success" | "blocked" | "error";

interface Row {
  id: string;
  label: string;                    // filename (image mode) or text value (list mode)
  image?: InputImagePayload;        // image mode
  value?: string;                   // list mode (primary slot value)
  valid: boolean;
  error?: string;                   // upload/validation error (image mode)
  status: RowStatus;
  resultImage?: string | null;
}

let rowSeq = 0;
const nextId = () => `r${++rowSeq}`;

export default function PackBatchPage() {
  const params = useParams();
  const packId = String(params?.id ?? "");
  const { user } = useAuth();
  const { language } = useLanguage();

  const [pack, setPack] = useState<PackDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);

  const [sharedValues, setSharedValues] = useState<Record<string, string>>({});
  const [aspect, setAspect] = useState("");
  const [unit, setUnit] = useState(0);

  // image mode: accumulated rows; list mode: a textarea snapshotted on run.
  const [rows, setRows] = useState<Row[]>([]);
  const [listText, setListText] = useState("");

  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    api
      .getPack(packId, language)
      .then((p) => {
        setPack(p);
        setAspect(p.aspect_ratios[0] ?? "");
      })
      .catch((e) => setLoadError(e?.message ?? "Failed to load pack"));
  }, [packId, language]);

  const refreshCredits = useCallback(() => {
    api.getProfile().then((p) => setCredits(p.credits ?? 0)).catch(() => setCredits(null));
  }, []);
  useEffect(() => refreshCredits(), [refreshCredits]);

  const imageMode = Boolean(pack?.requires_image_input);

  // The slot whose value varies per row in list mode (first required text slot,
  // else first text slot). Shared settings render every other slot.
  const primarySlot: PackSlot | null = useMemo(() => {
    if (!pack || imageMode) return null;
    const texts = pack.slots.filter((s) => s.type === "text");
    return texts.find((s) => s.required) ?? texts[0] ?? null;
  }, [pack, imageMode]);

  const sharedSlots = useMemo(
    () => (pack ? pack.slots.filter((s) => s.type !== "image_ref" && s.key !== primarySlot?.key) : []),
    [pack, primarySlot],
  );

  // list-mode pending rows derived live from the textarea (image-mode uses `rows`).
  const listLines = useMemo(
    () => listText.split("\n").map((l) => l.trim()).filter(Boolean),
    [listText],
  );

  const validCount = imageMode ? rows.filter((r) => r.valid).length : listLines.length;

  // ---- estimate (debounced; cost = validCount × unit) ----
  const estTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!pack || validCount === 0) {
      setUnit((u) => u); // keep last unit; total derives from it
      return;
    }
    if (estTimer.current) clearTimeout(estTimer.current);
    estTimer.current = setTimeout(() => {
      api
        .estimatePack(packId, { n: 1, aspect_ratio: aspect || undefined })
        .then((e) => setUnit(e.unit))
        .catch(() => undefined);
    }, 250);
    return () => {
      if (estTimer.current) clearTimeout(estTimer.current);
    };
  }, [pack, packId, aspect, validCount]);

  const total = Number((unit * validCount).toFixed(4));
  const balanceAfter = credits === null ? null : Math.max(0, Number((credits - total).toFixed(4)));
  const insufficient = credits !== null && total > credits;

  const missingShared = useMemo(
    () => sharedSlots.some((s) => s.required && !(sharedValues[s.key] ?? "").trim()),
    [sharedSlots, sharedValues],
  );

  // ---- image upload (reuses backend image-input guardrail per file) ----
  const onUpload = useCallback(async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const id = nextId();
      setRows((prev) => [...prev, { id, label: file.name, valid: false, status: "idle" }]);
      try {
        const res = await api.uploadInputImage(file);
        setRows((prev) =>
          prev.map((r) =>
            r.id === id
              ? { ...r, valid: true, image: { file_id: res.id, name: res.name, mime_type: res.mime_type, url: res.url } }
              : r,
          ),
        );
      } catch (e) {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, valid: false, error: e instanceof Error ? e.message : "invalid" } : r)));
      }
    }
  }, []);

  const buildBody = useCallback(
    (row: Row) => ({
      slot_values: {
        ...sharedValues,
        ...(imageMode || !primarySlot ? {} : { [primarySlot.key]: row.value ?? "" }),
      },
      n: 1,
      aspect_ratio: aspect || undefined,
      image_refs: imageMode && row.image ? [row.image] : undefined,
    }),
    [sharedValues, imageMode, primarySlot, aspect],
  );

  // ---- run one row through the existing per-item generate endpoint ----
  const runRow = useCallback(
    async (row: Row) => {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: "running" } : r)));
      try {
        const res = await api.generatePack(packId, buildBody(row));
        const tile = res.tiles[0];
        if (res.summary.current_balance !== null) setCredits(res.summary.current_balance);
        window.dispatchEvent(new Event("studio-credits-refresh"));
        setRows((prev) =>
          prev.map((r) =>
            r.id === row.id
              ? {
                  ...r,
                  status: tile?.status === "success" ? "success" : tile?.status === "blocked" ? "blocked" : "error",
                  resultImage: tile?.image ?? null,
                }
              : r,
          ),
        );
        if (tile?.status === "success" && tile.image && user) {
          void addHistoryEntry(user.uid, { imageUrl: tile.image, prompt: row.label, model: "" });
        }
      } catch (e) {
        // Suspension is handled globally by the axios interceptor (ejects user).
        setRows((prev) =>
          prev.map((r) =>
            r.id === row.id
              ? { ...r, status: "error", error: isContentBlockedError(e) ? pt(language, "blocked") : e instanceof Error ? e.message : "error" }
              : r,
          ),
        );
      }
    },
    [packId, buildBody, language, user],
  );

  // ---- run the whole batch sequentially (results stream in; pacing keeps us
  // under the quick-generate burst limit; failures stay isolated per item) ----
  const runBatch = useCallback(async () => {
    if (!pack) return;
    if (missingShared) {
      setToast(pt(language, "fillRequired"));
      return;
    }
    let work: Row[];
    if (imageMode) {
      work = rows.filter((r) => r.valid);
    } else {
      work = listLines.map((value) => ({ id: nextId(), label: value, value, valid: true, status: "idle" as RowStatus }));
      setRows(work);
    }
    if (work.length === 0) {
      setToast(pt(language, "batchEmpty"));
      return;
    }
    setRunning(true);
    setToast(null);
    for (const row of work) {
      // re-read the row from state isn't necessary; runRow targets by id
      // eslint-disable-next-line no-await-in-loop
      await runRow(row);
    }
    setRunning(false);
    refreshCredits();
  }, [pack, missingShared, imageMode, rows, listLines, runRow, refreshCredits, language]);

  const onGenerateClick = useCallback(() => {
    if (total > LARGE_SPEND_CREDITS) {
      setConfirmOpen(true);
      return;
    }
    void runBatch();
  }, [total, runBatch]);

  const download = useCallback(
    async (src: string | null, name: string) => {
      if (!src) return;
      try {
        const blob = await fetchAuthenticatedAsset(user, src);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch {
        setToast("Download failed");
      }
    },
    [user],
  );

  if (loadError) {
    return (
      <div className="p-8">
        <Link href="/packs" className="text-sm text-[#9fb0d6] hover:text-white">‹ {pt(language, "back")}</Link>
        <p className="mt-6 text-sm text-rose-300">{loadError}</p>
      </div>
    );
  }
  if (!pack) return <div className="p-8 text-sm text-[#9fb0d6]">{pt(language, "loading")}</div>;

  const doneCount = rows.filter((r) => r.status === "success").length;
  const anyResult = rows.some((r) => r.status !== "idle");

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/packs/${packId}`} className="text-[#9fb0d6] hover:text-white">‹ {pack.title}</Link>
          <span className="text-[#42506f]">/</span>
          <span className="font-semibold text-white">{pt(language, "applyToMany")}</span>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-[#e7b53c]/15 px-3 py-1 text-xs font-semibold text-[#e7b53c]">
          {capabilityLabel(language, pack.capability)}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* left: inputs + cost */}
        <div className="flex flex-col gap-5 lg:col-span-1">
          {imageMode ? (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#cdd6f4]">{pt(language, "batchUpload")}</label>
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-white/15 bg-[#101728] p-3">
                {rows.map((r) => (
                  <div
                    key={r.id}
                    className={`relative h-14 w-14 overflow-hidden rounded-lg border ${r.valid ? "border-white/10" : "border-rose-500/60"}`}
                    title={r.error ?? r.label}
                  >
                    {r.image ? (
                      <AuthenticatedImage src={r.image.url} alt={r.label} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-rose-300">
                        {r.error ? "✗" : "…"}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setRows((prev) => prev.filter((x) => x.id !== r.id))}
                      className="absolute end-0 top-0 flex h-4 w-4 items-center justify-center bg-black/60 text-[10px] text-white"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <label className="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-[#aebbe0] hover:bg-white/5">
                  <span className="material-symbols-outlined text-base">add_photo_alternate</span>
                  {pt(language, "addMore")}
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => void onUpload(e.target.files)} />
                </label>
              </div>
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#cdd6f4]">
                {primarySlot ? primarySlot.label : pt(language, "batchList")} · {pt(language, "batchList")}
              </label>
              <textarea
                value={listText}
                onChange={(e) => setListText(e.target.value)}
                rows={6}
                placeholder={pt(language, "batchListPlaceholder")}
                className="w-full rounded-xl border border-white/10 bg-[#101728] px-3 py-2.5 text-sm text-white placeholder:text-[#5e6c8f] focus:border-[#e7b53c]/60 focus:outline-none"
              />
            </div>
          )}

          {/* shared settings */}
          {sharedSlots.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-[#101728] p-3">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#7e8db5]">{pt(language, "sharedSettings")}</p>
              <div className="flex flex-col gap-3">
                {sharedSlots.map((s) => (
                  <div key={s.key}>
                    <label className="mb-1 block text-sm text-[#cdd6f4]">
                      {s.label}
                      {s.required && <span className="ms-1 text-[11px] text-[#e7b53c]">· {pt(language, "required")}</span>}
                    </label>
                    {s.type === "select" ? (
                      <select
                        value={sharedValues[s.key] ?? ""}
                        onChange={(e) => setSharedValues((p) => ({ ...p, [s.key]: e.target.value }))}
                        className="w-full rounded-lg border border-white/10 bg-[#0e1525] px-3 py-2 text-sm text-white focus:border-[#e7b53c]/60 focus:outline-none"
                      >
                        <option value="">—</option>
                        {(s.options ?? []).map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={sharedValues[s.key] ?? ""}
                        onChange={(e) => setSharedValues((p) => ({ ...p, [s.key]: e.target.value }))}
                        placeholder={s.placeholder ?? ""}
                        className="w-full rounded-lg border border-white/10 bg-[#0e1525] px-3 py-2 text-sm text-white placeholder:text-[#5e6c8f] focus:border-[#e7b53c]/60 focus:outline-none"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[#101728] px-3 py-2">
            <span className="text-sm text-[#cdd6f4]">{pt(language, "aspectRatio")}</span>
            <select
              value={aspect}
              onChange={(e) => setAspect(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#0e1525] px-3 py-1.5 text-sm text-white focus:border-[#e7b53c]/60 focus:outline-none"
            >
              {pack.aspect_ratios.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <span className="text-xs text-[#7e8db5]">{pt(language, "oneEach")}</span>
          </div>

          {/* cost card */}
          <div className="rounded-2xl border border-[#e7b53c]/30 bg-[#13192a] p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-[#7e8db5]">
                  {fmtNum(language, validCount)} {pt(language, "validCount")} × {fmtNum(language, unit)} {pt(language, "credits")}
                </p>
                {balanceAfter !== null && (
                  <p className="text-xs text-[#7e8db5]">
                    {pt(language, "balanceAfter")} {fmtNum(language, balanceAfter)}
                    {balanceAfter <= 5 && total > 0 && <span className="ms-1 text-amber-400">⚠ {pt(language, "lowBalance")}</span>}
                  </p>
                )}
              </div>
              <p className="text-3xl font-extrabold text-[#e7b53c]">{fmtNum(language, total)}</p>
            </div>
            <button
              type="button"
              disabled={running || insufficient || validCount === 0}
              onClick={onGenerateClick}
              className="mt-4 w-full rounded-xl bg-[#e7b53c] py-3 text-sm font-bold text-[#231a00] transition hover:bg-[#f0c45a] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {insufficient
                ? pt(language, "notEnough")
                : `${pt(language, "generateCount").replace("{n}", fmtNum(language, validCount))} →`}
            </button>
            <p className="mt-2 text-[11px] text-[#7e8db5]">{pt(language, "excludedNote")}</p>
          </div>
        </div>

        {/* right: results grid (streams in) */}
        <div className="lg:col-span-2">
          {!anyResult ? (
            <div className="flex h-full min-h-48 items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-[#7e8db5]">
              {pt(language, "batchEmpty")}
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm text-[#9fb0d6]">
                  {pt(language, "batchDone").replace("{ok}", fmtNum(language, doneCount)).replace("{total}", fmtNum(language, rows.length))}
                </p>
                <button
                  type="button"
                  onClick={() => rows.filter((r) => r.status === "success" && r.resultImage).forEach((r, i) => download(r.resultImage ?? null, `${pack.id}-${i + 1}.png`))}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-[#aebbe0] hover:bg-white/5"
                >
                  <span className="material-symbols-outlined text-base">download</span>
                  {pt(language, "downloadAll")}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {rows.map((r) => (
                  <div key={r.id} className="overflow-hidden rounded-xl border border-white/10 bg-[#141b2d]">
                    <div className="relative aspect-square w-full bg-[#0e1525]">
                      {r.status === "running" || r.status === "idle" ? (
                        <div className="flex h-full w-full items-center justify-center">
                          <div className="h-16 w-14 animate-pulse rounded bg-white/10" />
                        </div>
                      ) : r.status === "success" && r.resultImage ? (
                        <AuthenticatedImage src={r.resultImage} alt={r.label} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-2 text-center">
                          <span className="text-xs text-[#8a96b8]">
                            {r.status === "blocked" ? pt(language, "tileFailed") : (r.error ?? pt(language, "tileFailed"))}
                          </span>
                          <button
                            type="button"
                            onClick={() => void runRow(r)}
                            className="rounded border border-white/15 px-2 py-1 text-[11px] text-[#aebbe0] hover:bg-white/5"
                          >
                            {pt(language, "itemRetry")}
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-1 p-2">
                      <span className="truncate text-[11px] text-[#7e8db5]" title={r.label}>{r.label}</span>
                      {r.status === "success" && r.resultImage && (
                        <button
                          type="button"
                          onClick={() => download(r.resultImage ?? null, `${pack.id}-${r.id}.png`)}
                          className="material-symbols-outlined text-[16px] text-[#e7b53c]/80 hover:text-[#e7b53c]"
                          title={pt(language, "download")}
                        >
                          download
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 start-1/2 z-50 -translate-x-1/2 rounded-xl border border-white/10 bg-[#1a2238] px-4 py-2.5 text-sm text-white shadow-xl">
          {toast}
        </div>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#141b2d] p-5">
            <p className="text-base font-semibold text-white">
              {pt(language, "confirmTitle").replace("{n}", fmtNum(language, validCount))}
            </p>
            <p className="mt-1 text-sm text-[#9fb0d6]">
              {pt(language, "confirmBody").replace("{total}", fmtNum(language, total)).replace("{after}", balanceAfter === null ? "—" : fmtNum(language, balanceAfter))}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmOpen(false)} className="rounded-lg px-4 py-2 text-sm text-[#aebbe0] hover:bg-white/5">
                {pt(language, "cancel")}
              </button>
              <button
                type="button"
                onClick={() => { setConfirmOpen(false); void runBatch(); }}
                className="rounded-lg bg-[#e7b53c] px-4 py-2 text-sm font-bold text-[#231a00] hover:bg-[#f0c45a]"
              >
                {pt(language, "confirm")} →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
