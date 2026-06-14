"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../context/LanguageContext";
import { api } from "../../services/api";
import type { PlainChatConversationItem, PlainChatModelItem } from "../../types";

// Playground History pagination. Show 10 at a time and let the user reveal more
// in batches of 10, capped at 70 for now (revisit once we settle on a final
// user-data retention / max-history policy).
const HISTORY_PAGE_SIZE = 10;
const HISTORY_MAX = 70;

function formatHistoryDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export default function StudioHomePage() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [conversations, setConversations] = useState<PlainChatConversationItem[]>([]);
  const [plainChatModels, setPlainChatModels] = useState<PlainChatModelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedConversationIds, setExpandedConversationIds] = useState<string[]>([]);
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    async function loadStudioHome() {
      try {
        const [conversationResponse, plainChatResponse] = await Promise.all([
          api.getPlainChatConversations(HISTORY_MAX),
          api.getPlainChatModels(),
        ]);

        if (!cancelled) {
          setConversations(conversationResponse.conversations ?? []);
          setPlainChatModels(Array.isArray(plainChatResponse.models) ? plainChatResponse.models : []);
        }
      } catch {
        if (!cancelled) {
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

  const cappedConversations = useMemo(() => conversations.slice(0, HISTORY_MAX), [conversations]);
  const recentConversations = useMemo(
    () => cappedConversations.slice(0, visibleCount),
    [cappedConversations, visibleCount],
  );
  const canLoadMore = !loading && visibleCount < cappedConversations.length;
  const plainChatModelLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const model of plainChatModels) {
      if (!model?.id) continue;
      lookup.set(model.id, model.displayName || model.id);
      lookup.set(model.id.toLowerCase(), model.displayName || model.id);
    }
    return lookup;
  }, [plainChatModels]);

  async function handleDeleteConversation(conversationId: string) {
    if (typeof window !== "undefined" && !window.confirm(t("Delete this conversation? This action cannot be undone."))) {
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
    <section className="min-h-[calc(100vh-4rem)] px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-[1400px] space-y-12">
        <div className="max-w-3xl">
          <h1 className="font-headline text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
            {t("Choose how you want to work.")}
          </h1>
          <p className="mt-4 text-sm leading-6 text-[#c2c6d6] sm:text-base sm:leading-7 lg:text-lg">
            {t("Pick the faster conversational path for lightweight back-and-forth, or enter the guided smart workflow for precise content creation.")}
          </p>
        </div>

        {/* Playground — the fast path */}
        <div>
          <Link
            href="/studio/chat?new=1"
            className="group flex flex-col items-start justify-between rounded-3xl border border-[#adc6ff]/30 bg-[linear-gradient(135deg,rgba(77,142,255,0.08),rgba(21,27,45,0.94))] p-6 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)] transition-all hover:-translate-y-1 hover:border-[#adc6ff]/50 sm:p-10 md:flex-row md:items-center"
          >
            <div className="flex flex-col items-start gap-6 md:flex-row md:items-center md:gap-8">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[#adc6ff] text-[#00285d] shadow-[0_0_20px_rgba(173,198,255,0.3)]">
                <span className="material-symbols-outlined text-4xl">chat</span>
              </div>
              <div>
                <h2 className="font-headline text-2xl font-bold text-white sm:text-3xl">{t("Playground")}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#c2c6d6] sm:text-base sm:leading-7">
                  {t("Best for lightweight prompting, iteration, and direct AI generation. This is the fast path for users who want to interact with individual models directly.")}
                </p>
              </div>
            </div>
            <div className="mt-8 inline-flex shrink-0 items-center gap-2 rounded-full bg-white/10 px-6 py-3 font-semibold text-white transition-all group-hover:bg-white/20 md:mt-0">
              {t("Open Playground")}
              <span className="material-symbols-outlined text-base transition-transform group-hover:translate-x-1">arrow_forward</span>
            </div>
          </Link>
        </div>

        {/* Workflows */}
        <div>
          <h2 className="font-headline text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {t("Workflows")}
          </h2>
          <p className="mt-2 text-sm text-[#8c909f]">
            {t("Guided, multi-step engines designed for specific tasks.")}
          </p>

          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {/* 1. Smart Content Creation */}
            <Link
              href="/studio/create"
              className="group flex flex-col rounded-2xl border border-[#adc6ff]/20 bg-[linear-gradient(135deg,rgba(21,27,45,0.96),rgba(12,19,36,0.94))] p-6 shadow-lg transition-all hover:-translate-y-1 hover:border-[#adc6ff]/40"
            >
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-[#2e3447] text-[#adc6ff] transition-colors group-hover:bg-[#adc6ff] group-hover:text-[#00285d]">
                <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
              </div>
              <h3 className="font-headline text-lg font-bold text-white">{t("Smart Content")}</h3>
              <p className="mt-2 flex-grow text-sm leading-6 text-[#c2c6d6]">
                {t("Review prompts, choose precise settings, and generate structured content with our guided creation workflow.")}
              </p>
              <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#adc6ff] transition-all group-hover:gap-3">
                {t("Open Workflow")}
                <span className="material-symbols-outlined text-base">arrow_forward</span>
              </div>

              <div className="mt-6 border-t border-white/10 pt-4 flex items-center gap-3">
                <div className="flex -space-x-2 shrink-0">
                  <img className="inline-block h-6 w-6 rounded-full ring-2 ring-[#0f1422]" src="https://i.pravatar.cc/100?img=33" alt="" />
                  <img className="inline-block h-6 w-6 rounded-full ring-2 ring-[#0f1422]" src="https://i.pravatar.cc/100?img=47" alt="" />
                  <img className="inline-block h-6 w-6 rounded-full ring-2 ring-[#0f1422]" src="https://i.pravatar.cc/100?img=12" alt="" />
                </div>
                <p className="text-[11px] text-[#8c909f] leading-snug">{t("Only")} <strong className="text-white">70 {t("creators")}</strong> {t("have unlocked this so far.")}</p>
              </div>
            </Link>

            {/* 2. Coming Soon (e.g., Storyboard Generator) */}
            <div className="flex cursor-not-allowed flex-col rounded-2xl border border-white/5 bg-white/5 p-6 opacity-60 grayscale transition-all hover:opacity-80">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-[#23293c] text-slate-400">
                <span className="material-symbols-outlined text-2xl">view_timeline</span>
              </div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="font-headline text-lg font-bold text-white truncate">{t("Storyboard Studio")}</h3>
                <span className="shrink-0 rounded bg-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white/70">{t("Coming Soon")}</span>
              </div>
              <p className="mt-2 flex-grow text-sm leading-6 text-slate-400">
                {t("A sequential engine that breaks scripts into scenes and generates stylistically consistent visual frames.")}
              </p>
            </div>

            {/* 3. Coming Soon (e.g., Video Generation) */}
            <div className="flex cursor-not-allowed flex-col rounded-2xl border border-white/5 bg-white/5 p-6 opacity-60 grayscale transition-all hover:opacity-80">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-[#23293c] text-slate-400">
                <span className="material-symbols-outlined text-2xl">movie</span>
              </div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="font-headline text-lg font-bold text-white truncate">{t("Video Generation")}</h3>
                <span className="shrink-0 rounded bg-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white/70">{t("Coming Soon")}</span>
              </div>
              <p className="mt-2 flex-grow text-sm leading-6 text-slate-400">
                {t("An orchestration engine for storyboard generation, asset creation, and final video rendering.")}
              </p>
            </div>
          </div>
        </div>

        {/* Playground History */}
        <section>
          <div className="rounded-2xl border border-white/8 bg-[#151b2d]">
            <div className="border-b border-white/8 px-5 py-4 sm:px-6 sm:py-5">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#adc6ff]">{t("Recent Usage")}</div>
                <h2 className="mt-2 font-headline text-xl font-bold text-white sm:text-2xl">{t("Playground History")}</h2>
              </div>
            </div>

            <div className="divide-y divide-white/6">
              {!loading && recentConversations.length > 0 ? (
                recentConversations.map((conversation) => (
                  <div
                    key={conversation.id}
                    className="px-5 py-4 transition-colors hover:bg-white/[0.03] sm:px-6"
                  >
                    <div className="lg:hidden">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedConversationIds((current) =>
                            current.includes(conversation.id)
                              ? current.filter((id) => id !== conversation.id)
                              : [...current, conversation.id],
                          )
                        }
                        className="flex w-full items-center justify-between gap-3 text-left"
                      >
                        <div className="min-w-0">
                          <div className="text-[10px] uppercase tracking-[0.18em] text-[#8c909f]">{t("Name")}</div>
                          <div className="mt-1 truncate font-medium text-white">
                            {conversation.title || t("New Chat")}
                          </div>
                        </div>
                        <span
                          className={`material-symbols-outlined text-[#adc6ff] transition-transform ${
                            expandedConversationIds.includes(conversation.id) ? "rotate-180" : ""
                          }`}
                        >
                          expand_more
                        </span>
                      </button>

                      {expandedConversationIds.includes(conversation.id) ? (
                        <div className="mt-4 grid gap-4 rounded-xl border border-white/8 bg-[#101728] p-4">
                          <div className="min-w-0">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-[#8c909f]">{t("Model used")}</div>
                            <div className="mt-1 truncate font-medium text-white">
                              {plainChatModelLookup.get(conversation.model) ||
                                plainChatModelLookup.get((conversation.model || "").toLowerCase()) ||
                                conversation.model ||
                                t("Chat model")}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="min-w-0">
                              <div className="text-[10px] uppercase tracking-[0.18em] text-[#8c909f]">{t("Last change")}</div>
                              <div className="mt-1 text-sm text-[#c2c6d6]">
                                {formatHistoryDate(new Date((conversation.lastMessageAt || conversation.updatedAt) * 1000))}
                              </div>
                            </div>
                            <div className="min-w-0">
                              <div className="text-[10px] uppercase tracking-[0.18em] text-[#8c909f]">{t("Credits charged")}</div>
                              <div className="mt-1 font-medium text-white">
                                {(conversation.totalCostCredits || 0).toFixed(2)} Cr
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <button
                              type="button"
                              onClick={() => {
                                router.push(`/studio/chat?conversation=${encodeURIComponent(conversation.id)}`);
                              }}
                              className="inline-flex items-center gap-2 text-sm font-semibold text-[#adc6ff]"
                            >
                              {t("Open chat")}
                              <span className="material-symbols-outlined text-base">arrow_forward</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteConversation(conversation.id)}
                              className="rounded-md border border-[#5b2028] p-2 text-[#ffb4ab] transition-colors hover:bg-[#5b2028]/20"
                              aria-label={`Delete ${conversation.title || "conversation"}`}
                            >
                              <span className="material-symbols-outlined text-[18px]">delete</span>
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div
                      onClick={() => {
                        router.push(`/studio/chat?conversation=${encodeURIComponent(conversation.id)}`);
                      }}
                      className="hidden cursor-pointer gap-4 lg:grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto_auto_auto_auto] lg:items-center"
                    >
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-[#8c909f]">{t("Name")}</div>
                        <div className="mt-1 truncate font-medium text-white">
                          {conversation.title || t("New Chat")}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-[#8c909f]">{t("Model used")}</div>
                        <div className="mt-1 truncate font-medium text-white">
                          {plainChatModelLookup.get(conversation.model) || plainChatModelLookup.get((conversation.model || "").toLowerCase()) || conversation.model || t("Chat model")}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-[#8c909f]">{t("Last change")}</div>
                        <div className="mt-1 truncate text-sm text-[#c2c6d6]">
                          {formatHistoryDate(new Date((conversation.lastMessageAt || conversation.updatedAt) * 1000))}
                        </div>
                      </div>
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.18em] text-[#8c909f]">{t("Credits charged")}</div>
                          <div className="mt-1 font-medium text-white">
                            {(conversation.totalCostCredits || 0).toFixed(2)} Cr
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2 text-[#adc6ff]">
                        <span className="material-symbols-outlined">arrow_forward</span>
                      </div>
                      <div className="flex items-center justify-end lg:justify-self-end">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDeleteConversation(conversation.id);
                          }}
                          className="rounded-md border border-[#5b2028] p-2 text-[#ffb4ab] transition-colors hover:bg-[#5b2028]/20"
                          aria-label={`Delete ${conversation.title || "conversation"}`}
                        >
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              ) : null}

              {loading ? (
                <div className="px-5 py-8 text-sm text-[#8c909f] sm:px-6 sm:py-10">{t("Loading playground history…")}</div>
              ) : recentConversations.length === 0 ? (
                <div className="px-5 py-8 text-sm text-[#8c909f] sm:px-6 sm:py-10">{t("No recent playground conversations yet.")}</div>
              ) : null}
            </div>

            {canLoadMore ? (
              <div className="border-t border-white/8 px-5 py-4 text-center sm:px-6">
                <button
                  type="button"
                  onClick={() => setVisibleCount((count) => Math.min(count + HISTORY_PAGE_SIZE, HISTORY_MAX))}
                  className="inline-flex items-center gap-2 rounded-full border border-[#adc6ff]/30 bg-white/5 px-5 py-2.5 text-sm font-semibold text-[#adc6ff] transition-colors hover:border-[#adc6ff]/50 hover:bg-white/10 hover:text-white"
                >
                  {t("Load more")}
                  <span className="material-symbols-outlined text-base">expand_more</span>
                </button>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  );
}
