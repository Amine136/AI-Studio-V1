import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/",
          has: [
            {
              type: "host",
              value: "prodxvibecraft.ouni.space",
            },
          ],
          destination: "/admin",
        },
        {
          source: "/:path((?!admin|_next|api|favicon.ico).*)",
          has: [
            {
              type: "host",
              value: "prodxvibecraft.ouni.space",
            },
          ],
          destination: "/admin/:path*",
        },
      ],
    };
  },
  async redirects() {
    return [
      { source: "/studio/create", destination: "/create", permanent: false },
      { source: "/studio/packs", destination: "/packs", permanent: false },
      { source: "/studio/packs/:id", destination: "/packs/:id", permanent: false },
      { source: "/studio/packs/:id/batch", destination: "/packs/:id/batch", permanent: false },
      { source: "/dashboard", destination: "/playground", permanent: false },
      { source: "/studio", destination: "/playground", permanent: false },
      { source: "/studio/start", destination: "/playground", permanent: false },
      { source: "/studio/chat", destination: "/playground", permanent: false },
    ];
  },
};

export default nextConfig;
