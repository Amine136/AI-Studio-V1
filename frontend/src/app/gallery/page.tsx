"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { getHistory, type HistoryEntry } from "../../lib/history";

type GalleryFilter = "all" | "images" | "captions";

function isRenderableImageUrl(value?: string): boolean {
  if (!value) return false;
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/");
}

function hasCaption(value?: string) {
  return Boolean(value && value.trim().length);
}

function formatDate(value: Date) {
  return value.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function formatTime(value: Date) {
  return value.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const filterTabs: { id: GalleryFilter; label: string }[] = [
  { id: "all", label: "All Work" },
  { id: "images", label: "Images" },
  { id: "captions", label: "Captions" },
];

export default function GalleryPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [filter, setFilter] = useState<GalleryFilter>("all");
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/auth");
    }
  }, [authLoading, router, user]);

  const fetchHistory = useCallback(async () => {
    if (!user) return;
    setHistoryLoading(true);
    try {
      const entries = await getHistory(user.uid, 100);
      setHistory(entries);
    } finally {
      setHistoryLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void fetchHistory();
  }, [fetchHistory, user]);

  const filteredEntries = useMemo(() => {
    if (filter === "images") return history.filter((entry) => isRenderableImageUrl(entry.imageUrl));
    if (filter === "captions") return history.filter((entry) => hasCaption(entry.caption));
    return history;
  }, [filter, history]);

  const featuredEntry = filteredEntries[0] ?? null;
  const gridEntries = featuredEntry ? filteredEntries.slice(1) : [];
  const imageCount = history.filter((entry) => isRenderableImageUrl(entry.imageUrl)).length;
  const captionCount = history.filter((entry) => hasCaption(entry.caption)).length;

  if (authLoading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="auth-loader" />
      </main>
    );
  }

  return (
    <div className="space-y-12">
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-md bg-[#151b2d] p-8">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#8c909f]">Visual Archive</p>
          <h1 className="mt-3 font-headline text-5xl font-bold tracking-tight text-[#dce1fb] sm:text-6xl">
            Gallery
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-8 text-[#c2c6d6]">
            Review your saved generations, inspect prompts, and revisit the captions and images already created inside
            Vibecraft.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            {filterTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`rounded-sm px-4 py-2 text-sm font-medium transition-colors ${
                  filter === tab.id
                    ? "bg-[#adc6ff] text-[#002e6a]"
                    : "border border-white/10 bg-[#070d1f] text-[#c2c6d6] hover:border-[#adc6ff]/30 hover:text-[#dce1fb]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
          <div className="rounded-md bg-[#151b2d] p-5">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#8c909f]">Saved Entries</p>
            <div className="mt-3 text-4xl font-bold tracking-tight text-[#dce1fb]">{history.length}</div>
            <p className="mt-2 text-sm text-[#c2c6d6]">All saved generations on this account.</p>
          </div>
          <div className="rounded-md bg-[#151b2d] p-5">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#8c909f]">Image Outputs</p>
            <div className="mt-3 text-4xl font-bold tracking-tight text-[#dce1fb]">{imageCount}</div>
            <p className="mt-2 text-sm text-[#c2c6d6]">Renderable visual results currently stored.</p>
          </div>
          <div className="rounded-md bg-[#151b2d] p-5">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#8c909f]">Caption Results</p>
            <div className="mt-3 text-4xl font-bold tracking-tight text-[#dce1fb]">{captionCount}</div>
            <p className="mt-2 text-sm text-[#c2c6d6]">Text outputs available for reuse and campaigns.</p>
          </div>
        </div>
      </section>

      {historyLoading ? (
        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr_0.85fr]">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-[320px] animate-pulse rounded-md bg-[#151b2d]" />
          ))}
        </div>
      ) : filteredEntries.length === 0 ? (
        <section className="rounded-md bg-[#151b2d] p-10">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#8c909f]">No Saved Items</p>
          <h2 className="mt-3 font-headline text-3xl font-bold tracking-tight text-[#dce1fb]">This gallery is still empty.</h2>
          <p className="mt-4 max-w-xl text-base leading-8 text-[#c2c6d6]">
            Generate something in the studio first. Once a result is saved, it will appear here automatically.
          </p>
          <Link
            href="/studio"
            className="mt-8 inline-flex rounded-sm bg-[linear-gradient(90deg,#adc6ff,#4d8eff)] px-6 py-3 text-sm font-bold text-[#002e6a]"
          >
            Open Studio
          </Link>
        </section>
      ) : (
        <>
          {featuredEntry && (
            <button
              type="button"
              onClick={() => setSelectedEntry(featuredEntry)}
              className="grid w-full gap-0 overflow-hidden rounded-md border border-white/8 bg-[#151b2d] text-left transition-transform hover:-translate-y-1 lg:grid-cols-[1.1fr_0.9fr]"
            >
              <div className="relative min-h-[320px] overflow-hidden bg-[#070d1f]">
                {isRenderableImageUrl(featuredEntry.imageUrl) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={featuredEntry.imageUrl} alt={featuredEntry.prompt} className="h-full w-full object-cover transition-transform duration-700 hover:scale-105" />
                ) : (
                  <div className="flex h-full min-h-[320px] items-center justify-center text-white/20">
                    <span className="material-symbols-outlined text-[88px]">description</span>
                  </div>
                )}
                <div className="absolute left-5 top-5 rounded-sm bg-[#0c1324]/80 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-[#adc6ff]">
                  Featured
                </div>
              </div>

              <div className="flex flex-col justify-between p-8">
                <div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-sm bg-[#2e3447] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-[#b9c8de]">
                      {featuredEntry.model || "Unknown model"}
                    </span>
                    <span className="rounded-sm bg-[#2e3447] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-[#b9c8de]">
                      {formatDate(featuredEntry.createdAt)}
                    </span>
                  </div>

                  <h2 className="mt-5 font-headline text-3xl font-bold tracking-tight text-[#dce1fb]">Latest saved generation</h2>
                  <p className="mt-4 text-base leading-8 text-[#dce1fb]">{featuredEntry.prompt}</p>

                  {hasCaption(featuredEntry.caption) ? (
                    <p className="mt-4 line-clamp-4 text-sm leading-7 text-[#c2c6d6]">{featuredEntry.caption}</p>
                  ) : null}
                </div>

                <div className="mt-8 flex items-center justify-between gap-4 border-t border-white/8 pt-5">
                  <div className="text-sm text-[#c2c6d6]">Saved at {formatTime(featuredEntry.createdAt)}</div>
                  <div className="inline-flex items-center gap-2 text-sm font-medium text-[#adc6ff]">
                    Open details
                    <span className="material-symbols-outlined text-[18px]">arrow_outward</span>
                  </div>
                </div>
              </div>
            </button>
          )}

          <section className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {gridEntries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSelectedEntry(entry)}
                className="overflow-hidden rounded-md border border-white/8 bg-[#151b2d] text-left transition-transform hover:-translate-y-1"
              >
                <div className="relative aspect-square overflow-hidden bg-[#070d1f]">
                  {isRenderableImageUrl(entry.imageUrl) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={entry.imageUrl} alt={entry.prompt} className="h-full w-full object-cover transition-transform duration-700 hover:scale-105" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-white/20">
                      <span className="material-symbols-outlined text-[72px]">article</span>
                    </div>
                  )}
                  <div className="absolute left-4 top-4 rounded-sm bg-[#0c1324]/80 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-[#adc6ff]">
                    {entry.model || "Unknown model"}
                  </div>
                </div>

                <div className="p-5">
                  <h3 className="line-clamp-2 text-lg font-semibold text-[#dce1fb]">{entry.prompt}</h3>
                  <div className="mt-4 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.2em] text-[#8c909f]">
                    <span>{formatDate(entry.createdAt)}</span>
                    <span>{formatTime(entry.createdAt)}</span>
                  </div>
                </div>
              </button>
            ))}
          </section>
        </>
      )}

      {selectedEntry ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md" onClick={() => setSelectedEntry(null)}>
          <div
            className="w-full max-w-4xl overflow-hidden rounded-md border border-white/10 bg-[#151b2d] shadow-[0_40px_120px_rgba(0,0,0,0.55)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="grid lg:grid-cols-[1.05fr_0.95fr]">
              <div className="bg-[#070d1f]">
                {isRenderableImageUrl(selectedEntry.imageUrl) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selectedEntry.imageUrl} alt={selectedEntry.prompt} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex min-h-[320px] items-center justify-center text-white/20">
                    <span className="material-symbols-outlined text-[96px]">description</span>
                  </div>
                )}
              </div>
              <div className="p-8">
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-sm bg-[#2e3447] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-[#b9c8de]">
                    {selectedEntry.model || "Unknown model"}
                  </span>
                  <span className="rounded-sm bg-[#2e3447] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-[#b9c8de]">
                    {formatDate(selectedEntry.createdAt)}
                  </span>
                </div>

                <div className="mt-6">
                  <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#8c909f]">Prompt</div>
                  <p className="mt-3 text-base leading-8 text-[#dce1fb]">{selectedEntry.prompt}</p>
                </div>

                {hasCaption(selectedEntry.caption) ? (
                  <div className="mt-6">
                    <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#8c909f]">Caption</div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[#c2c6d6]">{selectedEntry.caption}</p>
                  </div>
                ) : null}

                <div className="mt-8 flex items-center justify-between gap-4 border-t border-white/8 pt-5">
                  <div className="text-sm text-[#c2c6d6]">Saved at {formatTime(selectedEntry.createdAt)}</div>
                  <button
                    type="button"
                    onClick={() => setSelectedEntry(null)}
                    className="rounded-sm border border-white/10 bg-[#070d1f] px-4 py-2 text-sm text-[#c2c6d6] transition hover:border-[#adc6ff]/30 hover:text-[#dce1fb]"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
