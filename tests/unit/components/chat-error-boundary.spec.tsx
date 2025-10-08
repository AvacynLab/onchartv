import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ChatErrorBoundary from "@/app/(chat)/error";

describe("ChatErrorBoundary", () => {
  it("affiche un message de repli et relance l'action de reset", async () => {
    const error = new Error("boom");
    const reset = vi.fn();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reportSpy = vi.fn();
    const globalWithReport = globalThis as typeof globalThis & {
      reportError?: (error: unknown) => void;
    };
    globalWithReport.reportError = reportSpy;

    render(<ChatErrorBoundary error={error} reset={reset} />);

    expect(
      screen.getByRole("heading", { name: /une erreur est survenue/i })
    ).toBeInTheDocument();

    const supportLink = screen.getByRole("link", { name: /contacter le support/i });
    expect(supportLink).toHaveAttribute("href", "mailto:support@onchartv.dev");

    expect(
      screen.getByText(/détails techniques \(environnement développeur\)/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/boom/)).toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: /réessayer/i });
    const user = userEvent.setup();
    await user.click(retryButton);

    expect(reset).toHaveBeenCalled();

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
      expect(reportSpy).toHaveBeenCalledWith(error);
    });

    consoleSpy.mockRestore();
    delete globalWithReport.reportError;
  });
});
