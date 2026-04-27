"use client";

import Link from "next/link";

const sections = [
  {
    title: "Operator And Scope",
    summary: "Who runs Vibecraft and what this page covers.",
    items: [
      "Vibecraft is currently operated as a managed online AI studio service under active operator control.",
      "This Privacy Policy applies to Vibecraft accounts, prompts, uploads, generated outputs, billing records, support interactions, and security logs.",
      "Effective date: April 24, 2026. This page may be updated as the service, infrastructure, or provider stack changes.",
    ],
  },
  {
    title: "Data We Collect",
    summary: "The categories of data required to operate the product.",
    items: [
      "Account and identity data such as email address, display name, and sign-in provider information.",
      "Product data such as prompts, chat turns, uploaded images, generated images, generated text, model selections, and parameter choices.",
      "Billing and service records such as credit ledger entries, usage totals, redemption activity, request status, and failure logs.",
      "Security and abuse-prevention data such as login events, IP-related abuse signals, rate-limit events, and operator audit logs.",
    ],
  },
  {
    title: "How We Use Data",
    summary: "Why this information is processed.",
    items: [
      "To authenticate users, maintain accounts, and keep sessions secure.",
      "To deliver chat responses, image generation, smart generation workflows, and related creative features.",
      "To calculate usage, enforce credit balances, apply billing rules, and prevent fraud or abuse.",
      "To investigate failures, improve reliability, monitor provider behavior, and protect the platform and provider accounts.",
    ],
  },
  {
    title: "Providers And Processors",
    summary: "Where data may be processed outside the core app.",
    items: [
      "Vibecraft may use third-party identity, hosting, storage, database, logging, and AI model providers to operate the service.",
      "Prompts, images, and generation instructions may be transmitted to external AI providers when needed to deliver requested outputs.",
      "We do not sell personal data. We may disclose limited information where required for security, fraud prevention, legal compliance, or protection of service infrastructure.",
    ],
  },
  {
    title: "Retention",
    summary: "How long records may remain in service systems.",
    items: [
      "Account, billing, redemption, and abuse-prevention records may be retained as long as reasonably necessary for service operation, fraud prevention, and audit purposes.",
      "Prompts, chat history, uploaded assets, and generated outputs may be retained until deleted by the user, removed by the operator, or cleared by product retention rules.",
      "System backups, logs, and provider-facing request traces may remain for a limited period after deletion from the main product interface.",
    ],
  },
  {
    title: "User Requests And Rights",
    summary: "What users may ask us to do with their data.",
    items: [
      "You may request account closure, deletion review, or correction of obvious account information errors through the current Vibecraft support channel.",
      "You may also delete your own stored plain chat conversations directly from the product interface when that control is available.",
      "Some records may be retained when reasonably required for billing integrity, fraud prevention, abuse investigations, legal obligations, or security review.",
      "Deletion requests may not remove data already processed by third-party providers under their own service operations and retention controls.",
    ],
  },
  {
    title: "Security, Age Limit, And Contact",
    summary: "Baseline user-safety and access assumptions.",
    items: [
      "We use authentication, session controls, rate limits, access controls, and logging, but no system can guarantee absolute security.",
      "Do not submit highly sensitive personal, financial, medical, or confidential regulated information into Vibecraft.",
      "Vibecraft is not intended for children. You must be at least 13 years old, or older if required by your local law, to use the service.",
      "For privacy questions, deletion requests, or policy concerns, contact Vibecraft Support at ouni@novanode.tn.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#070d19] px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mx-auto max-w-6xl space-y-8">
        <section className="overflow-hidden rounded-2xl border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.16),transparent_32%),radial-gradient(circle_at_right,rgba(59,130,246,0.15),transparent_28%),#081121] p-6 shadow-[0_35px_100px_rgba(0,0,0,0.42)] sm:p-8 lg:p-10">
          <div className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
            <div>
              <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Privacy Policy</div>
              <h1 className="mt-4 max-w-3xl text-2xl font-bold tracking-tight text-white sm:text-3xl">
                How Vibecraft collects, uses, shares, stores, and protects service data.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
                This page explains the current operating privacy rules for accounts, prompts, uploads, generated content,
                billing records, and security logging. It is separate from the Usage Policy, which defines platform
                behavior rules, enforcement, credits, and suspensions.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] p-5">
                <div className="text-xs uppercase tracking-[0.22em] text-emerald-200/70">Effective</div>
                <div className="mt-2 text-xl font-bold text-white">April 24, 2026</div>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  This version applies to the current Vibecraft production workflow unless replaced by a later revision.
                </p>
              </div>
              <div className="rounded-xl border border-white/8 bg-white/[0.03] p-5">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Support</div>
                <div className="mt-2 text-xl font-bold text-white">ouni@novanode.tn</div>
                <p className="mt-3 text-sm leading-7 text-slate-400">
                  Privacy questions, deletion requests, and support escalations should be sent to the current Vibecraft
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
            <h2 className="mt-3 text-2xl font-bold text-white">Third-party AI processing is part of the service.</h2>
            <p className="mt-4 max-w-2xl text-sm leading-8 text-slate-400">
              When you ask Vibecraft to generate text or images, request data may be processed by external AI providers
              selected by the platform. You should avoid sending highly sensitive material into generation workflows.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
