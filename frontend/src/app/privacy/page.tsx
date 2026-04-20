"use client";

import Link from "next/link";

import AnimatedLogo from "../../components/AnimatedLogo";

const sections = [
  {
    title: "What We Collect",
    items: [
      "Basic account information such as your email address and display name through the sign-in provider.",
      "Prompts, generation requests, usage history, and uploaded images used to operate Vibecraft.",
      "Security and operational data such as IP-address-related abuse signals, login events, and service logs.",
    ],
  },
  {
    title: "How We Use Data",
    items: [
      "To authenticate users, enforce credits and usage limits, and deliver generated content.",
      "To prevent abuse, investigate suspicious activity, and protect the platform and providers.",
      "To maintain service quality, troubleshoot failures, and improve the product.",
    ],
  },
  {
    title: "Sharing And Processors",
    items: [
      "Generation requests may be processed through our infrastructure and external AI providers used by Vibecraft.",
      "We do not sell user data.",
      "We may share limited information when required for security, fraud prevention, or legal compliance.",
    ],
  },
  {
    title: "Storage And Retention",
    items: [
      "Generated history, credit activity, audit logs, and related service records may be stored to operate the MVP.",
      "Uploaded and generated assets may be retained for operational and product purposes unless removed by system cleanup rules.",
      "Retention periods may change as the service evolves.",
    ],
  },
  {
    title: "Security",
    items: [
      "We use authentication, session controls, rate limits, and logging to protect the service.",
      "No system can guarantee absolute security, so you should avoid submitting highly sensitive personal information.",
    ],
  },
  {
    title: "Contact",
    items: [
      "If you have questions about privacy or data handling, contact the Vibecraft operator through the current support channel.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen flex items-start justify-center px-4 py-10 sm:px-6 sm:py-16">
      <div className="w-full max-w-4xl">
        <div className="mb-8 text-center animate-fade-in">
          <div className="mb-4 flex justify-center">
            <AnimatedLogo sizeClassName="h-24 w-24" imageClassName="h-18 w-18" />
          </div>
          <h1 className="text-4xl font-extrabold gradient-text tracking-tight">Vibecraft Privacy Policy</h1>
          <p className="mt-3 text-sm text-slate-400">
            How the Vibecraft MVP collects, uses, and protects user data.
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
            This page describes data handling for the current MVP. Account rules, usage limits, and prohibited content are covered in the Usage Policy.
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/policy" className="btn-secondary">
              View Usage Policy
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
