"use client";

import { useEffect } from "react";
import "./globals.css";
import { AuthProvider } from "../context/AuthContext";
import { applyAccentColorToDocument, readAccentColorFromCookie } from "../lib/accentColor";

const LOGO_VERSION = "20260404-1846";
const MATERIAL_SYMBOLS_STYLESHEET =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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

  return (
    <html lang="en">
      <head>
        <title>Vibecraft — Create with AI</title>
        <meta name="description" content="Vibecraft is an AI-powered creative studio for generating captions, images, and more." />
        <link rel="icon" href={`/best-version/logo-192.png?v=${LOGO_VERSION}`} type="image/png" sizes="192x192" />
        <link rel="apple-touch-icon" href={`/best-version/logo-192.png?v=${LOGO_VERSION}`} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="preload" as="style" href={MATERIAL_SYMBOLS_STYLESHEET} />
        <link
          rel="stylesheet"
          href={MATERIAL_SYMBOLS_STYLESHEET}
        />
      </head>
      <body className="antialiased">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
