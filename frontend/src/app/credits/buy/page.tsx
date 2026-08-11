"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { useLanguage } from "../../../context/LanguageContext";
import { api } from "../../../services/api";
import { trackInitiateCheckout } from "../../../lib/pixel";
import type {
  CheckoutConfig,
  CreditPlan,
  PaymentMethodOption,
  SystemConfig,
} from "../../../types";

/* The progress bar covers the checkout itself. The two screens before it — the
   Tunisian/international choice and the card "coming soon" panel — are not steps
   of a purchase, so they render without the bar. */
const WIZARD_STEPS = [
  { key: "plan", label: "Plan" },
  { key: "method", label: "Payment" },
  { key: "pay", label: "Confirm" },
] as const;

const STEP_KEYS = ["rail", "card", "card-return", ...WIZARD_STEPS.map((s) => s.key)] as string[];

const PROOF_ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";
const PROOF_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

// TND is a 3-decimal currency, so prices arrive as millimes. Whole dinars are the
// common case (15.000 DT), so trim the trailing zeros rather than always showing 3.
const formatPrice = (priceMinor: number, currency: string) => {
  const amount = priceMinor / 1000;
  const text = Number.isInteger(amount) ? String(amount) : amount.toFixed(3).replace(/0+$/, "");
  return currency === "TND" ? `${text} DT` : `${text} ${currency}`;
};

const perCreditMinor = (plan: CreditPlan) => (plan.credits > 0 ? plan.priceMinor / plan.credits : 0);

/* The per-credit rate is a comparison figure, not a charge, so it takes a fixed
   2 decimals: formatPrice trims zeros, which left the three plans reading
   "1.5 / 1.114 / 0.986" — a ragged column is a column nobody compares. */
const formatRate = (rateMinor: number, currency: string) => {
  const text = (rateMinor / 1000).toFixed(2);
  return currency === "TND" ? `${text} DT` : `${text} ${currency}`;
};

// USD is a 2-decimal currency (cents, not millimes) — a SEPARATE pair of
// formatters rather than branching formatPrice/formatRate, since those two
// divide by 1000 unconditionally and would render $4.99 as "0.499 USD".
const formatPriceUsd = (priceMinor: number) => `$${(priceMinor / 100).toFixed(2)}`;
const formatRateUsd = (rateMinor: number) => `$${(rateMinor / 100).toFixed(2)}`;

/* What a credit actually buys, taken from the live model catalogue rather than a
   marketing number that would drift the moment pricing changes. Each model is
   reduced to its cheapest tier (what you pay at that model's standard setting),
   and the median of those is "a typical image" — a mean would be dragged around
   by the one 4K premium model. Returns null when the catalogue is unavailable,
   and the estimate is simply not rendered. */
const typicalImageRate = (config: SystemConfig | null): number | null => {
  const catalog = config?.model_catalog?.image;
  if (!catalog || typeof catalog !== "object") return null;

  const perModel: number[] = [];
  for (const entry of Object.values(catalog)) {
    const billing = (entry as { billing?: Record<string, any> })?.billing;
    if (!billing) continue;
    const image = billing.image || billing;
    const prices: number[] = [];
    for (const key of ["imageSizePrices", "sampleImageSizePrices"]) {
      if (image?.[key] && typeof image[key] === "object") {
        prices.push(...Object.values(image[key] as Record<string, unknown>).map(Number));
      }
    }
    if (!prices.length && image?.basePrice != null) prices.push(Number(image.basePrice));
    if (!prices.length && billing.fixed?.amount != null) prices.push(Number(billing.fixed.amount));
    const valid = prices.filter((n) => Number.isFinite(n) && n > 0);
    if (valid.length) perModel.push(Math.min(...valid));
  }

  if (!perModel.length) return null;
  perModel.sort((a, b) => a - b);
  const mid = perModel.length / 2;
  return perModel.length % 2
    ? perModel[Math.floor(mid)]
    : (perModel[mid - 1] + perModel[mid]) / 2;
};

/* Rounded down to a round number: the median sits between two catalogue prices,
   so an exact figure would swing on any model being added. Down, never up — an
   estimate that overshoots what you actually get is worse than no estimate. */
const estimateImages = (credits: number, rate: number) => {
  const raw = Math.floor(credits / rate);
  return raw >= 20 ? Math.floor(raw / 5) * 5 : raw;
};

/* Every literal below is a class token the light-theme remap in globals.css knows
   about ([data-theme="light"] [class~="…"]). Introducing a new hex/alpha token
   here without adding a matching rule there leaves it dark-on-light. */
const CARD_CLASS =
  "rounded-xl border border-white/10 bg-[rgba(25,31,49,0.7)] backdrop-blur-xl";
const CARD_PADDED = `${CARD_CLASS} p-5 sm:p-6`;
const PRIMARY_BUTTON_CLASS =
  "rounded-md bg-[linear-gradient(90deg,#adc6ff,#4d8eff)] px-8 py-3 font-bold text-[#002e6a] shadow-lg shadow-[#adc6ff]/10 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-60";
const SECONDARY_BUTTON_CLASS =
  "rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm text-[#adc6ff] transition hover:bg-white/10";
