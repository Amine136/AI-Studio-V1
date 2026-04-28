"use client";

import { useEffect } from "react";
import "./globals.css";
import { AuthProvider } from "../context/AuthContext";
import { applyAccentColorToDocument, readAccentColorFromCookie } from "../lib/accentColor";

const LOGO_VERSION = "20260404-1846";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  useEffect(() => {
    applyAccentColorToDocument(readAccentColorFromCookie());
  }, []);

  return (
    <html lang="en">
      <head>
        <title>Vibecraft — Create with AI</title>
        <meta name="description" content="Vibecraft is an AI-powered creative studio for generating captions, images, and more." />
        <link rel="icon" href={`/best-version/logo-192.png?v=${LOGO_VERSION}`} type="image/png" sizes="192x192" />
        <link rel="apple-touch-icon" href={`/best-version/logo-192.png?v=${LOGO_VERSION}`} />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
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
