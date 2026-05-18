"use client";

import Link from "next/link";

export default function StudioStartPage() {
  return (
    <section className="min-h-[calc(100vh-4rem)] px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-[1400px] space-y-8">
        <div className="max-w-3xl">
          <Link href="/studio" className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-[#adc6ff] transition hover:text-white">
            <span className="material-symbols-outlined text-base">arrow_back</span>
            Back to Studio
          </Link>
          <h1 className="font-headline text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
            Choose how you want to work.
          </h1>
          <p className="mt-4 text-sm leading-6 text-[#c2c6d6] sm:text-base sm:leading-7 lg:text-lg">
            Pick the faster conversational path for lightweight back-and-forth, or enter the guided smart workflow for precise content creation.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Link
            href="/studio/chat?new=1"
            className="group rounded-2xl border border-white/8 bg-[linear-gradient(135deg,rgba(21,27,45,0.96),rgba(12,19,36,0.94))] p-5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)] transition-all hover:border-[#adc6ff]/30 hover:translate-y-[-2px] sm:p-8"
          >
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#23293c] text-[#adc6ff]">
              <span className="material-symbols-outlined text-3xl">chat</span>
            </div>
            <h2 className="font-headline text-2xl font-bold text-white sm:text-3xl">Simple Chat</h2>
            <p className="mt-4 text-sm leading-6 text-[#c2c6d6] sm:text-base sm:leading-7">
              Best for lightweight prompting, iteration, and direct AI conversation. This is the fast path for users who want chat-like interaction.
            </p>
            <div className="mt-8 inline-flex items-center gap-2 font-semibold text-[#adc6ff] transition-all group-hover:gap-3">
              Open Simple Chat
              <span className="material-symbols-outlined text-base">arrow_forward</span>
            </div>
          </Link>

          <Link
            href="/studio/create"
            className="group rounded-2xl border border-[#adc6ff]/20 bg-[linear-gradient(135deg,rgba(77,142,255,0.12),rgba(21,27,45,0.94))] p-5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)] transition-all hover:border-[#adc6ff]/40 hover:translate-y-[-2px] sm:p-8"
          >
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#adc6ff] text-[#00285d]">
              <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
            </div>
            <div className="mb-3 inline-flex rounded-full border border-[#adc6ff]/20 bg-[#adc6ff]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#adc6ff]">
              Recommended for creators
            </div>
            <h2 className="font-headline text-2xl font-bold text-white sm:text-3xl">Smart Content Creation</h2>
            <p className="mt-4 text-sm leading-6 text-[#c2c6d6] sm:text-base sm:leading-7">
              Designed for creators who need more control. Review prompts, choose precise settings, and generate structured content with the guided studio workflow.
            </p>
            <div className="mt-8 inline-flex items-center gap-2 font-semibold text-[#adc6ff] transition-all group-hover:gap-3">
              Open Smart Workflow
              <span className="material-symbols-outlined text-base">arrow_forward</span>
            </div>
          </Link>
        </div>
      </div>
    </section>
  );
}
