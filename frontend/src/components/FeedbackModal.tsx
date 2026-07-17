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
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t("Share Feedback")}
    >
      <button type="button" aria-label={t("Close")} onClick={onClose} className="absolute inset-0 cursor-default" />
      <div className="relative w-full max-w-lg rounded-md border border-white/10 bg-[#151b2d] p-8">
        {sent ? (
          <div className="flex flex-col items-center py-6 text-center">
            <span className="material-symbols-outlined text-4xl text-[#adc6ff]">mark_email_read</span>
            <p className="mt-4 text-sm leading-relaxed text-[#c2c6d6]">{t("Thanks! Your feedback has been received.")}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-8 rounded-sm border border-white/10 px-5 py-2.5 text-sm font-bold text-[#dce1fb] transition hover:bg-white/[0.03]"
            >
              {t("Close")}
            </button>
          </div>
        ) : (
          <>
            <h4 className="text-xl font-bold text-[#dce1fb]">{t("Share Feedback")}</h4>
            <p className="mt-1 text-sm text-[#c2c6d6]">{t("Help us improve Vibecraft.")}</p>

            <div className="mt-6 flex flex-wrap gap-2">
              {CATEGORIES.map((item) => {
                const active = category === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setCategory(item.id)}
                    className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${
                      active
                        ? "border-[#adc6ff]/50 bg-[#1a2333] text-[#adc6ff]"
                        : "border-white/10 text-[#c2c6d6] hover:border-[#adc6ff]/35 hover:text-[#dce1fb]"
                    }`}
                  >
                    <span className="material-symbols-outlined text-lg">{item.icon}</span>
                    {t(item.label)}
                  </button>
                );
              })}
            </div>

            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={MESSAGE_MAX_LENGTH}
              rows={5}
              autoFocus
              placeholder={t("Tell us what's working, what's broken, or what you'd love to see.")}
              className="mt-4 w-full resize-none rounded-sm border border-white/10 bg-[#070d1f] p-4 text-sm text-[#dce1fb] placeholder:text-[#7a8197] focus:border-[#adc6ff]/50 focus:outline-none"
            />

            {error ? <p className="mt-3 text-xs text-[#ffb4ab]">{error}</p> : null}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={sending}
                className="rounded-sm border border-white/10 px-5 py-2.5 text-sm font-bold text-[#dce1fb] transition hover:bg-white/[0.03]"
              >
                {t("Cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!canSend}
                className={`inline-flex items-center gap-2 rounded-sm border border-[#adc6ff]/35 bg-[#1a2333] px-5 py-2.5 text-sm font-bold text-[#adc6ff] transition ${
                  canSend ? "hover:border-[#adc6ff]/60" : "cursor-not-allowed opacity-60"
                }`}
              >
                <span className="material-symbols-outlined text-lg">{sending ? "hourglass_top" : "send"}</span>
                {sending ? t("Sending...") : t("Send Feedback")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
