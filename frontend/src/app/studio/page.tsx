"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import type { PlainChatConversationItem, PlainChatModelItem } from "../../types";
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
  const [plainChatModels, setPlainChatModels] = useState<PlainChatModelItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const uid = user.uid;

    let cancelled = false;

    async function loadStudioHome() {
      try {
        const [profile, entries, conversationResponse, plainChatResponse] = await Promise.all([
          getProfile(),
          getHistory(uid, 8),
          api.getPlainChatConversations(20),
          api.getPlainChatModels(),
        ]);

        if (!cancelled) {
          setCredits(profile.credits ?? 0);
          setHistory(entries);
          setConversations(conversationResponse.conversations ?? []);
          setPlainChatModels(Array.isArray(plainChatResponse.models) ? plainChatResponse.models : []);
        }
      } catch {
        if (!cancelled) {
          setCredits(null);
          setHistory([]);
          setConversations([]);
          setPlainChatModels([]);
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

  const recentConversations = useMemo(() => conversations.slice(0, 20), [conversations]);
  const plainChatModelLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const model of plainChatModels) {
      if (!model?.id) continue;
      lookup.set(model.id, model.displayName || model.id);
      lookup.set(model.id.toLowerCase(), model.displayName || model.id);
    }
    return lookup;
  }, [plainChatModels]);
  const imageCount = useMemo(() => history.filter((entry) => isRenderableImageUrl(entry.imageUrl)).length, [history]);
  const captionCount = useMemo(() => history.filter((entry) => Boolean(entry.caption?.trim())).length, [history]);

  async function handleDeleteConversation(conversationId: string) {
    if (typeof window !== "undefined" && !window.confirm("Delete this conversation? This action cannot be undone.")) {
      return;
    }

    try {
      await api.deletePlainChatConversation(conversationId);
      setConversations((current) => current.filter((conversation) => conversation.id !== conversationId));
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <section className="min-h-[calc(100vh-4rem)] px-6 py-8 lg:px-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-white/8 bg-[linear-gradient(135deg,rgba(21,27,45,0.96),rgba(12,19,36,0.94))] p-8 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#adc6ff]/20 bg-[#adc6ff]/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[#adc6ff]">
              Studio Home
            </div>
            <h1 className="font-headline text-4xl font-bold tracking-tight text-white lg:text-5xl">
              Ignite Your Creative Vision
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[#c2c6d6] lg:text-lg">
              Welcome to your creative command center
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
                  <div className="text-3xl font-bold text-white">{recentConversations.length > 0 ? "Live" : "-"}</div>
                  <div className="mt-1 text-xs uppercase tracking-widest text-[#c2c6d6]">Studio State</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="rounded-2xl border border-white/8 bg-[#151b2d]">
            <div className="flex items-center justify-between border-b border-white/8 px-6 py-5">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#adc6ff]">Recent Usage</div>
                <h2 className="mt-2 font-headline text-2xl font-bold text-white">Plain Chat History</h2>
              </div>
              <Link href="/studio/chat" className="text-sm font-semibold text-[#adc6ff] transition-colors hover:text-white">
                Open chat
              </Link>
            </div>

            <div className="divide-y divide-white/6">
              {!loading && recentConversations.length > 0 ? (
                recentConversations.map((conversation) => (
                  <Link
                    key={conversation.id}
                    href={`/studio/chat?conversation=${encodeURIComponent(conversation.id)}`}
                    className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto_auto_auto] items-center gap-4 px-6 py-4 transition-colors hover:bg-white/[0.03]"
                  >
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-[#8c909f]">Name</div>
                      <div className="mt-1 truncate font-medium text-white">
                        {conversation.title || "New Chat"}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-[#8c909f]">Model used</div>
                      <div className="mt-1 truncate font-medium text-white">
                        {plainChatModelLookup.get(conversation.model) || plainChatModelLookup.get((conversation.model || "").toLowerCase()) || conversation.model || "Chat model"}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-[#8c909f]">Last change</div>
                      <div className="mt-1 truncate text-sm text-[#c2c6d6]">
                        {formatHistoryDate(new Date((conversation.lastMessageAt || conversation.updatedAt) * 1000))}
                      </div>
                    </div>
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.18em] text-[#8c909f]">Credits charged</div>
                        <div className="mt-1 font-medium text-white">
                          {(conversation.totalCostCredits || 0).toFixed(2)} Cr
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void handleDeleteConversation(conversation.id);
                        }}
                        className="rounded-md border border-[#5b2028] p-2 text-[#ffb4ab] transition-colors hover:bg-[#5b2028]/20"
                        aria-label={`Delete ${conversation.title || "conversation"}`}
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                      <span className="material-symbols-outlined text-[#adc6ff]">arrow_forward</span>
                    </div>
                  </Link>
                ))
              ) : null}

              {loading ? (
                <div className="px-6 py-10 text-sm text-[#8c909f]">Loading plain chat history…</div>
              ) : recentConversations.length === 0 ? (
                <div className="px-6 py-10 text-sm text-[#8c909f]">No recent plain chat conversations yet.</div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
