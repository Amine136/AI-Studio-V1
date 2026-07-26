"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { useLanguage } from "../../../context/LanguageContext";
import { api } from "../../../services/api";
import type { CheckoutConfig, CreditPlan, PaymentMethodOption } from "../../../types";

const WIZARD_STEPS = [
  { key: "plan", label: "Plan" },
  { key: "method", label: "Payment" },
  { key: "pay", label: "Confirm" },
] as const;

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
const WHATSAPP_BUTTON_CLASS =
  "inline-flex items-center gap-2 rounded-md border border-[#25d366]/40 bg-[#25d366]/10 px-4 py-2 text-sm font-bold text-[#25d366] transition hover:bg-[#25d366]/20";

interface ProofFile {
  id: string;
  file: File;
  previewUrl: string | null;
}

/* Segmented progress rather than circles-and-connectors: at three steps the
   circles were mostly empty space, and a filled bar reads as "how far along"
   at a glance. Each segment owns its own label, so it stays legible on a phone
   and mirrors correctly in Arabic without any physical-direction CSS. */
function CheckoutSteps({ current }: { current: string }) {
  const { t } = useLanguage();
  const currentIndex = Math.max(
    0,
    WIZARD_STEPS.findIndex((s) => s.key === current),
  );

  return (
    <div className="mb-8 flex items-start gap-2 sm:gap-3">
      {WIZARD_STEPS.map((step, i) => {
        const isDone = i < currentIndex;
        const isActive = i === currentIndex;
        return (
          <div key={step.key} className="flex flex-1 flex-col gap-2">
            <div
              className={`h-1 rounded-full transition-all duration-500 ${
                isActive
                  ? "bg-[linear-gradient(90deg,#adc6ff,#4d8eff)]"
                  : isDone
                    ? "bg-[#adc6ff]/50"
                    : "bg-white/10"
              }`}
            />
            <span
              className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors sm:text-xs ${
                isActive ? "text-white" : isDone ? "text-[#adc6ff]" : "text-[#c2c6d6]/50"
              }`}
            >
              {isDone ? (
                <span className="material-symbols-outlined text-[14px]">check</span>
              ) : (
                <span className="tabular-nums">{i + 1}</span>
              )}
              {t(step.label)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
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
    <button
      type="button"
      onClick={copy}
      aria-label={t("Copy")}
      className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-[#adc6ff] transition hover:bg-white/10"
    >
      <span className="material-symbols-outlined text-[15px]">{copied ? "check" : "content_copy"}</span>
      {copied ? t("Copied") : t("Copy")}
    </button>
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
  const whatsappNumber = config?.whatsappNumber ?? "";
  // A placeholder like "+216 XXXXXXXX" has too few real digits to dial.
  const whatsappDialable = whatsappNumber.replace(/[^0-9]/g, "").length >= 8;

  const tunisianMethods = useMemo<PaymentMethodOption[]>(
    () => (config?.methods ?? []).filter((m) => m.group === "tunisia"),
    [config],
  );

  const goTo = useCallback(
    (next: Record<string, string>) => {
      const params = new URLSearchParams();
      Object.entries(next).forEach(([key, value]) => value && params.set(key, value));
      router.push(`/credits/buy?${params.toString()}`);
    },
    [router],
  );

  // The URL may carry no method (arriving from step 2) or a locked one (a stale
  // link). Fall back to the first available rail so step 3 always has a valid
  // selection, and submit whatever is actually selected.
  const selectedMethod = useMemo(
    () =>
      tunisianMethods.find((m) => m.id === method && m.available) ??
      tunisianMethods.find((m) => m.available) ??
      null,
    [method, tunisianMethods],
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
    if (!selectedPlan || !selectedMethod || submitting) return;

    if (!user) {
      // Carry the whole wizard state through the wall so they land back here.
      const next = `/credits/buy?step=pay&plan=${selectedPlan.id}&method=${selectedMethod.id}`;
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
        paymentMethod: selectedMethod.id,
        note,
        proofs: proofs.map((p) => p.file),
      });
      router.push(`/credits?order=${encodeURIComponent(order.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not place this order."));
      setSubmitting(false);
    }
  }, [note, proofs, router, selectedMethod, selectedPlan, submitting, t, user]);

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

      <CheckoutSteps current={step} />

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
              onClick={() => goTo({ step: "pay", plan: selectedPlan.id })}
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
      {step === "pay" && selectedPlan && selectedMethod && (
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

          {/* Pick the rail, then read its details. The selected method is what the
              order records, so the admin knows which account to check. */}
          <div className={CARD_CLASS}>
            <h2 className="text-lg font-bold text-white">{t("Send your payment")}</h2>
            <p className="mt-1 text-sm text-[#c2c6d6]">
              {t("Choose how you'll send the money, pay the amount above, then upload your receipt.")}
            </p>

            <div className="mt-5 space-y-3">
              {tunisianMethods.map((option) => {
                const isSelected = option.id === selectedMethod.id;
                const isLocked = !option.available;
                return (
                  <div
                    key={option.id}
                    className={`rounded-lg border transition ${
                      isLocked
                        ? "border-white/10 bg-white/[0.02] opacity-60"
                        : isSelected
                          ? "border-[#adc6ff]/50 bg-[#adc6ff]/[0.06]"
                          : "border-white/10 bg-white/[0.03] hover:border-white/20"
                    }`}
                  >
                    <button
                      type="button"
                      disabled={isLocked}
                      aria-pressed={isSelected}
                      onClick={() => goTo({ step: "pay", plan: selectedPlan.id, method: option.id })}
                      className={`flex w-full items-center gap-3 p-4 text-start ${
                        isLocked ? "cursor-not-allowed" : "cursor-pointer"
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                          isSelected ? "border-[#adc6ff]" : "border-white/25"
                        }`}
                      >
                        {isSelected && <span className="h-2 w-2 rounded-full bg-[#adc6ff]" />}
                      </span>
                      <span className="material-symbols-outlined text-[20px] text-[#adc6ff]">
                        {isLocked ? "lock" : option.icon || "payments"}
                      </span>
                      <span className="flex-1 font-semibold text-white">{t(option.label)}</span>
                      {isLocked && (
                        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#c2c6d6]/60">
                          {t("Coming soon")}
                        </span>
                      )}
                    </button>

                    {isSelected && option.primaryValue && (
                      <div className="border-t border-white/10 px-4 pb-4 pt-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#c2c6d6]/70">
                            {t(option.primaryLabel)}
                          </span>
                          <CopyButton value={option.primaryValue} />
                        </div>
                        <p className="mt-1 select-all break-all font-mono text-base font-bold text-white sm:text-lg">
                          {option.primaryValue}
                        </p>
                        {option.meta.length > 0 && (
                          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#c2c6d6]">
                            {option.meta.map((entry, i) => (
                              <span key={entry} className="flex items-center gap-2">
                                {i > 0 && <span className="text-[#c2c6d6]/40">•</span>}
                                {entry}
                              </span>
                            ))}
                          </p>
                        )}
                      </div>
                    )}

                    {isSelected && !option.primaryValue && (
                      <p className="border-t border-white/10 px-4 pb-4 pt-3 text-sm text-[#c2c6d6]">
                        {t("Account details are being set up. Contact us on WhatsApp to complete this payment.")}
                      </p>
                    )}
                  </div>
                );
              })}
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

            <p className="mt-4 text-xs text-[#c2c6d6]">{t("You'll get your code in 1h max")}</p>
          </div>

          {/* Help */}
          {whatsappNumber && (
            <div className={`${CARD_CLASS} flex flex-wrap items-center justify-between gap-3`}>
              <div>
                <p className="text-sm text-[#c2c6d6]">{t("Having trouble with your payment?")}</p>
                <p className="mt-1 font-mono text-sm text-white">
                  {t("WhatsApp")}: {whatsappNumber}
                </p>
              </div>
              {whatsappDialable ? (
                <a
                  href={`https://wa.me/${whatsappNumber.replace(/[^0-9]/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={WHATSAPP_BUTTON_CLASS}
                >
                  <span className="material-symbols-outlined text-[18px]">chat</span>
                  {t("Contact us on WhatsApp")}
                </a>
              ) : (
                // Placeholder number: show the button so the page reads as
                // finished, but don't link to a wa.me URL that cannot resolve.
                <span className={`${WHATSAPP_BUTTON_CLASS} cursor-default opacity-70`}>
                  <span className="material-symbols-outlined text-[18px]">chat</span>
                  {t("Contact us on WhatsApp")}
                </span>
              )}
            </div>
          )}
        </section>
      )}

      {/* A stale/hand-edited URL (unknown plan, or no rail open at all) lands here. */}
      {((step === "method" || step === "pay") && !selectedPlan) ||
      (step === "pay" && selectedPlan && !selectedMethod) ? (
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
