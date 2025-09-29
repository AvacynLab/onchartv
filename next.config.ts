import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    ppr: true,
  },
  images: {
    remotePatterns: [
      {
        hostname: "avatar.vercel.sh",
      },
      {
        // Playwright's deterministic upload helper returns assets from the
        // example.com origin so the Next.js image component needs explicit
        // permission to render the mocked previews during tests.
        hostname: "example.com",
      },
    ],
  },
};

export default nextConfig;
