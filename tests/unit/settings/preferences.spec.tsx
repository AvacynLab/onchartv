import React from "react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FinanceSettings } from "@/components/settings/finance-settings";
import type { FinancePreferences } from "@/lib/finance/preferences";

const createJsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

vi.mock("@/components/toast", () => ({
  toast: vi.fn(),
}));

describe("FinanceSettings", () => {
  const originalFetch = globalThis.fetch;
  const defaultPreferences: FinancePreferences = {
    markets: ["US_EQUITIES", "CRYPTO"],
    defaultIndicators: [
      { type: "sma", length: 50 },
      { type: "sma", length: 200 },
      { type: "rsi", period: 14 },
      { type: "bollinger", length: 20, standardDeviations: 2 },
    ],
    explanationLevel: "standard",
    showNews: true,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FINANCE", "true");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("loads, edits and saves finance preferences", async () => {
    const fetchMock = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(
        createJsonResponse({ preferences: defaultPreferences })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          preferences: {
            ...defaultPreferences,
            showNews: false,
            defaultIndicators: [
              { type: "sma", length: 50 },
              { type: "ema", length: 21 },
            ],
          },
        })
      );

    globalThis.fetch = fetchMock;

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <FinanceSettings />
      </QueryClientProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("finance-settings")).toBeInTheDocument()
    );

    const newsToggle = screen.getByRole("checkbox", {
      name: /news/i,
    });
    expect(newsToggle).toBeChecked();
    await userEvent.click(newsToggle);
    expect(newsToggle).not.toBeChecked();
    expect(
      screen.getByTestId("finance-settings-news-disabled")
    ).toBeInTheDocument();

    const emaPreset = screen.getByTestId("finance-indicator-ema-mid");
    const emaToggle = within(emaPreset).getByRole("checkbox");
    expect(emaToggle).not.toBeChecked();
    await userEvent.click(emaToggle);

    const emaInput = within(emaPreset).getByLabelText(/longueur/i);
    await userEvent.clear(emaInput);
    await userEvent.type(emaInput, "21");

    const saveButton = screen.getByRole("button", { name: /enregistrer/i });
    expect(saveButton).toBeEnabled();
    await userEvent.click(saveButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const [, patchCall] = fetchMock.mock.calls;
    expect(patchCall?.[0]).toBe("/api/finance/preferences");
    const requestInit = patchCall?.[1] as RequestInit | undefined;
    expect(requestInit?.method).toBe("PATCH");

    const sentBody = requestInit?.body as string | undefined;
    expect(sentBody).toBeDefined();
    const parsed = JSON.parse(sentBody ?? "{}");
    expect(parsed.showNews).toBe(false);
    expect(Array.isArray(parsed.defaultIndicators)).toBe(true);
    expect(parsed.defaultIndicators.some((indicator: any) => indicator.type === "ema")).toBe(true);
  });

  it("returns a placeholder when the finance flag is disabled", () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FINANCE", "false");

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <FinanceSettings />
      </QueryClientProvider>
    );

    expect(
      screen.getByTestId("finance-settings-disabled-flag")
    ).toBeInTheDocument();
  });
});
