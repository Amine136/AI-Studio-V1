"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { PAYMENT_LINK, PAYMENT_LINK_IS_EXTERNAL, PAYMENT_LINK_LOCKED } from "../lib/payment";
import { useLanguage } from "../context/LanguageContext";

interface BuyCodesButtonProps {
  className?: string;
  children?: ReactNode;
  showIcon?: boolean;
}

/**
 * Reusable "Buy Codes" call-to-action. Points at PAYMENT_LINK (a single
 * source of truth). Renders as an external <a> (new tab) when the link is an
 * absolute URL, otherwise as an in-app <Link>. Styling is passed per usage via
 * className so it can match each surface.
 *
 * When PAYMENT_LINK_LOCKED is true the external store isn't live yet, so the
 * button is rendered locked (non-clickable) with a "Coming soon" remark.
 */
export default function BuyCodesButton({
  className = "",
  children,
  showIcon = true,
}: BuyCodesButtonProps) {
  const { t } = useLanguage();
  const content = (
    <>
      {showIcon && (
        <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
          {PAYMENT_LINK_LOCKED ? "lock" : "shopping_bag"}
        </span>
      )}
      {children ?? t("Buy Codes")}
    </>
  );

  // No Pixel event on the click itself: this button's only destination is
  // /credits/buy, whose ViewContent reports the same intent one step later and
  // survives the user arriving there by any other route.

  // Locked: external payment platform not live yet. Non-clickable button with a
  // "Coming soon" remark underneath.
  if (PAYMENT_LINK_LOCKED) {
    return (
      <span className="inline-flex flex-col items-center gap-1.5">
        <button
          type="button"
          disabled
          aria-disabled="true"
          className={`${className} cursor-not-allowed opacity-60 hover:scale-100 hover:shadow-none`}
        >
          {content}
        </button>
        <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#c2c6d6]/60">
          {t("Coming soon")}
        </span>
      </span>
    );
  }

  if (PAYMENT_LINK_IS_EXTERNAL) {
    return (
      <a href={PAYMENT_LINK} target="_blank" rel="noopener noreferrer" className={className}>
        {content}
      </a>
    );
  }

  return (
    <Link href={PAYMENT_LINK} className={className}>
      {content}
    </Link>
  );
}