const WHATSAPP_BUTTON_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-md border border-[#25d366]/40 bg-[#25d366]/10 px-4 py-2 text-sm font-bold text-[#25d366] transition hover:bg-[#25d366]/20";
const CHIP_CLASS =
  "rounded-full bg-[#adc6ff]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#adc6ff]";
const EYEBROW_CLASS = "text-[11px] font-semibold uppercase tracking-[0.22em] text-[#93a0bd]";

interface ProofFile {
  id: string;
  file: File;
  previewUrl: string | null;
}

/* Segmented progress rather than circles-and-connectors: at three steps the
   circles were mostly empty space, and a filled bar reads as "how far along"
   at a glance. Each segment owns its own label, so it stays legible on a phone
   and mirrors correctly in Arabic without any physical-direction CSS.
   Completed segments are buttons — the fastest way back is the step you can see. */
function CheckoutSteps({
  current,
  onJump,
}: {
  current: string;
  onJump: (key: string) => void;
}) {
  const { t } = useLanguage();
  const currentIndex = Math.max(
    0,
    WIZARD_STEPS.findIndex((s) => s.key === current),
  );

  return (
    <div className="mb-5 flex items-start gap-2 sm:mb-7 sm:gap-3">
      {WIZARD_STEPS.map((step, i) => {
        const isDone = i < currentIndex;
        const isActive = i === currentIndex;
        const label = (
          <span
            className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors sm:text-xs ${
              isActive ? "text-white" : isDone ? "text-[#adc6ff]" : "text-[#93a0bd]"
            }`}
          >
            {isDone ? (
              <span className="material-symbols-outlined text-[14px]">check</span>
            ) : (
              <span className="tabular-nums">{i + 1}</span>
            )}
            {t(step.label)}
          </span>
        );

        return (
          <div key={step.key} className="flex flex-1 flex-col gap-2">
            <div
              className={`h-1 rounded-full transition-all duration-500 ${
                isActive
                  ? "bg-[linear-gradient(90deg,#adc6ff,#4d8eff)]"
                  : isDone
                    ? "bg-[#adc6ff]/30"
                    : "bg-white/10"
              }`}
            />
            {isDone ? (
              <button type="button" onClick={() => onJump(step.key)} className="text-start">
                {label}
              </button>
            ) : (
              label
            )}
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
      /* The spaces in these values are print formatting — "27 666 467" is grouped
         to be read off a screen, and an IBAN is grouped on the RIB. Nothing you
         paste into pays attention to them: Flouci wants 8 digits and the IBAN's
         electronic form is unspaced. Copy the machine form and leave the grouped
         one on screen. */
      await navigator.clipboard.writeText(value.replace(/\s+/g, ""));
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
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-[#adc6ff] transition hover:bg-white/10"
    >
      <span className="material-symbols-outlined text-[15px]">
        {copied ? "check" : "content_copy"}
      </span>
      {copied ? t("Copied") : t("Copy")}
    </button>
  );
}

/* The three things a first-time buyer wants to know before picking a number.
   It also gives step 1 a second band of content — three price cards alone left
   two thirds of a desktop screen empty. */
function HowItWorks() {
  const { t } = useLanguage();
  const steps = [
    { icon: "checklist", label: "Choose a plan" },
    { icon: "receipt_long", label: "Pay and upload your receipt" },
    { icon: "confirmation_number", label: "Get your code in 1h max" },
  ];

  return (
    <div className={`${CARD_CLASS} mt-6 p-5 sm:mt-8 sm:p-6`}>
      <p className={EYEBROW_CLASS}>{t("How it works")}</p>
      <ol className="mt-4 grid gap-4 sm:grid-cols-3 sm:gap-5">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#adc6ff]/10">
              <span className="material-symbols-outlined text-[19px] text-[#adc6ff]">{s.icon}</span>
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] font-bold uppercase tracking-[0.2em] text-[#93a0bd]">
                {i + 1}
              </span>
              <span className="block text-sm font-semibold text-white">{t(s.label)}</span>
            </span>
          </li>
        ))}
      </ol>
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
  const [imageRate, setImageRate] = useState<number | null>(null);
  // Bars grow from empty once mounted, so the size difference between the plans
  // is something you watch happen rather than three static lengths.
  const [barsIn, setBarsIn] = useState(false);

  const [proofs, setProofs] = useState<ProofFile[]>([]);
  const [note, setNote] = useState("");
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Card checkout has no separate "confirm" step — tapping a plan starts the
  // Dodo session immediately, so the only local state it needs is which plan
  // (for the spinner) and any error from starting the session.
  const [payingPlanId, setPayingPlanId] = useState<string | null>(null);
  const [cardError, setCardError] = useState("");

  /* "rail" is the landing screen — which family of payment you want — and it is
     also where anything unrecognised lands. Falling back to "plan" would have a
     hand-edited or stale ?step= silently skip the choice. */
  const requestedStep = searchParams.get("step") || "rail";
  const step = STEP_KEYS.includes(requestedStep) ? requestedStep : "rail";
  const planId = searchParams.get("plan") || "";
  const method = searchParams.get("method") || "";
  /* Dodo appends its own `status` (and `payment_id`) to the return_url on
     redirect -- see docs.dodopayments.com/developer-resources/checkout-session.
     Anything other than "succeeded"/"active" means no charge went through, so
     the return page must not show the same checkmark it shows on success. */
  const dodoStatus = searchParams.get("status") || "";
  const dodoFailed =
    dodoStatus !== "" && dodoStatus !== "succeeded" && dodoStatus !== "active";
  const dodoCancelled = dodoFailed && dodoStatus === "cancelled";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getCheckoutConfig();
        if (!cancelled) setConfig(data);
      } catch (err) {
        if (!cancelled) {
          setConfigError(
            err instanceof Error ? err.message : t("Could not load the available plans."),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  /* Strictly additive, and deliberately not part of the gate above: the model
     catalogue is a big payload on a page whose job is taking a payment. If it is
     slow or down, checkout still renders and the estimate just never appears. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const system = await api.getConfig();
        if (!cancelled) setImageRate(typicalImageRate(system));
      } catch {
        // No estimate is a better answer than a made-up one.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => setBarsIn(true), 60);
    return () => window.clearTimeout(id);
  }, []);

  // Object URLs for the local previews are revoked on unmount; the per-file remove
  // path revokes its own.
  const uploadRef = useRef<HTMLDivElement | null>(null);
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

  /* Step 2 is now reached only from the Tunisian branch, so it lists Tunisian
     rails and nothing else. International cards are answered one screen earlier,
     where they are a branch rather than a row you can't press. */
  const tunisianMethods = useMemo<PaymentMethodOption[]>(
    () => (config?.methods ?? []).filter((m) => m.group === "tunisia"),
    [config],
  );

  // The cheapest plan per credit sets the reference; the savings badge is plain
  // arithmetic on the server's own prices, never a claim we invent.
  const worstRate = useMemo(
    () => Math.max(0, ...(config?.plans ?? []).map(perCreditMinor)),
    [config],
  );

  // The "Best rate" chip is only meaningful if exactly one plan holds it — two
  // plans wearing the same badge says nothing.
  const soleBestRate = useMemo(() => {
    const rates = (config?.plans ?? []).map(perCreditMinor).filter((r) => r > 0);
    if (rates.length < 2) return null;
    const best = Math.min(...rates);
    return rates.filter((r) => r === best).length === 1 ? best : null;
  }, [config]);

  // Bar lengths are relative to the biggest plan, so the jump from 10 to 70 Cr
  // is a length you can see instead of arithmetic you have to do.
  const maxCredits = useMemo(
    () => Math.max(1, ...(config?.plans ?? []).map((p) => p.credits)),
    [config],
  );

  // Same three derivations, off config.plansUsd — kept separate from the TND
  // ones above rather than parameterised, since the two rails are priced
  // independently and could diverge in count/credits later.
  const worstRateUsd = useMemo(
    () => Math.max(0, ...(config?.plansUsd ?? []).map(perCreditMinor)),
    [config],
  );
  const soleBestRateUsd = useMemo(() => {
    const rates = (config?.plansUsd ?? []).map(perCreditMinor).filter((r) => r > 0);
    if (rates.length < 2) return null;
    const best = Math.min(...rates);
    return rates.filter((r) => r === best).length === 1 ? best : null;
  }, [config]);
  const maxCreditsUsd = useMemo(
    () => Math.max(1, ...(config?.plansUsd ?? []).map((p) => p.credits)),
    [config],
  );

  const payWithCard = useCallback(
    async (plan: CreditPlan) => {
      if (!user) {
        router.push(`/auth?next=${encodeURIComponent("/credits/buy?step=card")}`);
        return;
      }
      setCardError("");
      setPayingPlanId(plan.id);
      trackInitiateCheckout(plan);
      try {
        const { checkoutUrl } = await api.createDodoCheckout(plan.id);
        window.location.href = checkoutUrl;
      } catch (err) {
        setCardError(err instanceof Error ? err.message : t("Could not start checkout."));
        setPayingPlanId(null);
      }
    },
    [router, t, user],
  );

  const goTo = useCallback(
    (next: Record<string, string>) => {
      const params = new URLSearchParams();
      Object.entries(next).forEach(([key, value]) => value && params.set(key, value));
      router.push(`/credits/buy?${params.toString()}`);
    },
    [router],
  );

  // The URL may carry no method (a stale link from before step 2 asked for one)
  // or a locked one. Fall back to the first available rail so step 3 always has a
  // valid selection, and submit whatever is actually selected.
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
      // The phone CTA is a fixed bar, so the upload card it complains about can
      // be off-screen. Without this the tap looks like it did nothing.
      uploadRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setSubmitting(true);
    setError("");
    trackInitiateCheckout(selectedPlan);
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
        <div className={CARD_PADDED}>
          <p className="text-sm text-[#ffb4ab]">
            {configError || t("Could not load the available plans.")}
          </p>
          <Link href="/credits" className={`${SECONDARY_BUTTON_CLASS} mt-4 inline-block`}>
            {t("Back to Credits")}
          </Link>
        </div>
      </div>
    );
  }

  /* Rendered twice — in the desktop aside, and last on a phone. Support belongs
     after the thing it supports: DOM-ordering the aside first put "Having trouble
     with your payment?" between the order and the account number. */
  const helpCard = whatsappNumber ? (
    <div className={CARD_PADDED}>
      <p className="text-sm text-[#c2c6d6]">{t("Having trouble with your payment?")}</p>
      {/* Same bidi trap as the account number above: without dir="ltr" this shows
          as "039 190 48 216+" in Arabic. */}
      <p className="mt-1 break-all font-mono text-sm text-white">
        <span dir="ltr">{whatsappNumber}</span>
      </p>
      {whatsappDialable ? (
        <a
          href={`https://wa.me/${whatsappNumber.replace(/[^0-9]/g, "")}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${WHATSAPP_BUTTON_CLASS} mt-3 w-full`}
        >
          <span className="material-symbols-outlined text-[18px]">chat</span>
          {t("Contact us on WhatsApp")}
        </a>
      ) : (
        // Placeholder number: show the button so the page reads as finished, but
        // don't link to a wa.me URL that cannot resolve.
        <span className={`${WHATSAPP_BUTTON_CLASS} mt-3 w-full cursor-default opacity-70`}>
          <span className="material-symbols-outlined text-[18px]">chat</span>
          {t("Contact us on WhatsApp")}
        </span>
      )}
    </div>
  ) : null;

  /* The two branches on the landing screen. A tall card rather than a method
     row: this is the choice that decides how the whole purchase works, so each
     branch gets room to say what paying that way is actually like, and the two
     sit side by side as a fork rather than a list you scan. */
  const railCard = ({
    icon,
    title,
    body,
    soon,
    onClick,
  }: {
    icon: string;
    title: string;
    body: string;
    soon?: boolean;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col rounded-xl border p-5 text-start transition sm:p-6 ${
        soon
          ? "border-white/10 bg-[rgba(25,31,49,0.7)] hover:border-white/20 hover:bg-white/5"
          : "border-[#adc6ff]/40 bg-[#adc6ff]/10 shadow-lg shadow-[#adc6ff]/10 hover:border-[#adc6ff]/60"
      }`}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#adc6ff]/10">
        <span className="material-symbols-outlined text-[22px] text-[#adc6ff]">{icon}</span>
      </span>
      <span className="mt-4 block text-lg font-bold text-white">{title}</span>
      {/* flex-1 so the footer line sits on the same baseline in both cards
          however long the description runs. */}
      <span className="mt-2 block flex-1 text-sm text-[#c2c6d6]">{body}</span>
      {soon ? (
        <span className="mt-5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#93a0bd]">
          <span className="material-symbols-outlined text-[15px]">lock</span>
          {t("Coming soon")}
        </span>
      ) : (
        <span className="mt-5 flex items-center gap-1.5 text-sm font-bold text-[#adc6ff]">
          {t("Choose")}
          <span className="material-symbols-outlined text-[16px] rtl:rotate-180">
            arrow_forward
          </span>
        </span>
      )}
    </button>
  );

  const methodRow = (option: PaymentMethodOption) => {
    const isLocked = !option.available;
    // Highlight only what the URL actually carries. `selectedMethod` falls back to
    // the first available rail, which would pre-select Flouci on a step the user
    // has not answered yet.
    const isSelected = !isLocked && option.id === method;
    return (
      <button
        key={option.id}
        type="button"
        disabled={isLocked}
        aria-pressed={isSelected}
        onClick={() => goTo({ step: "pay", plan: planId, method: option.id })}
        className={`flex items-center gap-3 rounded-xl border p-4 text-start transition ${
          isLocked
            ? "cursor-not-allowed border-white/10 bg-white/[0.02] opacity-60"
            : isSelected
              ? "border-[#adc6ff]/40 bg-[#adc6ff]/10"
              : "border-white/10 bg-[rgba(25,31,49,0.7)] hover:border-[#adc6ff]/30 hover:bg-white/5"
        }`}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#adc6ff]/10">
          <span className="material-symbols-outlined text-[20px] text-[#adc6ff]">
            {isLocked ? "lock" : option.icon || "payments"}
          </span>
        </span>
        {/* Only the rail's own name: a locked row carries the "Coming soon"
            badge, which says everything a subtitle would. */}
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-white">{t(option.label)}</span>
        </span>
        {isLocked ? (
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#93a0bd]">
            {t("Coming soon")}
          </span>
        ) : (
          <span className="material-symbols-outlined shrink-0 text-[18px] text-[#adc6ff] rtl:rotate-180">
            arrow_forward
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-8 sm:py-12" dir={isRtl ? "rtl" : "ltr"}>
      <div className="mb-5 sm:mb-6">
        <Link
          href="/credits"
          className="inline-flex items-center gap-1.5 text-sm text-[#c2c6d6] transition hover:text-white"
        >
          <span className="material-symbols-outlined text-[18px] rtl:rotate-180">arrow_back</span>
          {t("Back to Credits")}
        </Link>
        {/* Smaller on a phone: the old 3xl title plus py-8 ate a third of the
            viewport before the first plan. */}
        <h1 className="font-headline mt-2 text-2xl font-bold tracking-tight text-blue-50 sm:mt-3 sm:text-4xl">
          {t("Get Credits")}
        </h1>
      </div>

      {/* Only over the checkout itself. CheckoutSteps clamps an unknown step to
          index 0, so rendering it on "rail" or "card" would light up PLAN on a
          screen that is not Plan. */}
      {WIZARD_STEPS.some((s) => s.key === step) && (
        <CheckoutSteps
          current={step}
          onJump={(key) => goTo(key === "plan" ? { step: "plan" } : { step: key, plan: planId })}
        />
      )}

      {/* ---------------------------------------------------------------- Rail */}
      {step === "rail" && (
        /* Narrower than the wizard behind it: two cards stretched across the
           full 5xl read as a half-empty page, and a fork is easier to answer
           when both options are in one glance. */
        <section className="mx-auto w-full max-w-3xl">
          <h2 className="text-lg font-bold text-white">{t("How do you want to pay?")}</h2>
          <p className="mb-5 mt-1 text-sm text-[#c2c6d6]">
            {t("Both rails are live: Tunisian methods and international cards.")}
          </p>

          <div className="grid items-stretch gap-4 sm:grid-cols-2">
            {railCard({
              icon: "account_balance_wallet",
              title: t("Tunisian methods"),
              body: t("Flouci, bank transfer. Pay, upload your receipt, and we review it manually."),
              onClick: () => goTo({ step: "plan" }),
            })}
            {railCard({
              icon: "credit_card",
              title: t("International cards"),
              body: t("Pay by card in USD, credited automatically."),
              onClick: () => goTo({ step: "card" }),
            })}
          </div>
          {/* No "How it works" here: it describes the manual Tunisian flow —
              pay, upload, wait for review — which is only one of these two
              branches. It belongs after the branch is chosen. */}
        </section>
      )}

      {/* ------------------------------------------------------- Cards: not yet */}
      {step === "card" && (
        <section>
          <h2 className="text-lg font-bold text-white">{t("Pay by card, in USD")}</h2>
          <p className="mb-5 mt-1 text-sm text-[#c2c6d6]">
            {t("Credits are added automatically once the payment goes through.")}
          </p>

          <div className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(config.plansUsd ?? []).map((plan) => {
              const isPopular = plan.id === "pro";
              const rate = perCreditMinor(plan);
              const savePct = worstRateUsd > 0 ? Math.round((1 - rate / worstRateUsd) * 100) : 0;
              const isBestRate = soleBestRateUsd != null && rate === soleBestRateUsd;
              const images = imageRate ? estimateImages(plan.credits, imageRate) : null;
              const fill = Math.max(0.06, plan.credits / maxCreditsUsd);
              const isPaying = payingPlanId === plan.id;
              return (
                <button
                  key={plan.id}
                  type="button"
                  disabled={payingPlanId !== null}
                  onClick={() => payWithCard(plan)}
                  className={`group relative flex flex-col rounded-xl border p-4 text-start transition disabled:cursor-not-allowed disabled:opacity-60 sm:p-5 sm:hover:-translate-y-1 ${
                    isPopular
                      ? "border-[#adc6ff]/40 bg-[#adc6ff]/10 shadow-lg shadow-[#adc6ff]/10 lg:-translate-y-2"
                      : "border-white/10 bg-[rgba(25,31,49,0.7)] hover:border-[#adc6ff]/30"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 sm:block">
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 sm:min-h-[22px] sm:justify-between">
                        <span className={EYEBROW_CLASS}>{plan.name}</span>
                        {isPopular ? (
                          <span className={CHIP_CLASS}>{t("Popular")}</span>
                        ) : isBestRate ? (
                          <span className={CHIP_CLASS}>{t("Best rate")}</span>
                        ) : null}
                      </span>

                      <span className="mt-1.5 block text-3xl font-bold leading-none text-white sm:mt-4 sm:text-4xl">
                        <span dir="ltr">
                          {plan.credits.toFixed(0)}
                          <span className="ms-1.5 text-base font-bold text-[#adc6ff] sm:text-lg">
                            Cr
                          </span>
                        </span>
                      </span>

                      <span className="mt-1 block min-h-[18px] text-sm font-semibold text-[#adc6ff]">
                        {images ? (
                          <span dir="ltr">{t("~{n} images").replace("{n}", String(images))}</span>
                        ) : (
                          ""
                        )}
                      </span>
                    </span>

                    <span className="shrink-0 text-end sm:block sm:text-start">
                      <span className="block text-xl font-bold text-white sm:mt-4">
                        <span dir="ltr">{formatPriceUsd(plan.priceMinor)}</span>
                      </span>

                      <span className="mt-0.5 block text-[11px] tabular-nums text-[#93a0bd] sm:mt-1">
                        <span dir="ltr">{formatRateUsd(rate)}</span> {t("per credit")}
                      </span>

                      <span className="mt-0.5 block text-xs font-bold text-[#adc6ff] sm:min-h-[16px]">
                        {savePct >= 5 ? t("Save {n}%").replace("{n}", String(savePct)) : ""}
                      </span>
                    </span>

                    <span className="shrink-0 sm:hidden">
                      {isPaying ? (
                        <span
                          className="auth-loader"
                          style={{ width: 16, height: 16, borderWidth: 2 }}
                        />
                      ) : (
                        <span className="material-symbols-outlined text-[20px] text-[#adc6ff] rtl:rotate-180">
                          arrow_forward
                        </span>
                      )}
                    </span>
                  </div>

                  <span className="mt-3 mb-1 block h-2 overflow-hidden rounded-full bg-white/10 sm:mt-4 sm:mb-2">
                    <span
                      className="block h-full w-full rounded-full bg-[linear-gradient(90deg,#adc6ff,#4d8eff)] transition-transform duration-700 ease-out motion-reduce:transition-none"
                      style={{
                        transform: `scaleX(${barsIn ? fill : 0})`,
                        transformOrigin: isRtl ? "right" : "left",
                      }}
                    />
                  </span>

                  <span className="mt-4 hidden items-center justify-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-[#adc6ff] transition group-hover:border-[#adc6ff]/30 group-hover:bg-white/10 sm:mt-auto sm:flex">
                    {isPaying ? (
                      <span
                        className="auth-loader"
                        style={{ width: 16, height: 16, borderWidth: 2 }}
                      />
                    ) : (
                      <>
                        {t("Pay with card")}
                        <span className="material-symbols-outlined text-[16px] rtl:rotate-180">
                          arrow_forward
                        </span>
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {cardError && (
            <p className="mt-4 rounded-md border border-white/10 bg-[#93000a]/10 px-3 py-2 text-sm text-[#ffb4ab]">
              {cardError}
            </p>
          )}

          {imageRate && (
            <p className="mt-3 text-xs text-[#93a0bd]">
              <span dir="ltr">
                {t("Typical image ≈ {n} Cr").replace("{n}", imageRate.toFixed(2))}
              </span>{" "}
              {t("Cost varies by model.")}{" "}
              <Link
                href="/pricing"
                className="font-semibold text-[#adc6ff] underline-offset-4 hover:underline"
              >
                {t("See full pricing")}
              </Link>
            </p>
          )}

          {/* Outside the imageRate guard: the refund terms apply to every
              purchase, and this is the last screen before money moves. */}
          <p className="mt-2 text-xs text-[#93a0bd]">
            {t("Purchases are subject to our credit and refund rules.")}{" "}
            <Link
              href="/policy"
              className="font-semibold text-[#adc6ff] underline-offset-4 hover:underline"
            >
              {t("Read the policy")}
            </Link>
          </p>

          <button
            type="button"
            onClick={() => goTo({ step: "rail" })}
            className={`${SECONDARY_BUTTON_CLASS} mt-6`}
          >
            {t("Back")}
          </button>

          {whatsappNumber && <div className="mt-5">{helpCard}</div>}
        </section>
      )}

      {/* ------------------------------------------------------ Card: returned */}
      {step === "card-return" && dodoFailed && (
        <section className="mx-auto w-full max-w-xl">
          <div className={`${CARD_PADDED} text-center`}>
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10">
              <span className="material-symbols-outlined text-[28px] text-red-400">
                error
              </span>
            </span>
            <h2 className="mt-4 text-xl font-bold text-white sm:text-2xl">
              {dodoCancelled ? t("Checkout cancelled") : t("Payment failed")}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-[#c2c6d6]">
              {dodoCancelled
                ? t("You cancelled before paying. No charge was made and no credits were added.")
                : t("Your card was declined. No charge was made and no credits were added.")}
            </p>
            <button
              type="button"
              onClick={() => goTo({ step: "rail" })}
              className={`${PRIMARY_BUTTON_CLASS} mt-6`}
            >
              {t("Try again")}
            </button>
            {whatsappNumber && <div className="mt-5">{helpCard}</div>}
          </div>
        </section>
      )}

      {step === "card-return" && !dodoFailed && (
        <section className="mx-auto w-full max-w-xl">
          <div className={`${CARD_PADDED} text-center`}>
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#adc6ff]/10">
              <span className="material-symbols-outlined text-[28px] text-[#adc6ff]">
                check_circle
              </span>
            </span>
            <h2 className="mt-4 text-xl font-bold text-white sm:text-2xl">
              {t("Thanks!")}
            </h2>
            {/* Crediting happens off a webhook, not this redirect, so this can
                arrive a few seconds before the balance actually updates — the
                page says so rather than claiming a success it hasn't confirmed. */}
            <p className="mx-auto mt-2 max-w-md text-sm text-[#c2c6d6]">
              {t(
                "If your payment went through, your credits will appear within a minute or two.",
              )}
            </p>
            <Link href="/credits" className={`${PRIMARY_BUTTON_CLASS} mt-6 inline-block`}>
              {t("Check my balance")}
            </Link>
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------------- Step 1 */}
      {step === "plan" && (
        <section>
          <h2 className="text-lg font-bold text-white">{t("Choose a plan")}</h2>
          <p className="mb-5 mt-1 text-sm text-[#c2c6d6]">
            {t("Bigger plans cost less per credit.")}
          </p>

          <div className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {config.plans.map((plan) => {
              const isPopular = plan.id === "pro";
              const rate = perCreditMinor(plan);
              const savePct = worstRate > 0 ? Math.round((1 - rate / worstRate) * 100) : 0;
              const isBestRate = soleBestRate != null && rate === soleBestRate;
              const images = imageRate ? estimateImages(plan.credits, imageRate) : null;
              const fill = Math.max(0.06, plan.credits / maxCredits);
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => goTo({ step: "method", plan: plan.id })}
                  className={`group relative flex flex-col rounded-xl border p-4 text-start transition sm:p-5 sm:hover:-translate-y-1 ${
                    isPopular
                      ? "border-[#adc6ff]/40 bg-[#adc6ff]/10 shadow-lg shadow-[#adc6ff]/10 lg:-translate-y-2"
                      : "border-white/10 bg-[rgba(25,31,49,0.7)] hover:border-[#adc6ff]/30"
                  }`}
                >
                  {/* On a phone the card is a row — credits at the start, price at
                      the end — so all three plans fit one screen and can actually
                      be compared. From sm it unwraps back into the tall card. */}
                  <div className="flex items-center justify-between gap-3 sm:block">
                    <span className="min-w-0">
                      {/* Fixed height from sm so the three cards' numbers line up
                          whether or not the card carries a badge. */}
                      <span className="flex items-center gap-2 sm:min-h-[22px] sm:justify-between">
                        <span className={EYEBROW_CLASS}>{plan.name}</span>
                        {isPopular ? (
                          <span className={CHIP_CLASS}>{t("Popular")}</span>
                        ) : isBestRate ? (
                          <span className={CHIP_CLASS}>{t("Best rate")}</span>
                        ) : null}
                      </span>

                      <span className="mt-1.5 block text-3xl font-bold leading-none text-white sm:mt-4 sm:text-4xl">
                        <span dir="ltr">
                          {plan.credits.toFixed(0)}
                          <span className="ms-1.5 text-base font-bold text-[#adc6ff] sm:text-lg">
                            Cr
                          </span>
                        </span>
                      </span>

                      {/* What the credits are actually for. Reserved height so the
                          cards don't shift when the catalogue lands. */}
                      <span className="mt-1 block min-h-[18px] text-sm font-semibold text-[#adc6ff]">
                        {images ? (
                          <span dir="ltr">{t("~{n} images").replace("{n}", String(images))}</span>
                        ) : (
                          ""
                        )}
                      </span>
                    </span>

                    <span className="shrink-0 text-end sm:block sm:text-start">
                      <span className="block text-xl font-bold text-white sm:mt-4">
                        <span dir="ltr">{formatPrice(plan.priceMinor, plan.currency)}</span>
                      </span>

                      <span className="mt-0.5 block text-[11px] tabular-nums text-[#93a0bd] sm:mt-1">
                        <span dir="ltr">{formatRate(rate, plan.currency)}</span> {t("per credit")}
                      </span>

                      <span className="mt-0.5 block text-xs font-bold text-[#adc6ff] sm:min-h-[16px]">
                        {savePct >= 5 ? t("Save {n}%").replace("{n}", String(savePct)) : ""}
                      </span>
                    </span>

                    {/* The whole card is the button, so on a phone a chevron says
                        "tappable" in the space a repeated Choose button wanted.
                        The `sm:hidden` has to sit on a plain wrapper: the Material
                        Symbols stylesheet sets `display:inline-block` unlayered,
                        which beats the utility on the icon itself. */}
                    <span className="shrink-0 sm:hidden">
                      <span className="material-symbols-outlined text-[20px] text-[#adc6ff] rtl:rotate-180">
                        arrow_forward
                      </span>
                    </span>
                  </div>

                  {/* How much you're buying, as a length. scaleX rather than an
                      animated width so it composites; the origin is set from the
                      language, since in Arabic the bar has to grow from the right. */}
                  <span className="mt-3 mb-1 block h-2 overflow-hidden rounded-full bg-white/10 sm:mt-4 sm:mb-2">
                    <span
                      className="block h-full w-full rounded-full bg-[linear-gradient(90deg,#adc6ff,#4d8eff)] transition-transform duration-700 ease-out motion-reduce:transition-none"
                      style={{
                        transform: `scaleX(${barsIn ? fill : 0})`,
                        transformOrigin: isRtl ? "right" : "left",
                      }}
                    />
                  </span>

                  {/* Full-width footer CTA: the card is the button, so this reads
                      as the card's own action rather than a chip floating in it. */}
                  <span className="mt-4 hidden items-center justify-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-[#adc6ff] transition group-hover:border-[#adc6ff]/30 group-hover:bg-white/10 sm:mt-auto sm:flex">
                    {t("Choose")}
                    <span className="material-symbols-outlined text-[16px] rtl:rotate-180">
                      arrow_forward
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* The estimate above is an estimate, and says so here rather than in a
              per-card asterisk: the rate it assumes, and where to check the real
              per-model prices. */}
          {imageRate && (
            <p className="mt-3 text-xs text-[#93a0bd]">
              <span dir="ltr">
                {t("Typical image ≈ {n} Cr").replace("{n}", imageRate.toFixed(2))}
              </span>{" "}
              {t("Cost varies by model.")}{" "}
              <Link
                href="/pricing"
                className="font-semibold text-[#adc6ff] underline-offset-4 hover:underline"
              >
                {t("See full pricing")}
              </Link>
            </p>
          )}

          <p className="mt-2 text-xs text-[#93a0bd]">
            {t("Purchases are subject to our credit and refund rules.")}{" "}
            <Link
              href="/policy"
              className="font-semibold text-[#adc6ff] underline-offset-4 hover:underline"
            >
              {t("Read the policy")}
            </Link>
          </p>

          <HowItWorks />

          {/* Step 1 is no longer the first screen, so it needs the same way back
              the later steps have. */}
          <button
            type="button"
            onClick={() => goTo({ step: "rail" })}
            className={`${SECONDARY_BUTTON_CLASS} mt-6`}
          >
            {t("Back")}
          </button>
        </section>
      )}

      {/* ---------------------------------------------------------------- Step 2 */}
      {step === "method" && selectedPlan && (
        <section>
          <h2 className="mb-1 text-lg font-bold text-white">{t("Choose a payment method")}</h2>
          <p className="mb-5 text-sm text-[#c2c6d6]">
            {t("You'll see the account details on the next step.")}
          </p>

          {/* Which plan this is for. Step 2 used to show nothing about the choice
              just made, so the price only reappeared one step later. */}
          <div className={`${CARD_CLASS} mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4`}>
            <span className="flex items-baseline gap-2">
              <span dir="ltr" className="text-lg font-bold text-white">
                {selectedPlan.credits.toFixed(0)}
                <span className="ms-1 text-sm font-bold text-[#adc6ff]">Cr</span>
              </span>
              <span className="text-sm text-[#c2c6d6]">{selectedPlan.name}</span>
            </span>
            <span className="flex items-center gap-3">
              <span dir="ltr" className="text-lg font-bold text-[#adc6ff]">
                {formatPrice(selectedPlan.priceMinor, selectedPlan.currency)}
              </span>
              <button
                type="button"
                onClick={() => goTo({ step: "plan" })}
                className="text-xs font-semibold text-[#adc6ff] underline-offset-4 hover:underline"
              >
                {t("Change plan")}
              </button>
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">{tunisianMethods.map(methodRow)}</div>

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
        /* Two columns from lg: the money (what you owe, what happens next, how to
           reach us) stays pinned while the long half — details + upload — scrolls.
           The aside is desktop-only; a phone gets a one-line recap on top, the
           help card at the bottom, and the total in the fixed action bar, because
           stacking the full aside first pushed the actual payment steps below
           three cards the buyer had already answered. */
        <section className="flex flex-col gap-5 pb-20 lg:flex-row lg:items-start lg:pb-0">
          <aside className="hidden flex-col gap-5 lg:order-2 lg:flex lg:w-[17rem] lg:shrink-0 xl:w-[19rem]">
            <div className="lg:sticky lg:top-8 lg:flex lg:flex-col lg:gap-5">
              {/* Order summary */}
              <div className={CARD_PADDED}>
                <p className={EYEBROW_CLASS}>{t("Your order")}</p>
                <p className="mt-3 text-2xl font-bold text-white">
                  <span dir="ltr">
                    {selectedPlan.credits.toFixed(0)}
                    <span className="ms-1.5 text-base font-bold text-[#adc6ff]">Cr</span>
                  </span>
                </p>
                <p className="mt-0.5 text-sm text-[#c2c6d6]">{selectedPlan.name}</p>

                <div className="mt-4 border-t border-white/10 pt-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-[#c2c6d6]">{t("Total")}</span>
                    <span dir="ltr" className="text-2xl font-bold text-[#adc6ff]">
                      {formatPrice(selectedPlan.priceMinor, selectedPlan.currency)}
                    </span>
                  </div>
                  {/* Stacked, not a justify-between row: "Bank transfer / RIB" is
                      wider than the 17rem column can spare beside its label. */}
                  <div className="mt-3 text-xs text-[#c2c6d6]">
                    <span className="block">{t("Payment method")}</span>
                    <span className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-white">
                      <span className="material-symbols-outlined shrink-0 text-[15px] text-[#adc6ff]">
                        {selectedMethod.icon || "payments"}
                      </span>
                      <span className="min-w-0 truncate">{t(selectedMethod.label)}</span>
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => goTo({ step: "plan" })}
                  className="mt-4 text-xs font-semibold text-[#adc6ff] underline-offset-4 hover:underline"
                >
                  {t("Change plan")}
                </button>
              </div>

              {/* What happens next */}
              <div className={`${CARD_PADDED} hidden lg:block`}>
                <p className={EYEBROW_CLASS}>{t("What happens next")}</p>
                <p className="mt-3 text-sm text-[#c2c6d6]">
                  {t("We review your receipt manually and your redeem code appears on the Credits page.")}
                </p>
                <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-white">
                  <span className="material-symbols-outlined text-[16px] text-[#adc6ff]">
                    schedule
                  </span>
                  {t("You'll get your code in 1h max")}
                </p>
              </div>

              {helpCard}
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col gap-5 lg:order-1">
            {/* Phone recap: what you picked, in one line. The total lives in the
                action bar, where it is on screen the whole way down. */}
            <div className={`${CARD_CLASS} flex items-center justify-between gap-3 p-4 lg:hidden`}>
              <span className="min-w-0">
                <span className="flex items-baseline gap-2">
                  <span dir="ltr" className="text-lg font-bold text-white">
                    {selectedPlan.credits.toFixed(0)}
                    <span className="ms-1 text-sm font-bold text-[#adc6ff]">Cr</span>
                  </span>
                  <span className="truncate text-sm text-[#c2c6d6]">{selectedPlan.name}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-[#c2c6d6]">
                  <span className="material-symbols-outlined shrink-0 text-[14px] text-[#adc6ff]">
                    {selectedMethod.icon || "payments"}
                  </span>
                  <span className="truncate">{t(selectedMethod.label)}</span>
                </span>
              </span>
              <button
                type="button"
                onClick={() => goTo({ step: "plan" })}
                className="shrink-0 text-xs font-semibold text-[#adc6ff] underline-offset-4 hover:underline"
              >
                {t("Change plan")}
              </button>
            </div>

            {/* The chosen rail's details. Step 2 already asked which one, so this
                shows one account and a way back rather than re-asking. */}
            <div className={CARD_PADDED}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-white">{t("Send your payment")}</h2>
                  <p className="mt-1 text-sm text-[#c2c6d6]">
                    {t("Send the exact amount, then upload your receipt below.")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => goTo({ step: "method", plan: selectedPlan.id })}
                  className={`${SECONDARY_BUTTON_CLASS} shrink-0`}
                >
                  {t("Change")}
                </button>
              </div>

              <div className="mt-5 rounded-xl border border-[#adc6ff]/40 bg-[#adc6ff]/10 p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5">
                    <span className="material-symbols-outlined text-[20px] text-[#adc6ff]">
                      {selectedMethod.icon || "payments"}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1 font-bold text-white">
                    {t(selectedMethod.label)}
                  </span>
                </div>

                {selectedMethod.primaryValue ? (
                  <div className="mt-4 border-t border-white/10 pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#93a0bd]">
                        {t(selectedMethod.primaryLabel)}
                      </span>
                      <CopyButton value={selectedMethod.primaryValue} />
                    </div>
                    {/* break-words, not break-all: an IBAN is printed in groups
                        and must wrap between them. break-all split it mid-group
                        ("…511101 7" / "5"), which is how a digit gets dropped when
                        someone copies it by hand. Long unspaced values still break
                        rather than overflow.
                        dir="ltr" on the value, not the <p>: an account number is
                        LTR in every language, and "+216 27 666 467" opens with a
                        neutral "+" and weak digits, so Arabic's bidi order flipped
                        it to "467 666 27 216+" — a number a customer would then
                        pay to. Keeping it on the inner span leaves the paragraph
                        RTL, so the value still aligns with the rest of the card. */}
                    <p className="mt-1 select-all break-words font-mono text-base font-bold text-white sm:text-lg">
                      <span dir="ltr">{selectedMethod.primaryValue}</span>
                    </p>
                    {selectedMethod.meta.length > 0 && (
                      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#c2c6d6]">
                        {selectedMethod.meta.map((entry, i) => (
                          <span key={entry} className="flex items-center gap-2">
                            {i > 0 && <span className="text-[#93a0bd]">•</span>}
                            {entry}
                          </span>
                        ))}
                      </p>
                    )}
                    <p className="mt-3 flex items-center gap-1.5 border-t border-white/10 pt-3 text-sm text-[#c2c6d6]">
                      {t("Amount to send")}
                      <span dir="ltr" className="font-bold text-white">
                        {formatPrice(selectedPlan.priceMinor, selectedPlan.currency)}
                      </span>
                    </p>
                  </div>
                ) : (
                  <p className="mt-4 border-t border-white/10 pt-3 text-sm text-[#c2c6d6]">
                    {t(
                      "Account details are being set up. Contact us on WhatsApp to complete this payment.",
                    )}
                  </p>
                )}
              </div>
            </div>

            {/* Proof upload */}
            <div ref={uploadRef} className={CARD_PADDED}>
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
                    ? "border-[#adc6ff]/40 bg-white/10 text-white"
                    : "border-white/15 bg-white/[0.03] text-[#93a0bd] hover:bg-white/5 hover:text-white"
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
                          <span className="material-symbols-outlined text-[22px] text-[#adc6ff]">
                            picture_as_pdf
                          </span>
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-white">{proof.file.name}</span>
                        <span className="block text-xs text-[#c2c6d6]">
                          <span dir="ltr">{(proof.file.size / 1024 / 1024).toFixed(2)} MB</span>
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(proof.id)}
                        aria-label={t("Remove")}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 text-[#c2c6d6] transition hover:bg-white/10 hover:text-white"
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
                  className="w-full resize-none rounded-md border border-white/10 bg-[#070d1f] p-3 pb-7 text-sm text-white placeholder:text-[#93a0bd] outline-none transition-all focus:border-[#adc6ff]"
                />
                <span className="absolute bottom-3 end-3 text-[11px] text-[#93a0bd]">
                  {note.length}/{noteMaxLength}
                </span>
              </div>

              {error && (
                <p className="mt-3 rounded-md border border-white/10 bg-[#93000a]/10 px-3 py-2 text-sm text-[#ffb4ab]">
                  {error}
                </p>
              )}

              {/* Below lg the primary button lives in the fixed bar, so this one
                  is desktop-only — two identical CTAs on one screen is worse than
                  the scroll it saves. */}
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={submit}
                  disabled={submitting}
                  className={`${PRIMARY_BUTTON_CLASS} hidden lg:inline-block`}
                >
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

              <p className="mt-4 flex items-center gap-1.5 text-xs text-[#c2c6d6] lg:hidden">
                <span className="material-symbols-outlined text-[15px] text-[#adc6ff]">
                  schedule
                </span>
                {t("You'll get your code in 1h max")}
              </p>
            </div>

            <div className="lg:hidden">{helpCard}</div>
          </div>

          {/* Phone action bar. It rides above the app's bottom tab bar (which owns
              the safe-area inset) and carries the total, so the amount and the way
              to pay it are on screen at every scroll position. z-40 keeps it under
              the nav's z-50. */}
          <div
            /* px matches the page's own gutter so the bar's edges line up with
               the cards above it at every width below lg. */
            className="fixed inset-x-0 z-40 border-t border-white/10 bg-[rgba(25,31,49,0.7)] px-4 py-3 backdrop-blur-xl sm:px-8 lg:hidden"
            style={{ bottom: "calc(var(--app-nav-h) + var(--app-safe-b))" }}
          >
            <div className="mx-auto flex max-w-5xl items-center gap-4">
              <span className="min-w-0 shrink-0">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-[#93a0bd]">
                  {t("Total")}
                </span>
                <span dir="ltr" className="block text-lg font-bold leading-tight text-[#adc6ff]">
                  {formatPrice(selectedPlan.priceMinor, selectedPlan.currency)}
                </span>
              </span>
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className={`${PRIMARY_BUTTON_CLASS} min-w-0 flex-1 px-4 py-2.5`}
              >
                {submitting ? t("Sending…") : t("Place order")}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* A stale/hand-edited URL (unknown plan, or no rail open at all) lands here. */}
      {((step === "method" || step === "pay") && !selectedPlan) ||
      (step === "pay" && selectedPlan && !selectedMethod) ? (
        <div className={CARD_PADDED}>
          <p className="text-sm text-[#c2c6d6]">{t("Pick a plan to continue.")}</p>
          <button
            type="button"
            onClick={() => goTo({ step: "plan" })}
            className={`${SECONDARY_BUTTON_CLASS} mt-4`}
          >
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
