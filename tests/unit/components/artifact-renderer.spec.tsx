import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { MatcherState } from "vitest";

import { ArtifactRenderer } from "@/components/ArtifactRenderer";
import type { FinanceArtifact } from "@/lib/finance/types";

declare module "vitest" {
  interface Assertion<T = any> {
    toMatchStaticSnapshot(expected: string): T;
  }

  interface AsymmetricMatchersContaining {
    toMatchStaticSnapshot(expected: string): void;
  }
}

expect.extend({
  toMatchStaticSnapshot(
    this: MatcherState,
    received: unknown,
    expected: string
  ) {
    const element = received as HTMLElement | null;
    const actual = element?.outerHTML ?? "";
    const pass = actual === expected;

    return {
      pass,
      message: () => {
        const diff = [
          "--- Snapshot",
          expected,
          "+++ Received",
          actual,
        ].join("\n");

        return pass
          ? "Expected markup to differ from the stored snapshot."
          : `Rendered markup does not match the stored snapshot.\n${diff}`;
      },
    };
  },
});

describe("ArtifactRenderer", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FINANCE", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back gracefully on unsupported payloads", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ArtifactRenderer
        // @ts-expect-error intentionally malformed artefact to test fallback
        artifact={{ foo: "bar" } as FinanceArtifact}
      />
    );

    expect(consoleSpy).toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it("surfaces an error when the artefact type is unknown", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ArtifactRenderer
        artifact={{
          // @ts-expect-error manual type to trigger unknown branch
          type: "finance.unknown",
        } as FinanceArtifact}
      />
    );

    const alert = screen.getByTestId("artifact-renderer-error");
    expect(alert).toHaveTextContent("n’est pas pris en charge");
    expect(consoleSpy).toHaveBeenCalled();
    expect(alert).toMatchStaticSnapshot(
      '<div class="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" data-testid="artifact-renderer-error" role="alert">Contenu indisponible : l’artefact « finance.unknown » n’est pas pris en charge.</div>'
    );

    consoleSpy.mockRestore();
  });

  it("short-circuits when finance artefacts are disabled", () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FINANCE", "false");

    render(
      <ArtifactRenderer
        artifact={{
          type: "finance.news",
          symbol: "AAPL",
          items: [],
        } as FinanceArtifact}
      />
    );

    expect(
      screen.getByTestId("artifact-renderer-finance-disabled")
    ).toBeInTheDocument();
  });
});
