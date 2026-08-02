"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Script from "next/script";
import { META_PIXEL_ID, PIXEL_ENABLED, whenFbqReady } from "../lib/pixel";

export { META_PIXEL_ID };

/** Which commercial surface a route reports as ViewContent, beyond its PageView.
 *
 * ViewContent is a standard event, which is what Meta can optimise and score
 * match quality on, so each of these carries a content_name to stay separable in
 * Events Manager. All three are top of funnel and deliberately fire for
 * anonymous visitors too.
 *
 * EnterStudio is not here. It has to mean "a signed-in user reached a generation
 * surface", and a route table cannot see auth — see EnterStudioTracker. */
function viewContentName(pathname: string): string | null {
  if (pathname === "/credits/buy") return "Buy Credits";
  if (pathname === "/credits") return "Credits";
  if (pathname === "/pricing") return "Pricing";
  return null;
}

export default function MetaPixel() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!PIXEL_ENABLED || !pathname) return;
    // Every PageView is fired from here — including the first one. The inline
    // snippet below deliberately only init()s: while it also tracked a PageView,
    // this effect fired a second one on mount, so every full page load counted
    // twice. whenFbqReady covers the case where the snippet (loaded
    // afterInteractive) has not executed by the time this effect runs, so owning
    // the event here loses nothing on a slow load.
    whenFbqReady((fbq) => {
      fbq("track", "PageView");

      const contentName = viewContentName(pathname);
      if (contentName) fbq("track", "ViewContent", { content_name: contentName });
    });
  }, [pathname, searchParams]);

  if (!PIXEL_ENABLED) return null;

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '${META_PIXEL_ID}');
        `}
      </Script>
      <noscript>
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
    </>
  );
}
