import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    ppr: true,
  },
  /**
   * Turbopack struggles to resolve the React Query ESM bundle when the project
   * runs under pnpm because the package lives behind the `.pnpm` symlink. Adding
   * it to `transpilePackages` ensures Next.js hoists the dependency into the
   * application bundle so both the dev server and the Playwright harness can
   * import `@tanstack/react-query` without crashing during warmup.
   */
  transpilePackages: ["@tanstack/react-query"],
  env: {
    /**
     * Mirror the server-side finance flag to the client bundle so interactive
     * components can short-circuit when the feature is disabled without
     * reaching for runtime fetches.
     */
    NEXT_PUBLIC_FEATURE_FINANCE:
      process.env.NEXT_PUBLIC_FEATURE_FINANCE ??
      process.env.FEATURE_FINANCE ??
      "true",
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
