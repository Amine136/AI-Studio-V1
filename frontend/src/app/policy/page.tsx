"use client";

import Link from "next/link";

import AnimatedLogo from "../../components/AnimatedLogo";

const sections = [
  {
    title: "Account Rules",
    items: [
      "Each person should use one primary account.",
      "Accounts may not be created in bulk to bypass credit or usage limits.",
      "Accounts may be limited or suspended if abuse is detected.",
    ],
  },
  {
    title: "Usage Limits",
    items: [
      "First 24 hours after signup: maximum 1 credit total usage.",
      "After the first 24 hours: maximum 5 credits per rolling 24 hours.",
      "Smart analysis fees and generation charges both count toward account usage.",
    ],
  },
  {
    title: "Credit Code Rules",
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
    items: [
      "No explicit sexual or pornographic content.",
      "No exploitative, abusive, hateful, fraudulent, or illegal content.",
      "No attempts to abuse the platform, bypass moderation, or attack providers.",
    ],
  },
];

export default function PolicyPage() {
  return (
    <main className="min-h-screen flex items-start justify-center px-4 py-10 sm:px-6 sm:py-16">
      <div className="w-full max-w-4xl">
        <div className="mb-8 text-center animate-fade-in">
          <div className="mb-4 flex justify-center">
            <AnimatedLogo sizeClassName="h-24 w-24" imageClassName="h-18 w-18" />
          </div>
          <h1 className="text-4xl font-extrabold gradient-text tracking-tight">Vibecraft Usage Policy</h1>
          <p className="mt-3 text-sm text-slate-400">
            Core account, usage, redemption, and content rules for the current MVP.
          </p>
        </div>

        <div className="glass-card p-6 sm:p-8 space-y-6 animate-fade-in-up">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-lg font-semibold text-white">{section.title}</h2>
              <div className="mt-3 space-y-2">
                {section.items.map((item) => (
                  <p key={item} className="text-sm leading-6 text-slate-300">
                    {item}
                  </p>
                ))}
              </div>
            </section>
          ))}

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-slate-400">
            This page covers account rules, usage limits, suspensions, and acceptable use. It is not the Privacy Policy.
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/privacy" className="btn-secondary">
              View Privacy Policy
            </Link>
            <Link href="/" className="btn-secondary">
              Back To Studio
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
