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

        <div className="mb-10">
          <Link
            href="/studio/chat?new=1"
            className="group flex flex-col items-start justify-between rounded-3xl border border-[#adc6ff]/30 bg-[linear-gradient(135deg,rgba(77,142,255,0.08),rgba(21,27,45,0.94))] p-6 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)] transition-all hover:-translate-y-1 hover:border-[#adc6ff]/50 sm:p-10 md:flex-row md:items-center"
          >
            <div className="flex flex-col items-start gap-6 md:flex-row md:items-center md:gap-8">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[#adc6ff] text-[#00285d] shadow-[0_0_20px_rgba(173,198,255,0.3)]">
                <span className="material-symbols-outlined text-4xl">chat</span>
              </div>
              <div>
                <h2 className="font-headline text-2xl font-bold text-white sm:text-3xl">Playground</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#c2c6d6] sm:text-base sm:leading-7">
                  Best for lightweight prompting, iteration, and direct AI generation. This is the fast path for users who want to interact with individual models directly.
                </p>
              </div>
            </div>
            <div className="mt-8 inline-flex shrink-0 items-center gap-2 rounded-full bg-white/10 px-6 py-3 font-semibold text-white transition-all group-hover:bg-white/20 md:mt-0">
              Open Playground
              <span className="material-symbols-outlined text-base transition-transform group-hover:translate-x-1">arrow_forward</span>
            </div>
          </Link>
        </div>

        <div className="mt-16">
          <h2 className="font-headline text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Workflows
          </h2>
          <p className="mt-2 text-sm text-[#8c909f]">
            Guided, multi-step engines designed for specific tasks.
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
              <h3 className="font-headline text-lg font-bold text-white">Smart Content</h3>
              <p className="mt-2 flex-grow text-sm leading-6 text-[#c2c6d6]">
                Review prompts, choose precise settings, and generate structured content with our guided creation workflow.
              </p>
              <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#adc6ff] transition-all group-hover:gap-3">
                Open Workflow
                <span className="material-symbols-outlined text-base">arrow_forward</span>
              </div>
              
              <div className="mt-6 border-t border-white/10 pt-4 flex items-center gap-3">
                <div className="flex -space-x-2 shrink-0">
                  <img className="inline-block h-6 w-6 rounded-full ring-2 ring-[#0f1422]" src="https://i.pravatar.cc/100?img=33" alt="" />
                  <img className="inline-block h-6 w-6 rounded-full ring-2 ring-[#0f1422]" src="https://i.pravatar.cc/100?img=47" alt="" />
                  <img className="inline-block h-6 w-6 rounded-full ring-2 ring-[#0f1422]" src="https://i.pravatar.cc/100?img=12" alt="" />
                </div>
                <p className="text-[11px] text-[#8c909f] leading-snug">Only <strong className="text-white">70 creators</strong> have unlocked this so far.</p>
              </div>
            </Link>

            {/* 2. Coming Soon (e.g., Storyboard Generator) */}
            <div className="flex cursor-not-allowed flex-col rounded-2xl border border-white/5 bg-white/5 p-6 opacity-60 grayscale transition-all hover:opacity-80">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-[#23293c] text-slate-400">
                <span className="material-symbols-outlined text-2xl">view_timeline</span>
              </div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="font-headline text-lg font-bold text-white truncate">Storyboard Studio</h3>
                <span className="shrink-0 rounded bg-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white/70">Coming Soon</span>
              </div>
              <p className="mt-2 flex-grow text-sm leading-6 text-slate-400">
                A sequential engine that breaks scripts into scenes and generates stylistically consistent visual frames.
              </p>
            </div>

            {/* 3. Coming Soon (e.g., Video Generation) */}
            <div className="flex cursor-not-allowed flex-col rounded-2xl border border-white/5 bg-white/5 p-6 opacity-60 grayscale transition-all hover:opacity-80">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-[#23293c] text-slate-400">
                <span className="material-symbols-outlined text-2xl">movie</span>
              </div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="font-headline text-lg font-bold text-white truncate">Video Generation</h3>
                <span className="shrink-0 rounded bg-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white/70">Coming Soon</span>
              </div>
              <p className="mt-2 flex-grow text-sm leading-6 text-slate-400">
                An orchestration engine for storyboard generation, asset creation, and final video rendering.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
