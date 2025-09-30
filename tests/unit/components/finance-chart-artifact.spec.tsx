import React from "react";
import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FinanceChartArtifact } from "@/components/finance/finance-chart-artifact";
import type { FinanceChartArtifact as FinanceChartPayload } from "@/lib/finance/types";

type CrosshairHandler = (param: any) => void;

type ClickHandler = (param: any) => void;

const crosshairHandlers: CrosshairHandler[] = [];
const clickHandlers: ClickHandler[] = [];

const candlestickSeries = {
  setData: vi.fn(),
  applyOptions: vi.fn(),
};

const lineSeries = {
  setData: vi.fn(),
  applyOptions: vi.fn(),
};


vi.mock("lightweight-charts", () => ({
  createChart: vi.fn(() => ({
    applyOptions: vi.fn(),
    addCandlestickSeries: vi.fn(() => candlestickSeries),
    addLineSeries: vi.fn(() => ({ ...lineSeries })),
    timeScale: vi.fn(() => ({ fitContent: vi.fn(), setVisibleRange: vi.fn() })),
    subscribeCrosshairMove: vi.fn((handler: CrosshairHandler) => {
      crosshairHandlers.push(handler);
    }),
    unsubscribeCrosshairMove: vi.fn(),
    subscribeClick: vi.fn((handler: ClickHandler) => {
      clickHandlers.push(handler);
    }),
    unsubscribeClick: vi.fn(),
    removeSeries: vi.fn(),
    remove: vi.fn(),
  })),
  CrosshairMode: { Normal: 0 },
}));

describe("FinanceChartArtifact", () => {
  const artifact: FinanceChartPayload = {
    type: "finance.chart",
    symbol: "AAPL",
    timeframe: "1D",
    range: { from: "2024-01-01", to: "2024-03-01" },
    ohlcv: [
      { t: 1_700_000_000, o: 170, h: 175, l: 168, c: 172, v: 1_000_000 },
      { t: 1_700_086_400, o: 172, h: 176, l: 170, c: 174, v: 950_000 },
    ],
    overlays: [
      {
        type: "sma",
        length: 20,
        values: [
          { t: 1_700_000_000, v: 170 },
          { t: 1_700_086_400, v: 171 },
        ],
      },
    ],
  };

  beforeEach(() => {
    crosshairHandlers.length = 0;
    clickHandlers.length = 0;
    candlestickSeries.setData.mockClear();
    candlestickSeries.applyOptions.mockClear();
    lineSeries.setData.mockClear();
    lineSeries.applyOptions.mockClear();
  });

  it("renders toggles and allows enabling/disabling overlays", async () => {
    render(<FinanceChartArtifact artifact={artifact} />);

    const toggle = screen.getByRole("button", { name: /sma/i });
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("expose des repères d'accessibilité pour le graphique et ses contrôles", () => {
    render(<FinanceChartArtifact artifact={artifact} />);

    /**
     * Les contrôles principaux doivent relier explicitement les titres, le
     * graphique et le panneau de détails pour la navigation assistée.
     */
    const chart = screen.getByRole("img", {
      name: /graphique en chandeliers pour aapl en 1d/i,
    });
    const detailPanel = screen.getByRole("status");
    const heading = screen.getByRole("heading", { level: 3, name: /aapl · 1d/i });

    expect(detailPanel).toHaveAttribute("aria-live", "polite");
    const labelledBy = chart.getAttribute("aria-labelledby") ?? "";
    const headingId = heading.getAttribute("id") ?? "";
    expect(labelledBy.trim().split(/\s+/)).toContain(headingId);
    expect(chart).toHaveAttribute("aria-describedby", detailPanel.getAttribute("id"));

    const overlayGroup = screen.getByRole("group", {
      name: /indicateurs superposés/i,
    });
    const chartId = chart.getAttribute("id");

    expect(chartId).toBeTruthy();
    expect(overlayGroup).toHaveAttribute("aria-controls", chartId as string);

    const overlayNote = screen.getByRole("note");
    expect(overlayGroup).toHaveAttribute(
      "aria-describedby",
      overlayNote.getAttribute("id") ?? undefined
    );

    const zoomControl = screen.getByRole("button", { name: /zoom 1m/i });
    expect(zoomControl).toHaveAttribute("aria-controls", chartId as string);
  });

  it("updates the inspection panel when hovering candles", () => {
    render(<FinanceChartArtifact artifact={artifact} />);
    const handler = crosshairHandlers.at(-1);

    expect(handler).toBeDefined();

    act(() => {
      handler?.({
        time: artifact.ohlcv[0]!.t,
        seriesData: new Map([
          [
            candlestickSeries,
            {
              time: artifact.ohlcv[0]!.t,
              open: artifact.ohlcv[0]!.o,
              high: artifact.ohlcv[0]!.h,
              low: artifact.ohlcv[0]!.l,
              close: artifact.ohlcv[0]!.c,
            },
          ],
        ]),
      });
    });

    const detailPanel = screen.getByTestId("finance-chart-details");
    expect(detailPanel).toHaveTextContent(/Ouverture\s*170\.00/);
    expect(detailPanel).toHaveTextContent(/Clôture\s*172\.00/);
  });
});
