"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLanguage } from "../context/LanguageContext";

const STAGE_1_DELAY_MS = 2200;
const STAGE_2_DELAY_MS = 6800;

interface WakeUpLoaderProps {
  /**
   * "default": Renders the spinning `.auth-loader` immediately and progressively
   *            reveals the creative studio wake-up copy if loading exceeds 2.2s.
   * "inline":  Renders nothing initially; after 2.2s of waiting, fades in a
   *            compact glassmorphic status pill (ideal for non-blocking loads
   *            like the Playground model catalogue).
   */
  variant?: "default" | "inline";
  className?: string;
}

export default function WakeUpLoader({
  variant = "default",
  className = "",
}: WakeUpLoaderProps) {
  const { t, language } = useLanguage();
  const [stage, setStage] = useState<0 | 1 | 2>(0);

  useEffect(() => {
    const t1 = window.setTimeout(() => setStage(1), STAGE_1_DELAY_MS);
    const t2 = window.setTimeout(() => setStage(2), STAGE_2_DELAY_MS);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  const headline =
    stage >= 2
      ? t("Almost ready — warming up the AI engines…")
      : t("Waking up the studio…");
  const subtext = t("Spinning up your creative workspace, just a sec.");
  const isRtl = language === "ar";

  if (variant === "inline") {
    return (
      <AnimatePresence>
        {stage >= 1 && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            dir={isRtl ? "rtl" : "ltr"}
            role="status"
            aria-live="polite"
            className={`inline-flex items-center gap-2.5 rounded-full border border-[#adc6ff]/20 bg-[#131b2e]/90 px-3.5 py-1.5 text-xs text-[#dce1fb] shadow-[0_8px_28px_-6px_rgba(77,142,255,0.3)] backdrop-blur-md ${className}`}
          >
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4d8eff] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#adc6ff]" />
            </span>
            <AnimatePresence mode="wait">
              <motion.span
                key={stage}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.2 }}
                className="font-medium tracking-tight text-blue-100/90"
              >
                {headline}
              </motion.span>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center px-6 text-center ${className}`}
    >
      <div className="relative flex items-center justify-center">
        {stage >= 1 && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute h-16 w-16 animate-pulse rounded-full bg-[#4d8eff]/15 blur-xl"
          />
        )}
        <div className="auth-loader" />
      </div>

      <div className="mt-5 min-h-[56px] max-w-xs sm:max-w-sm">
        <AnimatePresence>
          {stage >= 1 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="flex flex-col items-center"
            >
              <AnimatePresence mode="wait">
                <motion.p
                  key={stage}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.22 }}
                  className="font-headline text-sm font-semibold tracking-tight text-[#dce1fb] sm:text-[15px]"
                >
                  {headline}
                </motion.p>
              </AnimatePresence>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                {subtext}
              </p>
              <div className="mt-3.5 h-0.5 w-28 overflow-hidden rounded-full bg-white/10">
                <motion.div
                  className="h-full w-1/2 rounded-full bg-gradient-to-r from-transparent via-[#adc6ff] to-transparent"
                  animate={{ x: ["-100%", "200%"] }}
                  transition={{
                    duration: 1.4,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
