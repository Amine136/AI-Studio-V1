"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import type { PlainChatConversationItem } from "../../types";
import { getProfile } from "../../lib/credits";
import { getHistory, type HistoryEntry } from "../../lib/history";

function isRenderableImageUrl(value?: string): boolean {
  if (!value) return false;
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/");
}

function formatHistoryDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export default function StudioHomePage() {
  const { user } = useAuth();
  const [credits, setCredits] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [conversations, setConversations] = useState<PlainChatConversationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const uid = user.uid;

    let cancelled = false;

    async function loadStudioHome() {
      try {
        const [profile, entries, conversationResponse] = await Promise.all([
          getProfile(),
          getHistory(uid, 8),
          api.getPlainChatConversations(6),
        ]);

        if (!cancelled) {
          setCredits(profile.credits ?? 0);
          setHistory(entries);
          setConversations(conversationResponse.conversations ?? []);
        }
      } catch {
        if (!cancelled) {
          setCredits(null);
          setHistory([]);
          setConversations([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadStudioHome();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const featuredEntry = history[0] ?? null;
  const recentEntries = useMemo(() => history.slice(0, 6), [history]);
  const recentConversations = useMemo(() => conversations.slice(0, 4), [conversations]);
  const imageCount = useMemo(() => history.filter((entry) => isRenderableImageUrl(entry.imageUrl)).length, [history]);
  const captionCount = useMemo(() => history.filter((entry) => Boolean(entry.caption?.trim())).length, [history]);

  return (
    <section className="min-h-[calc(100vh-4rem)] px-6 py-8 lg:px-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-white/8 bg-[linear-gradient(135deg,rgba(21,27,45,0.96),rgba(12,19,36,0.94))] p-8 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#adc6ff]/20 bg-[#adc6ff]/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[#adc6ff]">
              Studio Home
            </div>
            <h1 className="font-headline text-4xl font-bold tracking-tight text-white lg:text-5xl">
              Start a new project when you are ready.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[#c2c6d6] lg:text-lg">
              Your studio now starts from a cleaner home. Review your latest outputs, check your balance,
              and launch the next project only when you need it.
            </p>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
              <Link
                href="/studio/start"
                className="inline-flex items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-[#adc6ff] to-[#4d8eff] px-8 py-4 font-headline text-base font-bold text-[#00285d] shadow-[0_20px_40px_-20px_rgba(77,142,255,0.5)] transition-all hover:brightness-110"
              >
                <span className="material-symbols-outlined text-xl">add_circle</span>
                Start Project
              </Link>
              <Link
                href="/gallery"
                className="inline-flex items-center justify-center gap-3 rounded-xl border border-white/10 bg-[#191f31] px-8 py-4 text-base font-semibold text-white transition-colors hover:bg-[#23293c]"
              >
                <span className="material-symbols-outlined text-xl">photo_library</span>
                Open Gallery
              </Link>
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-2xl border border-white/8 bg-[#151b2d] p-6">
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#adc6ff]">Current Credits</div>
              <div className="mt-4 font-headline text-5xl font-bold text-white">
                {credits === null ? "..." : credits.toFixed(2)}
              </div>
              <p className="mt-2 text-sm text-[#c2c6d6]">Available for new projects and generation runs.</p>
            </div>

            <div className="rounded-2xl border border-white/8 bg-[#151b2d] p-6">
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#adc6ff]">Usage Snapshot</div>
              <div className="mt-5 grid grid-cols-2 gap-4">
                <div className="rounded-xl bg-[#191f31] p-4">
                  <div className="text-3xl font-bold text-white">{history.length + conversations.length}</div>
                  <div className="mt-1 text-xs uppercase tracking-widest text-[#c2c6d6]">Recent Items</div>
                </div>
                <div className="rounded-xl bg-[#191f31] p-4">
                  <div className="text-3xl font-bold text-white">{imageCount}</div>
                  <div className="mt-1 text-xs uppercase tracking-widest text-[#c2c6d6]">Images</div>
                </div>
                <div className="rounded-xl bg-[#191f31] p-4">
                  <div className="text-3xl font-bold text-white">{captionCount}</div>
                  <div className="mt-1 text-xs uppercase tracking-widest text-[#c2c6d6]">Captions</div>
                </div>
                <div className="rounded-xl bg-[#191f31] p-4">
                  <div className="text-3xl font-bold text-white">{featuredEntry ? "Live" : "-"}</div>
                  <div className="mt-1 text-xs uppercase tracking-widest text-[#c2c6d6]">Studio State</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#151b2d]">
            <div className="border-b border-white/8 px-6 py-5">
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#adc6ff]">Latest Output</div>
              <h2 className="mt-2 font-headline text-2xl font-bold text-white">Most recent creation</h2>
            </div>

            {featuredEntry ? (
              <div className="p-6">
                {isRenderableImageUrl(featuredEntry.imageUrl) ? (
                  <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#070d1f]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={featuredEntry.imageUrl} alt={featuredEntry.prompt} className="h-80 w-full object-cover" />
                  </div>
                ) : (
                  <div className="flex h-80 items-center justify-center rounded-2xl border border-white/8 bg-[#070d1f] text-center">
                    <div>
                      <span className="material-symbols-outlined text-5xl text-[#adc6ff]">notes</span>
                      <p className="mt-4 font-headline text-2xl font-bold text-white">Caption result</p>
                    </div>
                  </div>
                )}

                <div className="mt-5 space-y-3">
                  <div className="text-sm text-[#c2c6d6]">{formatHistoryDate(featuredEntry.createdAt)}</div>
                  <h3 className="font-headline text-2xl font-bold text-white">{featuredEntry.prompt}</h3>
                  {featuredEntry.caption ? (
                    <p className="text-sm leading-7 text-[#c2c6d6]">{featuredEntry.caption}</p>
                  ) : (
                    <p className="text-sm leading-7 text-[#8c909f]">No caption saved for this result.</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-6">
                <div className="flex h-[420px] items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[#070d1f] text-center">
                  <div>
                    <span className="material-symbols-outlined text-5xl text-[#adc6ff]">auto_awesome</span>
                    <p className="mt-4 font-headline text-2xl font-bold text-white">No project yet</p>
                    <p className="mt-2 max-w-sm text-sm leading-6 text-[#c2c6d6]">
                      Start your first project and the latest result will appear here.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/8 bg-[#151b2d]">
            <div className="flex items-center justify-between border-b border-white/8 px-6 py-5">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#adc6ff]">Recent Usage</div>
                <h2 className="mt-2 font-headline text-2xl font-bold text-white">History</h2>
              </div>
              <Link href="/gallery" className="text-sm font-semibold text-[#adc6ff] transition-colors hover:text-white">
                View all
              </Link>
            </div>

            <div className="divide-y divide-white/6">
              {!loading && recentConversations.length > 0 ? (
                recentConversations.map((conversation) => (
                  <Link
                    key={conversation.id}
                    href={`/studio/chat?conversation=${encodeURIComponent(conversation.id)}`}
                    className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-white/[0.03]"
                  >
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#adc6ff]/15 bg-[#adc6ff]/10">
                      <span className="material-symbols-outlined text-2xl text-[#adc6ff]">chat</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-headline text-lg font-bold text-white">Continue chat</div>
                      <div className="mt-1 truncate text-sm text-[#c2c6d6]">{conversation.model || "Chat model"}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <div className="text-xs uppercase tracking-widest text-[#8c909f]">
                        {formatHistoryDate(new Date((conversation.lastMessageAt || conversation.updatedAt) * 1000))}
                      </div>
                      <span className="material-symbols-outlined text-[#adc6ff]">arrow_forward</span>
                    </div>
                  </Link>
                ))
              ) : null}

              {loading ? (
                <div className="px-6 py-10 text-sm text-[#8c909f]">Loading recent history…</div>
              ) : recentEntries.length === 0 && recentConversations.length === 0 ? (
                <div className="px-6 py-10 text-sm text-[#8c909f]">No recent studio activity yet.</div>
              ) : (
                recentEntries.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-4 px-6 py-4">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/8 bg-[#070d1f]">
                      {isRenderableImageUrl(entry.imageUrl) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={entry.imageUrl} alt={entry.prompt} className="h-full w-full object-cover" />
                      ) : (
                        <span className="material-symbols-outlined text-2xl text-[#adc6ff]">notes</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-headline text-lg font-bold text-white">{entry.prompt}</div>
                      <div className="mt-1 truncate text-sm text-[#c2c6d6]">{entry.model || "Studio model"}</div>
                    </div>
                    <div className="text-xs uppercase tracking-widest text-[#8c909f]">{formatHistoryDate(entry.createdAt)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
