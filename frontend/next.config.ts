import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  async redirects() {
    return [
      { source: "/packs", destination: "/studio/packs", permanent: true },
      { source: "/packs/:id", destination: "/studio/packs/:id", permanent: true },
      { source: "/packs/:id/batch", destination: "/studio/packs/:id/batch", permanent: true },

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
