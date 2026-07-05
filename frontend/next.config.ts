import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  async redirects() {
    return [
      { source: "/packs", destination: "/studio/packs", permanent: true },
      { source: "/packs/:id", destination: "/studio/packs/:id", permanent: true },
      { source: "/packs/:id/batch", destination: "/studio/packs/:id/batch", permanent: true },
    ];
  },
};

export default nextConfig;
