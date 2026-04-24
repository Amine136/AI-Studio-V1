"use client";

import Link from "next/link";

const sections = [
  {
    title: "What We Collect",
    summary: "The core identity, usage, and operational data required to run the product.",
    items: [
      "Basic account information such as your email address and display name through the sign-in provider.",
      "Prompts, generation requests, usage history, and uploaded images used to operate Vibecraft.",
      "Security and operational data such as IP-address-related abuse signals, login events, and service logs.",
    ],
  },
  {
    title: "How We Use Data",
    summary: "Why the system needs this information and where it affects the product experience.",
    items: [
      "To authenticate users, enforce credits and usage limits, and deliver generated content.",
      "To prevent abuse, investigate suspicious activity, and protect the platform and providers.",
      "To maintain service quality, troubleshoot failures, and improve the product.",
    ],
  },
  {
    title: "Sharing And Processors",
    summary: "How Vibecraft interacts with internal infrastructure and external model providers.",
    items: [
      "Generation requests may be processed through our infrastructure and external AI providers used by Vibecraft.",
      "We do not sell user data.",
      "We may share limited information when required for security, fraud prevention, or legal compliance.",
    ],
  },
  {
    title: "Storage And Retention",
    summary: "The types of records that may persist while the MVP is operating.",
    items: [
      "Generated history, credit activity, audit logs, and related service records may be stored to operate the MVP.",
      "Uploaded and generated assets may be retained for operational and product purposes unless removed by system cleanup rules.",
      "Retention periods may change as the service evolves.",
    ],
  },
  {
    title: "Security",
    summary: "The baseline protection model used today and the limits of that protection.",
    items: [
      "We use authentication, session controls, rate limits, and logging to protect the service.",
      "No system can guarantee absolute security, so you should avoid submitting highly sensitive personal information.",
    ],
  },
  {
    title: "Contact",
    summary: "How privacy questions should be escalated while the MVP is still operator-managed.",
    items: [
      "If you have questions about privacy or data handling, contact the Vibecraft operator through the current support channel.",
    ],
  },
];

const quickLinks = [
  { href: "/policy", label: "Usage Policy" },
  { href: "/credits", label: "Credits Workspace" },
  { href: "/studio", label: "Open Studio" },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#070d19] px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mx-auto max-w-6xl space-y-8">
        <section className="overflow-hidden rounded-[36px] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.16),transparent_32%),radial-gradient(circle_at_right,rgba(59,130,246,0.15),transparent_28%),#081121] p-6 shadow-[0_35px_100px_rgba(0,0,0,0.42)] sm:p-8 lg:p-10">
          <div className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
            <div>
              <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Privacy Policy</div>
              <h1 className="mt-4 max-w-3xl text-4xl font-black tracking-tight text-white sm:text-5xl">
                How Vibecraft collects, uses, stores, and protects data in the current MVP.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
                This page covers data handling for accounts, prompts, uploads, generation history, and service security
                logs. It is separate from the Usage Policy, which defines behavioral rules and suspensions.
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
              <div className="rounded-[28px] border border-emerald-500/20 bg-emerald-500/[0.07] p-5">
                <div className="text-xs uppercase tracking-[0.22em] text-emerald-200/70">Scope</div>
                <div className="mt-2 text-xl font-bold text-white">Data handling and retention</div>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  This page explains what is collected and how it supports authentication, generation, and security.
                </p>
              </div>
              <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-500">MVP reality</div>
                <div className="mt-2 text-xl font-bold text-white">Operator-managed infrastructure</div>
                <p className="mt-3 text-sm leading-7 text-slate-400">
                  Retention and operational rules may evolve as Vibecraft moves from MVP into a more formal service.
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
            <h2 className="mt-3 text-2xl font-bold text-white">Behavior rules are documented elsewhere.</h2>
            <p className="mt-4 max-w-2xl text-sm leading-8 text-slate-400">
              This page covers data collection, storage, and security. Limits, suspensions, prohibited content, and
              redemption rules are covered in the Usage Policy.
            </p>
          </div>

          <div className="rounded-[32px] border border-white/8 bg-[#081121] p-6 sm:p-8">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Next steps</div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/policy" className="btn-primary text-center">
                View Usage Policy
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
