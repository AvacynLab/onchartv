"use client";

import React, { useEffect } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

declare global {
  interface Window {
    reportError?: (error: unknown) => void;
  }
}

type ChatErrorBoundaryProps = {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
};

export default function ChatErrorBoundary({
  error,
  reset,
}: ChatErrorBoundaryProps) {
  /**
   * Keep a dedicated flag for developer builds so we can surface a minimal
   * diagnostic payload without leaking stack traces in production bundles. Next
   * inlines `process.env.NODE_ENV` during compilation which keeps this check
   * tree-shakeable.
   */
  const isDeveloperBuild = process.env.NODE_ENV !== "production";

  useEffect(() => {
    console.error("[chat] rendering error boundary", error);

    if (typeof window !== "undefined" && typeof window.reportError === "function") {
      window.reportError(error);
    }
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="space-y-2">
        <h1 className="font-semibold text-2xl">Une erreur est survenue</h1>
        <p className="text-muted-foreground">
          Impossible d’afficher la conversation pour le moment. Vous pouvez réessayer ou revenir plus tard.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button onClick={() => reset()} type="button">
          Réessayer
        </Button>
        <Button asChild variant="outline">
          <Link href="mailto:support@onchartv.dev">Contacter le support</Link>
        </Button>
      </div>
      {isDeveloperBuild ? (
        <details className="w-full max-w-xl rounded-lg border border-dashed border-muted-foreground/40 bg-muted/20 p-4 text-left text-sm">
          <summary className="cursor-pointer font-medium">Détails techniques (environnement développeur)</summary>
          <div className="mt-2 space-y-1 text-muted-foreground">
            <p>
              <span className="font-medium">Message :</span>{" "}
              <code className="break-all text-xs">{error.message}</code>
            </p>
            {error.digest ? (
              <p>
                <span className="font-medium">Digest :</span>{" "}
                <code className="break-all text-xs">{error.digest}</code>
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
