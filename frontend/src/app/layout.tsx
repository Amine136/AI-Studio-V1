import { Suspense } from "react";
import type { Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { AuthProvider } from "../context/AuthContext";
import MetaPixel from "../components/MetaPixel";
import GoogleAnalytics from "../components/GoogleAnalytics";
import RootEffects from "../components/RootEffects";
import { LanguageProvider } from "../context/LanguageContext";
import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, LANGUAGES, type Language } from "../lib/language";

const LOGO_VERSION = "20260622-1940";
const MATERIAL_SYMBOLS_STYLESHEET =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200";

/* Must go through Next's viewport export rather than a hand-written <meta> in the
   head below: without this export Next appends its own default viewport tag, and
   being last it wins — silently dropping viewport-fit and leaving every
   env(safe-area-inset-*) at 0, which is what the bottom nav's gesture-bar
   padding depends on. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  /* Android Chrome defaults to resizes-visual, where the soft keyboard does NOT
     shrink dvh. The chat is a full-height dvh column that no longer lets the body
     scroll, so on that default the keyboard would cover the composer with no way
     to scroll it back into view. resizes-content shrinks the layout viewport, so
     the composer rides up and stays above the keyboard. */
  interactiveWidget: "resizes-content",
};

/* This layout is a SERVER component on purpose. Reading the language cookie here
   is the only way the very first HTML can be in the visitor's language: the
   browser paints that HTML before any of our JavaScript runs, so a client-side
   correction — however early — is always too late and shows as a flash. Reading
   cookies() opts these routes into per-request rendering, which is the price. */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const saved = cookieStore.get(LANGUAGE_STORAGE_KEY)?.value;
  const language: Language = LANGUAGES.includes(saved as Language)
    ? (saved as Language)
    : DEFAULT_LANGUAGE;
  const dir = language === "ar" ? "rtl" : "ltr";

  return (
    <html lang={language} dir={dir} suppressHydrationWarning>
      <head>
        {/* Applies the persisted theme before first paint so a light-mode
            user never sees a dark flash. Dark is the default (no attribute). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{if(localStorage.getItem("vc-theme")==="light")document.documentElement.setAttribute("data-theme","light")}catch(e){}',
          }}
        />
        {/* Safety net for visitors who chose a language BEFORE the cookie existed:
            they have it in localStorage only, so the server could not see it and
            rendered the default. Fix lang/dir before paint; LanguageProvider then
            adopts the value and writes the cookie, so this only ever runs once. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{if(!/(?:^|; )vibecraft_lang=/.test(document.cookie)){' +
              'var l=localStorage.getItem("vibecraft_lang");' +
              'if(l==="en"||l==="fr"||l==="ar"){document.documentElement.lang=l;' +
              'document.documentElement.dir=l==="ar"?"rtl":"ltr";}}}catch(e){}',
          }}
        />
        <title>Vibecraft | Tunisian AI Studio</title>
        <meta name="description" content="Vibecraft is the premier Tunisian AI studio for generating captions, images, and more. The ultimate AI studio in Tunis for creative workflows." />
        <meta name="keywords" content="tunisian ai studio, vibecraft ai tunis, ai studio tunis, vibecraft tunisia, ai tunisia, creative studio tunis, ai image generation tunisia" />
        <meta property="og:title" content="Vibecraft | Tunisian AI Studio" />
        <meta property="og:description" content="Vibecraft is the premier Tunisian AI studio for generating captions, images, and more. The ultimate AI studio in Tunis for creative workflows." />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://vibecraft.ouni.space" />
        <meta property="og:image" content={`https://vibecraft.ouni.space/best-version/og-card.png?v=${LOGO_VERSION}`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="Vibecraft — Tunisian AI Studio" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Vibecraft | Tunisian AI Studio" />
        <meta name="twitter:description" content="Vibecraft is the premier Tunisian AI studio for generating captions, images, and more." />
        <meta name="twitter:image" content={`https://vibecraft.ouni.space/best-version/og-card.png?v=${LOGO_VERSION}`} />
        <link rel="icon" href={`/best-version/favicon-32.png?v=${LOGO_VERSION}`} type="image/png" sizes="32x32" />
        <link rel="icon" href={`/best-version/logo-192.png?v=${LOGO_VERSION}`} type="image/png" sizes="192x192" />
        <link rel="apple-touch-icon" href={`/best-version/logo-192.png?v=${LOGO_VERSION}`} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
        {/* Packs "Crafts Index" redesign: Bricolage Grotesque (Latin display) + Tajawal (Arabic) */}
        <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet" />
        <link rel="preload" as="style" href={MATERIAL_SYMBOLS_STYLESHEET} />
        <link
          rel="stylesheet"
          href={MATERIAL_SYMBOLS_STYLESHEET}
        />
      </head>
      <body className="antialiased">
        <RootEffects />
        <Suspense fallback={null}>
          <MetaPixel />
          <GoogleAnalytics />
        </Suspense>
        <AuthProvider>
          <LanguageProvider initialLanguage={language}>
            {children}
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
