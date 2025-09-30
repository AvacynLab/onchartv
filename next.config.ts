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
      {
        // Finance news artefacts rely on Clearbit logos in development to help
        // users quickly recognise sources. Allowlisting the domain avoids
        // runtime image optimisation errors.
        hostname: "logo.clearbit.com",
      },
      {
        // Reuters provides reliable sample headlines within the hermetic data
        // set and exposes thumbnails from a static CDN. Next.js requires the
        // host to be explicitly declared before optimisation kicks in.
        hostname: "static.reuters.com",
      },
    ],
  },
};

export default nextConfig;
