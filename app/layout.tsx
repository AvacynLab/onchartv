import type { Metadata } from "next";
import type { CSSProperties } from "react";

import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { AppQueryClientProvider } from "@/components/providers/query-client-provider";
import { ThemeProvider } from "@/components/theme-provider";

import "./globals.css";
import { SessionProvider } from "next-auth/react";

export const metadata: Metadata = {
  metadataBase: new URL("https://chat.vercel.ai"),
  title: "Next.js Chatbot Template",
  description: "Next.js chatbot template using the AI SDK.",
};

export const viewport = {
  maximumScale: 1, // Disable auto-zoom on mobile Safari
};

/**
 * When running the Playwright end-to-end suite we prevent Next.js from
 * attempting to download the Geist fonts from Google. The sandboxed CI
 * environment does not have internet access which would otherwise cause the
 * server to throw ENETUNREACH errors and stall the test runner. The mocked
 * font responses are configured in `playwright.config.ts`, and the inline
 * CSS variables below ensure we still fall back to the system fonts.
 */
const disableRemoteFonts = process.env.PLAYWRIGHT === "true";

const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-mono",
});

const fontClassName = disableRemoteFonts
  ? ""
  : `${geist.variable} ${geistMono.variable}`;

const fallbackFontVariables: CSSProperties | undefined = disableRemoteFonts
  ? ({
      "--font-geist":
        "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      "--font-geist-mono":
        "ui-monospace, 'SFMono-Regular', Menlo, Monaco, Consolas, monospace",
      // TypeScript's `CSSProperties` definition does not enumerate custom CSS
      // variables. Casting through `CSSProperties` keeps React happy while still
      // documenting the intended fallback values for Playwright runs.
    } as CSSProperties)
  : undefined;

const LIGHT_THEME_COLOR = "hsl(0 0% 100%)";
const DARK_THEME_COLOR = "hsl(240deg 10% 3.92%)";
const THEME_COLOR_SCRIPT = `\
(function() {
  var html = document.documentElement;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  function updateThemeColor() {
    var isDark = html.classList.contains('dark');
    meta.setAttribute('content', isDark ? '${DARK_THEME_COLOR}' : '${LIGHT_THEME_COLOR}');
  }
  var observer = new MutationObserver(updateThemeColor);
  observer.observe(html, { attributes: true, attributeFilter: ['class'] });
  updateThemeColor();
})();`;

const PLAYWRIGHT_AUTOMATION_SCRIPT =
  process.env.NEXT_PUBLIC_PLAYWRIGHT === "true" ||
  process.env.PLAYWRIGHT === "true" ||
  process.env.CI_PLAYWRIGHT === "true"
    ? "(function(){try{window.__PLAYWRIGHT_AUTOMATION__=true;}catch(_){}})();"
    : null;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={fontClassName}
      style={fallbackFontVariables}
      // `next-themes` injects an extra classname to the body element to avoid
      // visual flicker before hydration. Hence the `suppressHydrationWarning`
      // prop is necessary to avoid the React hydration mismatch warning.
      // https://github.com/pacocoursey/next-themes?tab=readme-ov-file#with-app
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: "Required"
          dangerouslySetInnerHTML={{
            __html: THEME_COLOR_SCRIPT,
          }}
        />
        {PLAYWRIGHT_AUTOMATION_SCRIPT ? (
          <script
            // biome-ignore lint/security/noDangerouslySetInnerHtml: "Required"
            dangerouslySetInnerHTML={{
              __html: PLAYWRIGHT_AUTOMATION_SCRIPT,
            }}
          />
        ) : null}
      </head>
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          <Toaster position="top-center" />
          <SessionProvider>
            {/**
             * Hydrate TanStack Query once at the application root so all client
             * routes (chat, finance settings…) can reuse cached responses and
             * stay in sync after preference updates.
             */}
            <AppQueryClientProvider>{children}</AppQueryClientProvider>
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
