/* Meta Pixel wiring shared by the loader (`components/MetaPixel`), the auth
 * provider and the checkout screens.
 *
 * Pixel ID / kill switch
 * ----------------------
 * The ID is build-time configurable through NEXT_PUBLIC_META_PIXEL_ID. When the
 * variable is absent entirely we fall back to the historical production ID, so a
 * missing env var can never silently stop live tracking. Setting it to an EMPTY
 * value is the explicit opt-out: `PIXEL_ENABLED` goes false and nothing loads or
 * fires. Staging does exactly that in `frontend/.env.local`, because otherwise
 * test traffic lands in the same Events Manager dataset the real ads optimise on.
 */

const CONFIGURED = process.env.NEXT_PUBLIC_META_PIXEL_ID;

export const META_PIXEL_ID = (CONFIGURED === undefined ? "1370764631891853" : CONFIGURED).trim();

export const PIXEL_ENABLED = META_PIXEL_ID.length > 0;

declare global {
  interface Window {
    fbq: any;
  }
}

/** Run `cb` once window.fbq exists.
 *
 * The Pixel snippet defines fbq as a queuing stub synchronously when its inline
 * script runs, so this only bridges the gap until that script executes; we poll
 * briefly and give up if it never loads (ad blocker) — in which case the
 * server-side CAPI event is the safety net. */
export function whenFbqReady(cb: (fbq: Window["fbq"]) => void, attempts = 0): void {
  if (!PIXEL_ENABLED || typeof window === "undefined") return;
  if (window.fbq) {
    cb(window.fbq);
    return;
  }
  if (attempts >= 100) return; // ~20s (100 x 200ms) then stop waiting
  window.setTimeout(() => whenFbqReady(cb, attempts + 1), 200);
}

/** Fire a Meta *standard* event (one Meta knows how to optimise for). */
export function track(name: string, params?: Record<string, unknown>): void {
  whenFbqReady((fbq) => fbq("track", name, params));
}

/** Fire a custom event — only for moments with no standard equivalent. */
export function trackCustom(name: string, params?: Record<string, unknown>): void {
  whenFbqReady((fbq) => fbq("trackCustom", name, params));
}

/* Minor units per major unit. The two payment rails genuinely differ — TND is a
 * 3-decimal currency (millimes) and USD is 2 (cents) — so a single divisor would
 * report one of them 10x wrong, straight into Meta's value optimisation. An
 * unrecognised currency yields no event at all: no conversion data is recoverable,
 * a conversion logged at the wrong value is not. */
const MINOR_PER_MAJOR: Record<string, number> = { TND: 1000, USD: 100 };

export function majorAmount(priceMinor: number, currency: string): number | null {
  const divisor = MINOR_PER_MAJOR[(currency || "").toUpperCase()];
  if (!divisor) return null;
  return priceMinor / divisor;
}

interface PlanLike {
  id: string;
  name: string;
  priceMinor: number;
  currency: string;
}

/** "They committed to a plan and started paying" — fired on both rails. The
 * Purchase that may follow is sent server-side (Conversions API), because both
 * rails complete without the buyer's browser present. */
export function trackInitiateCheckout(plan: PlanLike): void {
  const value = majorAmount(plan.priceMinor, plan.currency);
  if (value === null) return;
  track("InitiateCheckout", {
    value,
    currency: plan.currency.toUpperCase(),
    content_ids: [plan.id],
    content_name: plan.name,
    content_type: "product",
    num_items: 1,
  });
}
