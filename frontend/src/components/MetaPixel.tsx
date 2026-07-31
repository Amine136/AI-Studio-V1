"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Script from "next/script";
import { META_PIXEL_ID, PIXEL_ENABLED, whenFbqReady } from "../lib/pixel";

export { META_PIXEL_ID };

/** Which event a route is worth reporting as, beyond its PageView.
 *
 * Standard events (ViewContent) are what Meta can optimise and score match
 * quality on, so anything with a standard equivalent uses one and carries a
 * content_name to keep the surfaces apart in Events Manager. EnterStudio stays
 * custom: "opened the generation tool" has no standard analogue, and forcing it
 * into ViewContent would only blur it with the commercial pages. */
function routeEvent(pathname: string): { standard: boolean; name: string; contentName?: string } | null {
  if (pathname === "/credits/buy") return { standard: true, name: "ViewContent", contentName: "Buy Credits" };
  if (pathname === "/credits") return { standard: true, name: "ViewContent", contentName: "Credits" };
  if (pathname === "/pricing") return { standard: true, name: "ViewContent", contentName: "Pricing" };
  if (pathname === "/create" || pathname.startsWith("/packs")) return { standard: false, name: "EnterStudio" };
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

      const event = routeEvent(pathname);
      if (!event) return;
      fbq(
        event.standard ? "track" : "trackCustom",
        event.name,
        event.contentName ? { content_name: event.contentName } : undefined,
      );
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
