// Destination for the "Buy Codes" buttons (where users purchase credit codes).
// The external payment platform is not live yet, so the buttons are LOCKED and
// render a "Coming soon" remark instead of navigating anywhere.
// TODO: set PAYMENT_LINK to the external payment URL and flip PAYMENT_LINK_LOCKED
// to false once the store is live, e.g. "https://store.example.com/checkout".
export const PAYMENT_LINK = "";

// While true, the Buy Codes button is disabled/locked and shows "Coming soon".
export const PAYMENT_LINK_LOCKED = true;

// True when PAYMENT_LINK is an absolute external URL. When external, the button
// renders as an <a> and opens in a new tab; otherwise it uses Next.js <Link>.
export const PAYMENT_LINK_IS_EXTERNAL = /^https?:\/\//i.test(PAYMENT_LINK);
