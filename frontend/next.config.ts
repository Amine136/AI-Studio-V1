import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  async redirects() {
    return [
      // Studio prefix dropped 2026-07-16: pages live at /packs and /create now.
      // Kept non-permanent on purpose — the OLD /packs -> /studio/packs redirect
      // was a 308 and browsers cached it hard, which is exactly what made this
      // flip painful. Never ship permanent:true here again.
      { source: "/studio/create", destination: "/create", permanent: false },
      { source: "/studio/packs", destination: "/packs", permanent: false },
      { source: "/studio/packs/:id", destination: "/packs/:id", permanent: false },
      { source: "/studio/packs/:id/batch", destination: "/packs/:id/batch", permanent: false },

      // The Playground replaced the Dashboard and the Studio home. Redirecting here
      // rather than from a page.tsx gives a real HTTP redirect: a page under the
      // client `studio/layout.tsx` streams its shell first, so `redirect()` there
      // degrades to a client-side hop. Next preserves the query string, which the
      // /studio/chat deep links (?model, ?prompt, ?conversation, ?new) depend on.
      // Kept non-permanent while the redesign settles — a 308 is cached hard.
      { source: "/dashboard", destination: "/playground", permanent: false },
      { source: "/studio", destination: "/playground", permanent: false },
      { source: "/studio/start", destination: "/playground", permanent: false },
      { source: "/studio/chat", destination: "/playground", permanent: false },
    ];
  },
};

export default nextConfig;
