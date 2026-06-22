import type { HistoryEntry } from "./history";

// Standard showcase entries shown to brand-new users whose real generation
// history is still empty, so the Dashboard "Latest Generations" strip and the
// Gallery don't look dead on first visit. Purely presentational: these are NOT
// saved to the account, cost no credits, and are replaced entirely the moment
// the user has at least one real generation. Images live in /public/samples --
// swap the files + prompts here freely. Order matters: the first entry becomes
// the large "Featured" gallery tile and leads the dashboard strip.

const SAMPLE_PREFIX = "sample-";

export function isSampleEntry(id: string | undefined): boolean {
  return Boolean(id && id.startsWith(SAMPLE_PREFIX));
}

export const SAMPLE_HISTORY: HistoryEntry[] = [
  {
    id: `${SAMPLE_PREFIX}serum`,
    imageUrl: "/samples/serum.jpg",
    prompt:
      "Luxury skincare serum bottle with a gold pump on a white marble pedestal, a crown-shaped water splash around it, warm beige studio backdrop, dried flowers and a gold spoon, premium cosmetic product advertising, ultra-detailed, 8k",
    caption: "✨ Glow that speaks for itself — LUMINA GOLD Advanced Radiance Serum. Your skin's daily dose of luxury.",
    model: "Imagen 4 Ultra",
    createdAt: new Date("2026-06-18T10:24:00Z"),
  },
  {
    id: `${SAMPLE_PREFIX}fashion`,
    imageUrl: "/samples/fashion.jpg",
    prompt:
      "Full-body fashion editorial of a model wearing a beige trench coat over a black turtleneck and trousers, holding a small leather bag, concrete studio backdrop, soft natural light, professional lookbook photography",
    caption: "L'élégance intemporelle. Le trench beige qui sublime chaque tenue. 🧥",
    model: "GPT Image 2",
    createdAt: new Date("2026-06-17T16:10:00Z"),
  },
  {
    id: `${SAMPLE_PREFIX}burger`,
    imageUrl: "/samples/burger.jpg",
    prompt:
      "Gourmet double cheeseburger with melting cheddar, fresh lettuce, tomato and onion on a sesame brioche bun, steam rising, basket of fries, dark moody pub background, professional food photography, mouth-watering",
    caption: "🔥 Double the beef, double the flavor. Freshly grilled and dripping with melted cheese — who's hungry?",
    model: "Grok Imagine Quality",
    createdAt: new Date("2026-06-16T19:35:00Z"),
  },
  {
    id: `${SAMPLE_PREFIX}sale`,
    imageUrl: "/samples/sale-ar.jpg",
    prompt:
      "Vibrant Arabic social media sale poster, bold headline 'عروض محدودة' and 'تخفيضات حصرية', large '50% خصم', a happy woman holding colorful shopping bags, confetti, energetic purple-and-orange gradient, modern marketing design, call-to-action 'اطلب الآن'",
    caption: "🛍️ عروض محدودة! تخفيضات تصل إلى 50%. اطلب الآن قبل نفاد الكمية!",
    model: "Nano Banana Pro",
    createdAt: new Date("2026-06-15T12:05:00Z"),
  },
  {
    id: `${SAMPLE_PREFIX}ring`,
    imageUrl: "/samples/ring.jpg",
    prompt:
      "Macro shot of an elegant solitaire diamond ring on black velvet, dramatic single spotlight, sparkling star reflections, white gold pavé band, luxury jewelry advertising, high detail",
    caption: "💍 A sparkle that lasts forever.",
    model: "Imagen 4 Ultra",
    createdAt: new Date("2026-06-14T18:20:00Z"),
  },
  {
    id: `${SAMPLE_PREFIX}portrait`,
    imageUrl: "/samples/portrait.jpg",
    prompt:
      "Professional stylized portrait of a confident young businesswoman in a navy blazer, smiling, modern office with warm bokeh lights and a city window behind, photorealistic LinkedIn-style headshot",
    caption: "Your professional first impression — perfected. 💼",
    model: "GPT Image 2",
    createdAt: new Date("2026-06-13T09:02:00Z"),
  },
];
