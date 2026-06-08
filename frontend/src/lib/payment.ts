// Destination for the "Buy Codes" buttons (where users purchase credit codes).
// Placeholder points to the in-app Credits / redeem page until the external
// payment platform is live.
// TODO: replace with the external payment URL once available,
// e.g. "https://store.example.com/checkout".
export const PAYMENT_LINK = "https://eshoptunisia.xyz/products/Ei5vNX69VnfBRfypGgO7";

// True when PAYMENT_LINK is an absolute external URL. When external, the button
// renders as an <a> and opens in a new tab; otherwise it uses Next.js <Link>.
export const PAYMENT_LINK_IS_EXTERNAL = /^https?:\/\//i.test(PAYMENT_LINK);
