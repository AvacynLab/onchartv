import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ArtifactRenderer } from "@/components/ArtifactRenderer";
import type { FinanceArtifact } from "@/lib/finance/types";

describe("ArtifactRenderer", () => {
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

    consoleSpy.mockRestore();
  });
});
