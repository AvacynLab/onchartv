"use client";

import React, { useEffect } from "react";

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
      <Button onClick={() => reset()} type="button">
        Réessayer
      </Button>
    </div>
  );
}
