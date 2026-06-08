"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { PAYMENT_LINK, PAYMENT_LINK_IS_EXTERNAL } from "../lib/payment";

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
 */
export default function BuyCodesButton({
  className = "",
  children = "Buy Codes",
  showIcon = true,
}: BuyCodesButtonProps) {
  const content = (
    <>
      {showIcon && (
        <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
          shopping_bag
        </span>
      )}
      {children}
    </>
  );

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
