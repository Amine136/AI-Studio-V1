"use client";

import "./globals.css";
import { AuthProvider } from "../context/AuthContext";

const LOGO_VERSION = "20260404-1846";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <title>Vibecraft — Create with AI</title>
        <meta name="description" content="Vibecraft is an AI-powered creative studio for generating captions, images, and more." />
        <link rel="icon" href={`/best-version/logo-192.png?v=${LOGO_VERSION}`} type="image/png" sizes="192x192" />
        <link rel="apple-touch-icon" href={`/best-version/logo-192.png?v=${LOGO_VERSION}`} />
      </head>
      <body className="antialiased">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
