"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { useLanguage } from "../../../context/LanguageContext";
import { api } from "../../../services/api";
import StepIndicator, { type Step } from "../../../components/StepIndicator";
import type { CheckoutConfig, CreditPlan } from "../../../types";

const WIZARD_STEPS: readonly Step[] = [
  { key: "plan", label: "Plan", icon: "✦" },
  { key: "method", label: "Payment", icon: "◎" },
  { key: "pay", label: "Confirm", icon: "✓" },
];

const PROOF_ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";
const PROOF_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

// TND is a 3-decimal currency, so prices arrive as millimes. Whole dinars are the
// common case (15.000 DT), so trim the trailing zeros rather than always showing 3.
const formatPrice = (priceMinor: number, currency: string) => {
  const amount = priceMinor / 1000;
  const text = Number.isInteger(amount) ? String(amount) : amount.toFixed(3).replace(/0+$/, "");
  return currency === "TND" ? `${text} DT` : `${text} ${currency}`;
};

const CARD_CLASS =
  "rounded-xl border border-white/10 bg-[rgba(25,31,49,0.7)] p-5 backdrop-blur-xl sm:p-8";
const PRIMARY_BUTTON_CLASS =
  "rounded-md bg-[linear-gradient(90deg,#adc6ff,#4d8eff)] px-8 py-3 font-bold text-[#002e6a] shadow-lg shadow-[#adc6ff]/10 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-60";
const SECONDARY_BUTTON_CLASS =
  "rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm text-[#adc6ff] transition hover:bg-white/10";

interface ProofFile {
  id: string;
  file: File;
  previewUrl: string | null;
}

function CopyableValue({ label, value }: { label: string; value: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked (insecure context, denied permission). The value
      // is on screen and selectable, so failing quietly is enough.
    }
  }, [value]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 py-2.5 first:border-t-0">
      <span className="text-xs uppercase tracking-[0.18em] text-[#c2c6d6]/70">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-sm text-white">{value}</span>
        <button
          type="button"
          onClick={copy}
          aria-label={t("Copy")}
          className="rounded-md border border-white/10 bg-white/5 p-1.5 text-[#adc6ff] transition hover:bg-white/10"
        >
          <span className="material-symbols-outlined text-[15px]">
            {copied ? "check" : "content_copy"}
          </span>
        </button>
      </span>
    </div>
  );
}

function BuyCreditsWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, isRtl } = useLanguage();
  const { user } = useAuth();

  const [config, setConfig] = useState<CheckoutConfig | null>(null);
  const [configError, setConfigError] = useState("");
  const [loading, setLoading] = useState(true);

  const [proofs, setProofs] = useState<ProofFile[]>([]);
  const [note, setNote] = useState("");
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const step = searchParams.get("step") || "plan";
  const planId = searchParams.get("plan") || "";
  const method = searchParams.get("method") || "";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getCheckoutConfig();
        if (!cancelled) setConfig(data);
      } catch (err) {
        if (!cancelled) {
          setConfigError(err instanceof Error ? err.message : t("Could not load the available plans."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  // Object URLs for the local previews are revoked on unmount; the per-file remove
  // path revokes its own.
  const proofsRef = useRef<ProofFile[]>([]);
  proofsRef.current = proofs;
  useEffect(
    () => () => {
      proofsRef.current.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
    },
    [],
  );

  const selectedPlan = useMemo<CreditPlan | null>(
    () => config?.plans.find((p) => p.id === planId) ?? null,
    [config, planId],
  );

  const maxProofFiles = config?.maxProofFiles ?? 3;
  const maxProofBytes = config?.maxProofBytes ?? 5 * 1024 * 1024;
  const noteMaxLength = config?.noteMaxLength ?? 400;
  const accounts = config?.accounts;

  const goTo = useCallback(
    (next: Record<string, string>) => {
      const params = new URLSearchParams();
      Object.entries(next).forEach(([key, value]) => value && params.set(key, value));
      router.push(`/credits/buy?${params.toString()}`);
    },
    [router],
  );

  const isMethodAvailable = useCallback(
    (id: string) => Boolean(config?.methods.find((m) => m.id === id)?.available),
    [config],
  );

  const addFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList?.length) return;
      setError("");
      const incoming = Array.from(fileList);
      const accepted: ProofFile[] = [];

      for (const file of incoming) {
        if (proofs.length + accepted.length >= maxProofFiles) {
          setError(t("You can attach up to {n} files.").replace("{n}", String(maxProofFiles)));
          break;
        }
        if (!PROOF_TYPES.includes(file.type)) {
          setError(t("Proof must be a PNG, JPEG, WEBP, or PDF file."));
          continue;
        }
        if (file.size > maxProofBytes) {
          setError(t("Each file must be 5 MB or smaller."));
          continue;
        }
        accepted.push({
          id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
          file,
          // Receipts are shown as-is: no downscale, no re-encode. A compressed
          // transfer reference is an unreadable transfer reference.
          previewUrl: file.type === "application/pdf" ? null : URL.createObjectURL(file),
        });
      }

      if (accepted.length) setProofs((current) => [...current, ...accepted]);
    },
    [maxProofBytes, maxProofFiles, proofs.length, t],
  );

  const removeFile = useCallback((id: string) => {
    setProofs((current) => {
      const target = current.find((p) => p.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((p) => p.id !== id);
    });
  }, []);

  const submit = useCallback(async () => {
    if (!selectedPlan || submitting) return;

    if (!user) {
      // Carry the whole wizard state through the wall so they land back here.
      const next = `/credits/buy?step=pay&plan=${selectedPlan.id}&method=${method}`;
      router.push(`/auth?next=${encodeURIComponent(next)}`);
      return;
    }
    if (!proofs.length) {
      setError(t("Attach at least one proof of payment."));
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const order = await api.placeCreditOrder({
        planId: selectedPlan.id,
        paymentMethod: method,
        note,
        proofs: proofs.map((p) => p.file),
      });
      router.push(`/credits?order=${encodeURIComponent(order.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not place this order."));
      setSubmitting(false);
    }
  }, [method, note, proofs, router, selectedPlan, submitting, t, user]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="auth-loader" />
      </div>
    );
  }

  if (configError || !config) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-8">
        <div className={CARD_CLASS}>
          <p className="text-sm text-[#ff9a9a]">{configError || t("Could not load the available plans.")}</p>
          <Link href="/credits" className={`${SECONDARY_BUTTON_CLASS} mt-4 inline-block`}>
            {t("Back to Credits")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8 sm:py-12" dir={isRtl ? "rtl" : "ltr"}>
      <div className="mb-6">
        <Link
          href="/credits"
          className="inline-flex items-center gap-1.5 text-sm text-[#c2c6d6] transition hover:text-white"
        >
          <span className="material-symbols-outlined text-[18px] rtl:rotate-180">arrow_back</span>
          {t("Back to Credits")}
        </Link>
        <h1 className="font-headline mt-3 text-3xl font-bold tracking-tight text-blue-50 sm:text-4xl">
          {t("Get Credits")}
        </h1>
      </div>

      <StepIndicator currentStep={step} steps={WIZARD_STEPS} />

      {/* ---------------------------------------------------------------- Step 1 */}
      {step === "plan" && (
        <section>
          <h2 className="mb-4 text-lg font-bold text-white">{t("Choose a plan")}</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {config.plans.map((plan) => {
              const isPopular = plan.id === "pro";
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => goTo({ step: "method", plan: plan.id })}
                  className={`relative flex flex-col items-start gap-1 rounded-xl border p-5 text-start transition hover:-translate-y-0.5 ${
                    isPopular
                      ? "border-[#adc6ff]/50 bg-[#adc6ff]/[0.07]"
                      : "border-white/10 bg-[rgba(25,31,49,0.7)] hover:border-white/20"
                  }`}
                >
                  {isPopular && (
                    <span className="absolute top-3 end-3 rounded-full bg-[#adc6ff]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#adc6ff]">
                      {t("Popular")}
                    </span>
                  )}
                  <span className="text-sm font-semibold uppercase tracking-[0.18em] text-[#c2c6d6]">
                    {plan.name}
                  </span>
                  <span className="mt-2 text-3xl font-bold text-white">
                    {plan.credits.toFixed(0)} <span className="text-lg text-[#adc6ff]">Cr</span>
                  </span>
                  <span className="mt-1 text-sm text-[#c2c6d6]">
                    {formatPrice(plan.priceMinor, plan.currency)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------------- Step 2 */}
      {step === "method" && selectedPlan && (
        <section>
          <h2 className="mb-4 text-lg font-bold text-white">{t("Choose a payment method")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => goTo({ step: "pay", plan: selectedPlan.id, method: "flouci" })}
              className="flex flex-col items-start gap-2 rounded-xl border border-white/10 bg-[rgba(25,31,49,0.7)] p-5 text-start transition hover:-translate-y-0.5 hover:border-[#adc6ff]/40"
            >
              <span className="material-symbols-outlined text-[24px] text-[#adc6ff]">payments</span>
              <span className="text-base font-bold text-white">{t("Tunisian methods")}</span>
              <span className="text-sm text-[#c2c6d6]">
                {t("Flouci, bank transfer. Pay, upload your receipt, and we review it manually.")}
              </span>
            </button>

            <div className="flex flex-col items-start gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-5 opacity-60">
              <span className="material-symbols-outlined text-[24px] text-[#c2c6d6]">lock</span>
              <span className="text-base font-bold text-white">{t("International cards")}</span>
              <span className="text-sm text-[#c2c6d6]">
                {t("Pay by card in USD, credited automatically.")}
              </span>
              <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#c2c6d6]/60">
                {t("Coming soon")}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => goTo({ step: "plan" })}
            className={`${SECONDARY_BUTTON_CLASS} mt-6`}
          >
            {t("Back")}
          </button>
        </section>
      )}

      {/* ---------------------------------------------------------------- Step 3 */}
      {step === "pay" && selectedPlan && isMethodAvailable(method) && (
        <section className="space-y-5">
          {/* Order summary */}
          <div className={CARD_CLASS}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-[#c2c6d6]">{t("Your order")}</p>
                <p className="mt-1 text-xl font-bold text-white">
                  {selectedPlan.name} — {selectedPlan.credits.toFixed(0)} Cr
                </p>
              </div>
              <p className="text-2xl font-bold text-[#adc6ff]">
                {formatPrice(selectedPlan.priceMinor, selectedPlan.currency)}
              </p>
            </div>
          </div>

          {/* Where to pay */}
          <div className={CARD_CLASS}>
            <h2 className="text-lg font-bold text-white">{t("Send your payment")}</h2>
            <p className="mt-1 text-sm text-[#c2c6d6]">
              {t("Pay the amount above using one of the methods below, then upload your receipt.")}
            </p>

            <div className="mt-5 space-y-4">
              {(accounts?.flouciName || accounts?.flouciPhone) && (
                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                  <p className="mb-1 flex items-center gap-2 font-semibold text-white">
                    <span className="material-symbols-outlined text-[19px] text-[#adc6ff]">smartphone</span>
                    {t("Flouci app")}
                  </p>
                  {accounts.flouciName && <CopyableValue label={t("Name")} value={accounts.flouciName} />}
                  {accounts.flouciPhone && <CopyableValue label={t("Phone")} value={accounts.flouciPhone} />}
                </div>
              )}

              {(accounts?.bankRib || accounts?.bankIban) && (
                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                  <p className="mb-1 flex items-center gap-2 font-semibold text-white">
                    <span className="material-symbols-outlined text-[19px] text-[#adc6ff]">account_balance</span>
                    {t("Bank transfer")}
                  </p>
                  {accounts.bankName && <CopyableValue label={t("Bank")} value={accounts.bankName} />}
                  {accounts.bankHolder && <CopyableValue label={t("Account holder")} value={accounts.bankHolder} />}
                  {accounts.bankRib && <CopyableValue label={t("RIB")} value={accounts.bankRib} />}
                  {accounts.bankIban && <CopyableValue label={t("IBAN")} value={accounts.bankIban} />}
                </div>
              )}

              {/* Locked rails, shown so users know they are planned */}
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { id: "d17", label: t("D17"), icon: "credit_card" },
                  { id: "edinar_post", label: t("E-dinar Post"), icon: "local_post_office" },
                ].map((locked) => (
                  <div
                    key={locked.id}
                    className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3 opacity-60"
                  >
                    <span className="material-symbols-outlined text-[19px] text-[#c2c6d6]">{locked.icon}</span>
                    <span className="text-sm font-semibold text-white">{locked.label}</span>
                    <span className="ms-auto text-[10px] font-semibold uppercase tracking-[0.2em] text-[#c2c6d6]/60">
                      {t("Coming soon")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Proof upload */}
          <div className={CARD_CLASS}>
            <h2 className="text-lg font-bold text-white">{t("Upload your payment proof")}</h2>
            <p className="mt-1 text-sm text-[#c2c6d6]">
              {t("Screenshot or PDF receipt. Up to {n} files, 5 MB each.").replace(
                "{n}",
                String(maxProofFiles),
              )}
            </p>

            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(e.dataTransfer.files);
              }}
              className={`mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed px-3 py-8 text-center text-[13px] leading-snug transition ${
                dragging
                  ? "border-[#adc6ff]/60 bg-white/10 text-white"
                  : "border-white/15 bg-white/[.03] text-[#93a0bd] hover:bg-white/[.07] hover:text-white"
              }`}
            >
              <span className="material-symbols-outlined text-[26px]">upload</span>
              {t("Upload or drop your receipt")}
              <input
                type="file"
                accept={PROOF_ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>

            {proofs.length > 0 && (
              <ul className="mt-4 space-y-2">
                {proofs.map((proof) => (
                  <li
                    key={proof.id}
                    className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-2.5"
                  >
                    {proof.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={proof.previewUrl}
                        alt={proof.file.name}
                        className="h-12 w-12 rounded-md object-cover"
                      />
                    ) : (
                      <span className="flex h-12 w-12 items-center justify-center rounded-md bg-white/5">
                        <span className="material-symbols-outlined text-[22px] text-[#adc6ff]">picture_as_pdf</span>
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-white">{proof.file.name}</span>
                      <span className="block text-xs text-[#c2c6d6]">
                        {(proof.file.size / 1024 / 1024).toFixed(2)} MB
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(proof.id)}
                      aria-label={t("Remove")}
                      className="rounded-md border border-white/10 p-1.5 text-[#c2c6d6] transition hover:bg-white/10 hover:text-white"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Optional note */}
            <div className="relative mt-5">
              <textarea
                value={note}
                maxLength={noteMaxLength}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder={t("Anything we should know? (optional)")}
                className="w-full resize-none rounded-md border border-white/10 bg-[#070d1f] p-3 pb-7 text-sm text-white placeholder:text-[#c2c6d6]/40 outline-none transition-all focus:border-[#adc6ff] focus:ring-2 focus:ring-[#adc6ff]/30"
              />
              <span className="absolute bottom-3 end-3 text-[11px] text-[#c2c6d6]/60">
                {note.length}/{noteMaxLength}
              </span>
            </div>

            {error && <p className="mt-3 text-sm text-[#ff9a9a]">{error}</p>}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button type="button" onClick={submit} disabled={submitting} className={PRIMARY_BUTTON_CLASS}>
                {submitting ? t("Sending…") : t("Place order")}
              </button>
              <button
                type="button"
                onClick={() => goTo({ step: "method", plan: selectedPlan.id })}
                className={SECONDARY_BUTTON_CLASS}
              >
                {t("Back")}
              </button>
            </div>

            <p className="mt-4 text-xs text-[#c2c6d6]">
              {t("We review orders manually. You'll get your code on this page once it's approved.")}
            </p>
          </div>

          {/* Help */}
          {accounts?.whatsappNumber && (
            <div className={`${CARD_CLASS} flex flex-wrap items-center justify-between gap-3`}>
              <p className="text-sm text-[#c2c6d6]">{t("Having trouble with your payment?")}</p>
              <a
                href={`https://wa.me/${accounts.whatsappNumber.replace(/[^0-9]/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-[#25d366]/40 bg-[#25d366]/10 px-4 py-2 text-sm font-bold text-[#25d366] transition hover:bg-[#25d366]/20"
              >
                <span className="material-symbols-outlined text-[18px]">chat</span>
                {t("Contact us on WhatsApp")}
              </a>
            </div>
          )}
        </section>
      )}

      {/* A stale/hand-edited URL (unknown plan, locked method) lands here. */}
      {((step === "method" || step === "pay") && !selectedPlan) ||
      (step === "pay" && selectedPlan && !isMethodAvailable(method)) ? (
        <div className={CARD_CLASS}>
          <p className="text-sm text-[#c2c6d6]">{t("Pick a plan to continue.")}</p>
          <button type="button" onClick={() => goTo({ step: "plan" })} className={`${SECONDARY_BUTTON_CLASS} mt-4`}>
            {t("Choose a plan")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function BuyCreditsPage() {
  // useSearchParams needs a Suspense boundary to keep this route from opting the
  // whole segment into client-side bailout during build.
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="auth-loader" />
        </div>
      }
    >
      <BuyCreditsWizard />
    </Suspense>
  );
}
