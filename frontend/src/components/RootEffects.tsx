"use client";

import { useEffect } from "react";
import { applyAccentColorToDocument, readAccentColorFromCookie } from "../lib/accentColor";

/* Lifted out of app/layout.tsx when the layout became a server component (so it
   could read the language cookie and render the right language in the FIRST
   HTML). Same effects, same order — this just needs to live somewhere client. */
export default function RootEffects() {
  useEffect(() => {
    applyAccentColorToDocument(readAccentColorFromCookie());

    if (typeof document === "undefined" || typeof document.fonts === "undefined") {
      document?.documentElement.classList.add("icons-ready");
      return;
    }

    let cancelled = false;
    const root = document.documentElement;
    root.classList.remove("icons-ready");

    document.fonts
      .load('24px "Material Symbols Outlined"')
      .catch(() => [])
      .finally(() => {
        if (!cancelled) {
          root.classList.add("icons-ready");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
