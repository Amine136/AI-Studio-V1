"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "../services/api";
import { useLanguage } from "../context/LanguageContext";
import type { FeedbackCategory } from "../types";

const CATEGORIES: { id: FeedbackCategory; label: string; icon: string }[] = [
  { id: "bug", label: "Bug report", icon: "bug_report" },
  { id: "idea", label: "Idea", icon: "lightbulb" },
  { id: "other", label: "Other", icon: "forum" },
];

const MESSAGE_MAX_LENGTH = 2000;

export default function FeedbackModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, language } = useLanguage();
  const pathname = usePathname();
  const [category, setCategory] = useState<FeedbackCategory>("idea");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  // Reset on every open so a reopened modal starts fresh instead of on the
  // "sent" screen; Escape dismisses and the page behind must not scroll.
  useEffect(() => {
    if (!open) return;
    setCategory("idea");
    setMessage("");
    setSent(false);
    setError("");
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const trimmed = message.trim();
  const canSend = trimmed.length >= 3 && !sending;

  const handleSubmit = async () => {
    if (!canSend) return;
    setSending(true);
    setError("");
    try {
      await api.submitFeedback({ category, message: trimmed, route: pathname || "", language });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t("Failed to send feedback."));
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-6 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={t("Share Feedback")}
    >
      <button type="button" aria-label={t("Close")} onClick={onClose} className="absolute inset-0 cursor-default" />
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/12 bg-[#151b2d] shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
        {sent ? (
          <div className="flex flex-col items-center p-10 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[#adc6ff]/25 bg-[#adc6ff]/10">
              <span className="material-symbols-outlined text-3xl text-[#adc6ff]">mark_email_read</span>
            </div>
            <p className="mt-5 text-sm leading-relaxed text-[#c2c6d6]">{t("Thanks! Your feedback has been received.")}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-8 rounded-sm border border-white/10 px-6 py-2.5 text-sm font-bold text-[#dce1fb] transition hover:border-[#adc6ff]/35 hover:text-[#adc6ff]"
            >
              {t("Close")}
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 border-b border-white/8 p-6">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-[#2e3447] text-[#adc6ff]">
                  <span className="material-symbols-outlined">rate_review</span>
                </div>
                <div>
                  <h4 className="font-headline text-lg font-bold tracking-tight text-[#dce1fb]">{t("Share Feedback")}</h4>
                  <p className="mt-0.5 text-xs text-[#8c909f]">{t("Help us improve Vibecraft.")}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("Close")}
                className="-me-2 -mt-2 flex h-9 w-9 items-center justify-center rounded-md text-[#8c909f] transition hover:bg-white/[0.06] hover:text-[#dce1fb]"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="p-6">
              <p className="mb-2.5 text-xs font-bold uppercase tracking-[0.18em] text-[#8c909f]">{t("Category")}</p>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((item) => {
                  const active = category === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setCategory(item.id)}
                      aria-pressed={active}
                      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${
                        active
                          ? "border-[#adc6ff]/60 bg-[#adc6ff]/12 text-[#adc6ff]"
                          : "border-white/10 bg-white/[0.03] text-[#b9c8de]/80 hover:border-white/25 hover:text-[#dce1fb]"
                      }`}
                    >
                      <span
                        className="material-symbols-outlined text-lg"
                        style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
                      >
                        {item.icon}
                      </span>
                      {t(item.label)}
                    </button>
                  );
                })}
              </div>

              <div className="relative mt-5">
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={MESSAGE_MAX_LENGTH}
                  rows={5}
                  autoFocus
                  placeholder={t("Tell us what's working, what's broken, or what you'd love to see.")}
                  className="w-full resize-none rounded-lg border border-white/12 bg-[#0c1324] p-4 pb-8 text-sm leading-relaxed text-[#dce1fb] placeholder:text-[#7a8197] transition focus:border-[#adc6ff]/60 focus:outline-none focus:ring-2 focus:ring-[#adc6ff]/20"
                />
                <span className="pointer-events-none absolute bottom-3 end-3 text-[10px] tabular-nums text-[#7a8197]">
                  {message.length}/{MESSAGE_MAX_LENGTH}
                </span>
              </div>

              {error ? <p className="mt-3 text-xs text-[#ffb4ab]">{error}</p> : null}

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={sending}
                  className="rounded-sm border border-white/10 px-5 py-2.5 text-sm font-bold text-[#c2c6d6] transition hover:bg-white/[0.04] hover:text-[#dce1fb]"
                >
                  {t("Cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={!canSend}
                  className={`inline-flex items-center gap-2 rounded-sm bg-[linear-gradient(90deg,#adc6ff,#4d8eff)] px-6 py-2.5 text-sm font-bold tracking-wide text-[#002e6a] transition ${
                    canSend ? "hover:brightness-110" : "cursor-not-allowed opacity-50"
                  }`}
                >
                  <span className="material-symbols-outlined text-lg">{sending ? "hourglass_top" : "send"}</span>
                  {sending ? t("Sending...") : t("Send Feedback")}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
