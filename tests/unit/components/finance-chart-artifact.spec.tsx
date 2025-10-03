import React from "react";
import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";

import {
  FinanceChartArtifact,
  normalizeFinanceColor,
} from "@/components/finance/finance-chart-artifact";
import type { FinanceChartArtifact as FinanceChartPayload } from "@/lib/finance/types";
import { createChart } from "lightweight-charts";

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

const chartInstances: Array<{
  subscribeCrosshairMove: ReturnType<typeof vi.fn>;
  unsubscribeCrosshairMove: ReturnType<typeof vi.fn>;
  subscribeClick: ReturnType<typeof vi.fn>;
  unsubscribeClick: ReturnType<typeof vi.fn>;
  removeSeries: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}> = [];

const makeChartMock = () => {
  const chart = {
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
  };
  chartInstances.push(chart);
  return chart;
};

vi.mock("lightweight-charts", () => ({
  createChart: vi.fn(() => makeChartMock()),
  CrosshairMode: { Normal: 0 },
}));

beforeAll(() => {
  class ResizeObserverMock implements ResizeObserver {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element) {
      const entry: ResizeObserverEntry = {
        target,
        contentRect: {
          width: 640,
          height: 480,
          x: 0,
          y: 0,
          top: 0,
          right: 640,
          bottom: 480,
          left: 0,
          toJSON: () => ({}),
        },
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      };

      this.callback([entry], this as unknown as ResizeObserver);
    }

    unobserve() {}

    disconnect() {}

    takeRecords(): ResizeObserverEntry[] {
      return [];
    }
  }

  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

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
    localStorage.clear();
    crosshairHandlers.length = 0;
    clickHandlers.length = 0;
    chartInstances.length = 0;
    candlestickSeries.setData.mockClear();
    candlestickSeries.applyOptions.mockClear();
    lineSeries.setData.mockClear();
    lineSeries.applyOptions.mockClear();
    vi.mocked(createChart).mockClear();
  });

  const storageKeyFor = (payload: FinanceChartPayload) =>
    `finance.chart.overlays:${payload.symbol}:${payload.timeframe}`;

  describe("normalizeFinanceColor", () => {
    it("convertit les notations HSL en sortie rgba exploitable par Lightweight Charts", () => {
      expect(normalizeFinanceColor("hsl(240 3.8% 46.1%)")).toBe(
        "rgba(113, 113, 122, 1)"
      );
    });

    it("gère les composantes alpha fractionnaires", () => {
      expect(normalizeFinanceColor("hsla(200 50% 40% / 0.5)")).toBe(
        "rgba(51, 119, 153, 0.5)"
      );
    });

    it("convertit les alpha exprimés en pourcentage", () => {
      expect(normalizeFinanceColor("hsla(200 50% 40% / 75%)")).toBe(
        "rgba(51, 119, 153, 0.75)"
      );
    });
  });

  it("renders toggles, allows enabling/disabling overlays and persists the preference", async () => {
    const { unmount } = render(<FinanceChartArtifact artifact={artifact} />);

    const toggle = screen.getByRole("button", { name: /sma/i });
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(lineSeries.applyOptions).toHaveBeenCalledWith(
      expect.objectContaining({ visible: false })
    );

    const stored = window.localStorage.getItem(storageKeyFor(artifact));
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toMatchObject({ "sma-20": false });

    unmount();

    render(<FinanceChartArtifact artifact={artifact} />);

    const persistedToggle = await screen.findByRole("button", { name: /sma/i });
    expect(persistedToggle).toHaveAttribute("aria-pressed", "false");
  });

  it("affiche un état vide sans initialiser le chart lorsque la série OHLCV est vide", () => {
    render(
      <FinanceChartArtifact
        artifact={{
          ...artifact,
          ohlcv: [],
          overlays: [],
        }}
      />
    );

    expect(
      screen.getByTestId("finance-chart-empty-state")
    ).toBeInTheDocument();
    expect(createChart).not.toHaveBeenCalled();
  });

  it("initialise le chart une seule fois malgré les rerenders successifs", () => {
    const { rerender, unmount } = render(
      <FinanceChartArtifact artifact={artifact} />
    );

    expect(createChart).toHaveBeenCalledTimes(1);

    rerender(<FinanceChartArtifact artifact={{ ...artifact }} />);

    expect(createChart).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("ignore gracieusement les événements de pointeur sans données de série", () => {
    render(<FinanceChartArtifact artifact={artifact} />);

    const hoverHandler = crosshairHandlers.at(-1);
    const clickHandler = clickHandlers.at(-1);

    expect(hoverHandler).toBeDefined();
    expect(clickHandler).toBeDefined();

    expect(() => {
      act(() => {
        hoverHandler?.({ time: artifact.ohlcv[0]!.t, seriesData: new Map() });
        clickHandler?.({ time: artifact.ohlcv[0]!.t, seriesData: new Map() });
      });
    }).not.toThrow();
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
    const describedBy = chart.getAttribute("aria-describedby") ?? "";
    const descriptionIds = describedBy.trim().split(/\s+/);
    expect(descriptionIds).toContain(detailPanel.getAttribute("id"));
    const keyboardHint = document.getElementById(descriptionIds[0]!);
    expect(keyboardHint?.textContent).toMatch(/flèches gauche et droite/i);

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

  it("permet la navigation clavier des bougies et conserve le focus accessible", async () => {
    render(<FinanceChartArtifact artifact={artifact} />);

    const chart = screen.getByRole("img", {
      name: /graphique en chandeliers pour aapl en 1d/i,
    });

    await act(async () => {
      chart.focus();
    });
    // Keyboard navigation updates internal state asynchronously via React
    // effects; wrapping the interaction in `act` keeps React Test Utils aware
    // of those updates and removes the warnings emitted by Testing Library.
    await act(async () => {
      await userEvent.keyboard("{ArrowLeft}");
    });

    const detailPanel = screen.getByTestId("finance-chart-details");
    expect(detailPanel).toHaveTextContent(/170\.00/);

    await act(async () => {
      await userEvent.keyboard("{End}");
    });
    expect(detailPanel).toHaveTextContent(/174\.00/);
  });

  it("enregistre et libère les abonnements chartistiques lors du démontage", () => {
    const { unmount } = render(<FinanceChartArtifact artifact={artifact} />);

    const latestChart = chartInstances.at(-1);
    expect(latestChart).toBeDefined();

    const crosshair = crosshairHandlers.at(-1);
    const click = clickHandlers.at(-1);

    unmount();

    expect(latestChart?.unsubscribeCrosshairMove).toHaveBeenCalledWith(crosshair);
    expect(latestChart?.unsubscribeClick).toHaveBeenCalledWith(click);
    expect(latestChart?.remove).toHaveBeenCalled();
  });
});
