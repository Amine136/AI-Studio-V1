"use client";

import Link from "next/link";

const sections = [
  {
    title: "Account Rules",
    summary: "How user identity and account ownership are expected to work during the MVP.",
    items: [
      "Each person should use one primary account.",
      "Accounts may not be created in bulk to bypass credit or usage limits.",
      "Accounts may be limited or suspended if abuse is detected.",
    ],
  },
  {
    title: "Usage Limits",
    summary: "The current consumption limits that keep provider cost and abuse exposure under control.",
    items: [
      "First 24 hours after signup: maximum 1 credit total usage.",
      "After the first 24 hours: maximum 5 credits per rolling 24 hours.",
      "Smart analysis fees and generation charges both count toward account usage.",
    ],
  },
  {
    title: "Credit Code Rules",
    summary: "Redemption rules, anti-bruteforce thresholds, and consequences for repeated failed attempts.",
    items: [
      "No account may redeem more than 4 credit codes in 1 day.",
      "No account may redeem more than 10 credit codes in 7 days.",
      "If an account reaches 5 failed credit-code attempts in 5 minutes, redemption is blocked for 5 minutes.",
      "10 consecutive failed credit-code attempts can trigger a 1-hour suspension.",
      "20 consecutive failed credit-code attempts within 24 hours can trigger suspension until admin review.",
      "Credit codes may not be abused through multi-account farming or brute-force attempts.",
    ],
  },
  {
    title: "Prohibited Content",
    summary: "The baseline content and platform-abuse rules that apply across Quick and Smart workflows.",
    items: [
      "No explicit sexual or pornographic content.",
      "No exploitative, abusive, hateful, fraudulent, or illegal content.",
      "No attempts to abuse the platform, bypass moderation, or attack providers.",
    ],
  },
];

const quickLinks = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/credits", label: "Credits Workspace" },
  { href: "/studio", label: "Open Studio" },
];

export default function PolicyPage() {
  return (
    <main className="min-h-screen bg-[#070d19] px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mx-auto max-w-6xl space-y-8">
        <section className="overflow-hidden rounded-[36px] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.2),transparent_30%),radial-gradient(circle_at_right,rgba(139,92,246,0.18),transparent_28%),#081121] p-6 shadow-[0_35px_100px_rgba(0,0,0,0.42)] sm:p-8 lg:p-10">
          <div className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
            <div>
              <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Usage Policy</div>
              <h1 className="mt-4 max-w-3xl text-4xl font-black tracking-tight text-white sm:text-5xl">
                The operating rules for Vibecraft accounts, credits, and content generation.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
                This page defines the current MVP rules: account behavior, usage ceilings, credit-code redemption limits,
                and prohibited use of the platform.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                {quickLinks.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-[28px] border border-blue-500/20 bg-blue-500/[0.08] p-5">
                <div className="text-xs uppercase tracking-[0.22em] text-blue-200/70">Scope</div>
                <div className="mt-2 text-xl font-bold text-white">Usage, safety, and abuse controls</div>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  This is the rules page. It is not the privacy document for data handling.
                </p>
              </div>
              <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Current model</div>
                <div className="mt-2 text-xl font-bold text-white">Code credits + guarded access</div>
                <p className="mt-3 text-sm leading-7 text-slate-400">
                  Limits and suspensions are part of the MVP design, not temporary copy.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          {sections.map((section) => (
            <article
              key={section.title}
              className="rounded-[32px] border border-white/8 bg-[#081121] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.25)] sm:p-7"
            >
              <div className="text-xs uppercase tracking-[0.22em] text-slate-500">{section.title}</div>
              <p className="mt-3 text-sm leading-7 text-slate-400">{section.summary}</p>
              <div className="mt-6 space-y-3">
                {section.items.map((item) => (
                  <div
                    key={item}
                    className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4 text-sm leading-7 text-slate-200"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[32px] border border-white/8 bg-[#081121] p-6 sm:p-8">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Important note</div>
            <h2 className="mt-3 text-2xl font-bold text-white">This page is about platform rules, not privacy.</h2>
            <p className="mt-4 max-w-2xl text-sm leading-8 text-slate-400">
              Account rules, usage limits, suspensions, and acceptable use are documented here. Data collection, storage,
              and handling are covered separately in the Privacy Policy.
            </p>
          </div>

          <div className="rounded-[32px] border border-white/8 bg-[#081121] p-6 sm:p-8">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Next steps</div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/privacy" className="btn-primary text-center">
                View Privacy Policy
              </Link>
              <Link href="/dashboard" className="btn-dark text-center">
                Back to Dashboard
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
