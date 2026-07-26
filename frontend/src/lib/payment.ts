// Destination for the "Buy Codes" buttons (where users purchase credit codes).
// Points at the in-app manual checkout: pick a plan, pay through a Tunisian
// method, upload proof. International card payment is a separate, still-locked
// option inside that flow rather than a different destination.
export const PAYMENT_LINK = "/credits/buy";

// While true, the Buy Codes button is disabled/locked and shows "Coming soon".
export const PAYMENT_LINK_LOCKED = false;

// True when PAYMENT_LINK is an absolute external URL. When external, the button
// renders as an <a> and opens in a new tab; otherwise it uses Next.js <Link>.
export const PAYMENT_LINK_IS_EXTERNAL = /^https?:\/\//i.test(PAYMENT_LINK);
