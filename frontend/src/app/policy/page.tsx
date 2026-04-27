"use client";

import Link from "next/link";

const sections = [
  {
    title: "Account Rules",
    summary: "Core identity and access rules for using Vibecraft.",
    items: [
      "Each person should use one primary account.",
      "Accounts may not be created in bulk to bypass credit or usage limits.",
      "You are responsible for activity performed through your account.",
      "Accounts may be limited, suspended, or manually reviewed if abuse, fraud, or account sharing is detected.",
    ],
  },
  {
    title: "Usage Limits",
    summary: "The current service ceilings used to control cost and abuse exposure.",
    items: [
      "First 24 hours after signup: maximum 1 credit total usage.",
      "After the first 24 hours: maximum 5 credits per rolling 24 hours.",
      "Smart analysis fees, generation charges, and plain-chat billed usage all count toward account usage.",
      "Operator-side safety, credit, abuse, or provider limits may block requests before a requested action runs.",
    ],
  },
  {
    title: "Credits, Billing, And Refund Rules",
    summary: "How credits are consumed and when a charge should or should not happen.",
    items: [
      "Vibecraft charges credits based on the active billing logic of the selected workflow or model.",
      "If Vibecraft cannot deliver a usable result, the user should not be charged for that failed result unless otherwise stated in-product.",
      "If a request succeeds and provider cost is already incurred, the delivered result may still be charged even if the final account balance becomes slightly negative.",
      "Standard Vibecraft credits do not expire unless a specific promotional credit explicitly says otherwise.",
      "Credits are non-transferable and are not intended to be traded, resold, or pooled across accounts.",
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
    title: "Acceptable Use And Prohibited Content",
    summary: "The baseline content and platform-abuse rules that apply across chat, quick, and smart workflows.",
    items: [
      "No explicit sexual or pornographic content.",
      "No exploitative, abusive, hateful, fraudulent, or illegal content.",
      "No attempts to abuse the platform, bypass moderation, or attack providers.",
      "Do not upload content you do not have the right to use, process, transform, or generate from.",
      "Do not use Vibecraft for spam, credential attacks, provider probing, scraping, or automated abuse.",
    ],
  },
  {
    title: "Enforcement And Suspension",
    summary: "What may happen if these rules are violated.",
    items: [
      "Enforcement may include warnings, temporary restrictions, credit-code blocks, generation blocks, suspension, or permanent removal.",
      "Serious fraud, brute-force behavior, multi-account farming, or provider abuse may trigger immediate suspension without prior warning.",
      "The operator may review logs, billing records, generation history, and abuse signals when investigating violations.",
    ],
  },
  {
    title: "Output Disclaimer And Appeals",
    summary: "What Vibecraft does not guarantee and how disputes should be escalated.",
    items: [
      "Generated outputs may be inaccurate, incomplete, biased, or unsuitable for legal, medical, financial, or other high-stakes decisions.",
      "You are responsible for reviewing and validating outputs before publishing, selling, or relying on them.",
      "If you believe an enforcement action or billing outcome is incorrect, contact Vibecraft Support at ouni@novanode.tn.",
    ],
  },
];

export default function PolicyPage() {
  return (
    <main className="min-h-screen bg-[#070d19] px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mx-auto max-w-6xl space-y-8">
        <section className="overflow-hidden rounded-2xl border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.2),transparent_30%),radial-gradient(circle_at_right,rgba(139,92,246,0.18),transparent_28%),#081121] p-6 shadow-[0_35px_100px_rgba(0,0,0,0.42)] sm:p-8 lg:p-10">
          <div className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
            <div>
              <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Usage Policy</div>
              <h1 className="mt-4 max-w-3xl text-2xl font-bold tracking-tight text-white sm:text-3xl">
                The operating rules for Vibecraft accounts, credits, billing, and content generation.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
                This page defines the current production rules for account behavior, usage ceilings, acceptable use,
                credit billing, redemption controls, and suspension handling on Vibecraft.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.08] p-5">
                <div className="text-xs uppercase tracking-[0.22em] text-blue-200/70">Effective</div>
                <div className="mt-2 text-xl font-bold text-white">April 24, 2026</div>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  This policy applies to the current Vibecraft production workflow unless replaced by a later revision.
                </p>
              </div>
              <div className="rounded-xl border border-white/8 bg-white/[0.03] p-5">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Support</div>
                <div className="mt-2 text-xl font-bold text-white">ouni@novanode.tn</div>
                <p className="mt-3 text-sm leading-7 text-slate-400">
                  Billing disputes, suspension appeals, and policy questions should be sent to the current Vibecraft
                  support contact.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          {sections.map((section) => (
            <article
              key={section.title}
              className="rounded-2xl border border-white/8 bg-[#081121] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.25)] sm:p-7"
            >
              <div className="text-xs uppercase tracking-[0.22em] text-slate-500">{section.title}</div>
              <p className="mt-3 text-sm leading-7 text-slate-400">{section.summary}</p>
              <ul className="mt-6 space-y-3 text-sm leading-7 text-slate-200">
                {section.items.map((item) => (
                  <li key={item} className="border-l border-white/10 pl-4">
                    {item}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        <section>
          <div className="rounded-2xl border border-white/8 bg-[#081121] p-6 sm:p-8">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Important note</div>
            <h2 className="mt-3 text-2xl font-bold text-white">This page governs use of the service.</h2>
            <p className="mt-4 max-w-2xl text-sm leading-8 text-slate-400">
              Account rules, billing, acceptable use, enforcement, and suspension outcomes are documented here. Data
              collection, processing, and retention are covered separately in the Privacy Policy.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
