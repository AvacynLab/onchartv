"use client";

import React from "react";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  useId,
} from "react";
import {
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
  createChart,
  CrosshairMode,
} from "lightweight-charts";
import { InfoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  FinanceChartAnnotationsArtifact,
  FinanceChartArtifact as FinanceChartArtifactPayload,
} from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { ChartAnnotationsPanel } from "./chart-annotations-panel";

/**
 * Number of seconds contained in a single day. The mock data generator emits
 * daily candles so the constant keeps the range controls readable.
 */
const SECONDS_PER_DAY = 86_400;

/**
 * User-facing presets that let analysts quickly zoom into the most common
 * horizons. Values are expressed in trading days and intentionally cover
 * multiple time buckets (short-term to max history).
 */
const RANGE_PRESETS = [
  { id: "1M", label: "1M", lookbackDays: 22 },
  { id: "3M", label: "3M", lookbackDays: 66 },
  { id: "6M", label: "6M", lookbackDays: 132 },
  { id: "1Y", label: "1Y", lookbackDays: 264 },
  { id: "MAX", label: "Max", lookbackDays: Number.POSITIVE_INFINITY },
] as const;

type OverlayVisibilityState = Record<string, boolean>;

/**
 * Visible information derived from the hovered/selected candle. Keeping both the
 * raw candle and the pre-formatted label makes the render method easier to read.
 */
type CandleSnapshot = {
  readonly candle: CandlestickData;
  readonly label: string;
};

/**
 * Theme palette extracted from CSS custom properties so the chart inherits the
 * same contrast levels in both light and dark mode. Keeping the structure
 * explicit allows tests to assert the runtime behaviour without depending on
 * global CSS files.
 */
type ThemePalette = {
  readonly text: string;
  readonly grid: string;
  readonly candleUp: string;
  readonly candleUpBorder: string;
  readonly candleUpWick: string;
  readonly candleDown: string;
  readonly candleDownBorder: string;
  readonly candleDownWick: string;
  readonly overlaySma: string;
  readonly overlayEma: string;
};

/**
 * Lightweight Charts (the underlying finance renderer) only accepts CSS Level
 * 3 colour syntax for the `hsl()` helpers. Our design tokens use the more
 * modern whitespace-separated notation which triggers runtime "Cannot parse
 * color" errors. Normalising the tokens once keeps the component resilient on
 * both the server (during hydration) and the client (when Playwright toggles
 * themes mid-test).
 */
export function normalizeFinanceColor(color: string): string {
  const trimmed = color.trim();
  const hslMatch = /^\s*(hsl|hsla)\(\s*([^)]*?)\s*\)\s*$/i.exec(trimmed);

  if (!hslMatch) {
    return trimmed;
  }

  if (trimmed.includes(",")) {
    return `${hslMatch[1].toLowerCase()}(${hslMatch[2]})`;
  }

  const [, fnName, body] = hslMatch;
  const [rawMain, rawAlpha] = body.split("/").map((segment) => segment.trim());
  const components = rawMain.split(/\s+/).filter(Boolean);

  if (components.length < 3) {
    return `${fnName.toLowerCase()}(${rawMain})`;
  }

  const normalisedMain = components.join(", ");
  const fn = fnName.toLowerCase();

  if (rawAlpha) {
    return `${fn}(${normalisedMain}, ${rawAlpha})`;
  }

  return `${fn}(${normalisedMain})`;
}

/** Internal helper describing the visible time window accepted by the scale. */
type ChartTimeRange = { from: UTCTimestamp; to: UTCTimestamp };

const FALLBACK_PALETTE: ThemePalette = {
  text: normalizeFinanceColor("hsl(240 3.8% 46.1%)"),
  grid: normalizeFinanceColor("hsl(220 16% 90%)"),
  candleUp: "#22c55e",
  candleUpBorder: "#15803d",
  candleUpWick: "#166534",
  candleDown: "#ef4444",
  candleDownBorder: "#b91c1c",
  candleDownWick: "#991b1b",
  overlaySma: "#2563eb",
  overlayEma: "#d946ef",
};

const FINANCE_COLOR_VARIABLES: Record<keyof ThemePalette, string> = {
  text: "--finance-chart-text",
  grid: "--finance-chart-grid",
  candleUp: "--finance-candle-up",
  candleUpBorder: "--finance-candle-up-border",
  candleUpWick: "--finance-candle-up-wick",
  candleDown: "--finance-candle-down",
  candleDownBorder: "--finance-candle-down-border",
  candleDownWick: "--finance-candle-down-wick",
  overlaySma: "--finance-overlay-sma",
  overlayEma: "--finance-overlay-ema",
};

const readColorVariable = (
  style: CSSStyleDeclaration,
  variable: string,
  fallback: string
) => {
  const value = normalizeFinanceColor(style.getPropertyValue(variable));
  return value.length === 0 ? fallback : value;
};

const computePaletteFromDocument = (): ThemePalette => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return FALLBACK_PALETTE;
  }

  const style = getComputedStyle(document.documentElement);

  return {
    text: readColorVariable(style, FINANCE_COLOR_VARIABLES.text, FALLBACK_PALETTE.text),
    grid: readColorVariable(style, FINANCE_COLOR_VARIABLES.grid, FALLBACK_PALETTE.grid),
    candleUp: readColorVariable(
      style,
      FINANCE_COLOR_VARIABLES.candleUp,
      FALLBACK_PALETTE.candleUp
    ),
    candleUpBorder: readColorVariable(
      style,
      FINANCE_COLOR_VARIABLES.candleUpBorder,
      FALLBACK_PALETTE.candleUpBorder
    ),
    candleUpWick: readColorVariable(
      style,
      FINANCE_COLOR_VARIABLES.candleUpWick,
      FALLBACK_PALETTE.candleUpWick
    ),
    candleDown: readColorVariable(
      style,
      FINANCE_COLOR_VARIABLES.candleDown,
      FALLBACK_PALETTE.candleDown
    ),
    candleDownBorder: readColorVariable(
      style,
      FINANCE_COLOR_VARIABLES.candleDownBorder,
      FALLBACK_PALETTE.candleDownBorder
    ),
    candleDownWick: readColorVariable(
      style,
      FINANCE_COLOR_VARIABLES.candleDownWick,
      FALLBACK_PALETTE.candleDownWick
    ),
    overlaySma: readColorVariable(
      style,
      FINANCE_COLOR_VARIABLES.overlaySma,
      FALLBACK_PALETTE.overlaySma
    ),
    overlayEma: readColorVariable(
      style,
      FINANCE_COLOR_VARIABLES.overlayEma,
      FALLBACK_PALETTE.overlayEma
    ),
  };
};

const palettesEqual = (a: ThemePalette, b: ThemePalette) =>
  Object.entries(a).every(([key, value]) => b[key as keyof ThemePalette] === value);

/**
 * Local storage namespace used to persist overlay visibility across sessions so
 * that analysts keep their preferred SMA/EMA combinations when reopening the
 * chart artefact.
 */
const OVERLAY_STORAGE_NAMESPACE = "finance.chart.overlays";

const isOverlayVisibilityRecord = (value: unknown): value is OverlayVisibilityState => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === "boolean");
};

/**
 * Properties accepted by the finance chart artefact renderer. An optional
 * `annotations` payload augments the base OHLCV view with pattern detection
 * output streamed by `tool.finance.chart.annotate`.
 */
export interface FinanceChartArtifactProps {
  readonly artifact: FinanceChartArtifactPayload;
  readonly annotations?: FinanceChartAnnotationsArtifact | null;
  readonly onExplainCandle?: (params: {
    readonly timestamp: number;
    readonly symbol: string;
  }) => void;
}

const formatPrice = (value: number) =>
  value >= 1000 ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : value.toFixed(2);

const formatPercent = (value: number) =>
  `${(value * 100).toFixed(2)}%`;

const overlayId = (overlay: FinanceChartArtifactPayload["overlays"][number]) =>
  `${overlay.type}-${overlay.length}`;

const buildCandleLabel = (symbol: string, candle: CandlestickData) => {
  if (!candle.time) {
    return symbol;
  }
  const date = new Date(Number(candle.time) * 1_000)
    .toISOString()
    .split("T")[0];
  const change = candle.close && candle.open
    ? (Number(candle.close) - Number(candle.open)) / Number(candle.open)
    : 0;
  return `${symbol} · ${date} · ${formatPrice(Number(candle.close ?? candle.open ?? 0))} (${formatPercent(change)})`;
};

/**
 * Interactive renderer dedicated to `finance.chart` artefacts. Lightweight
 * charts are instantiated imperatively and decorated with overlay toggles,
 * crosshair tooltips, and range shortcuts so analysts can explore the data
 * without leaving the chat surface.
 */
export const FinanceChartArtifact = memo(
  ({ artifact, annotations, onExplainCandle }: FinanceChartArtifactProps) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const overlaySeriesRef = useRef<Map<string, ISeriesApi<"Line">>>(
      new Map()
    );
    const crosshairHandlerRef =
      useRef<((param: MouseEventParams<Time>) => void) | null>(null);
    const clickHandlerRef = useRef<((param: MouseEventParams<Time>) => void) | null>(
      null
    );
    const paletteRef = useRef<ThemePalette>(FALLBACK_PALETTE);

    const [overlayVisibility, setOverlayVisibility] = useState<
      OverlayVisibilityState
    >({});
    const [hovered, setHovered] = useState<CandleSnapshot | null>(null);
    const [selected, setSelected] = useState<CandleSnapshot | null>(null);
    const [palette, setPalette] = useState<ThemePalette>(FALLBACK_PALETTE);
    const overlayPreferencesRef = useRef<OverlayVisibilityState | null>(null);

    const chartHeadingId = useId();
    const chartContainerId = useId();
    const chartAccessibleLabelId = useId();
    const overlayDescriptionId = useId();
    const detailPanelId = useId();
    const keyboardHintId = useId();

    const overlayStorageKey = useMemo(
      () => `${OVERLAY_STORAGE_NAMESPACE}:${artifact.symbol}:${artifact.timeframe}`,
      [artifact.symbol, artifact.timeframe]
    );

    const candlestickData = useMemo(
      () =>
        artifact.ohlcv.map((candle) => ({
          time: candle.t as UTCTimestamp,
          open: candle.o,
          high: candle.h,
          low: candle.l,
          close: candle.c,
        } satisfies CandlestickData)),
      [artifact.ohlcv]
    );

    const candleSnapshots = useMemo(
      () =>
        candlestickData.map((candle) => ({
          candle,
          label: buildCandleLabel(artifact.symbol, candle),
        } satisfies CandleSnapshot)),
      [artifact.symbol, candlestickData]
    );

    const latestSnapshot = candleSnapshots.at(-1) ?? null;

    useEffect(() => {
      if (typeof window === "undefined") {
        overlayPreferencesRef.current = null;
        return;
      }

      try {
        const stored = window.localStorage.getItem(overlayStorageKey);
        if (!stored) {
          overlayPreferencesRef.current = null;
          return;
        }

        const parsed = JSON.parse(stored);
        if (isOverlayVisibilityRecord(parsed)) {
          overlayPreferencesRef.current = parsed;
          setOverlayVisibility(parsed);
        } else {
          overlayPreferencesRef.current = null;
        }
      } catch {
        overlayPreferencesRef.current = null;
      }
    }, [overlayStorageKey]);

    useEffect(() => {
      /**
       * Observe the document class list so toggling dark mode immediately
       * updates the chart colours without requiring a full rerender.
       */
      if (typeof window === "undefined" || typeof document === "undefined") {
        return;
      }

      const applyPalette = () => {
        const next = computePaletteFromDocument();
        setPalette((current) => (palettesEqual(current, next) ? current : next));
      };

      applyPalette();

      if (typeof MutationObserver === "undefined") {
        return;
      }

      const observer = new MutationObserver(applyPalette);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });

      return () => {
        observer.disconnect();
      };
    }, []);

    useEffect(() => {
      if (!containerRef.current || chartRef.current) {
        return;
      }

      const chart = createChart(containerRef.current, {
        height: 360,
        layout: {
          textColor: paletteRef.current.text,
          background: { color: "transparent" },
        },
        grid: {
          horzLines: { color: paletteRef.current.grid },
          vertLines: { color: paletteRef.current.grid },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
        },
      });

      const candleSeries = chart.addCandlestickSeries({
        priceScaleId: "right",
        upColor: paletteRef.current.candleUp,
        borderUpColor: paletteRef.current.candleUpBorder,
        wickUpColor: paletteRef.current.candleUpWick,
        downColor: paletteRef.current.candleDown,
        borderDownColor: paletteRef.current.candleDownBorder,
        wickDownColor: paletteRef.current.candleDownWick,
      });

      const crosshairHandler = (param: MouseEventParams<Time>) => {
        if (!param || !param.time || !param.seriesData) {
          setHovered(null);
          return;
        }
        const seriesData = param.seriesData.get(candleSeries) as
          | CandlestickData
          | undefined;
        if (seriesData) {
          setHovered({
            candle: seriesData,
            label: buildCandleLabel(artifact.symbol, seriesData),
          });
        }
      };

      const clickHandler = (param: MouseEventParams<Time>) => {
        if (!param || !param.time || !param.seriesData) {
          return;
        }
        const seriesData = param.seriesData.get(candleSeries) as
          | CandlestickData
          | undefined;
        if (seriesData) {
          const snapshot = {
            candle: seriesData,
            label: buildCandleLabel(artifact.symbol, seriesData),
          };
          setSelected(snapshot);
        }
      };

      chart.subscribeCrosshairMove(crosshairHandler);
      chart.subscribeClick(clickHandler);

      candleSeriesRef.current = candleSeries;
      chartRef.current = chart;
      crosshairHandlerRef.current = crosshairHandler;
      clickHandlerRef.current = clickHandler;

      return () => {
        if (crosshairHandlerRef.current) {
          chart.unsubscribeCrosshairMove(crosshairHandlerRef.current);
        }
        if (clickHandlerRef.current) {
          chart.unsubscribeClick(clickHandlerRef.current);
        }
        overlaySeriesRef.current.forEach((series) => {
          chart.removeSeries(series);
        });
        overlaySeriesRef.current.clear();
        chart.removeSeries(candleSeries);
        chart.remove();
        chartRef.current = null;
        candleSeriesRef.current = null;
        crosshairHandlerRef.current = null;
        clickHandlerRef.current = null;
      };
    }, [artifact.symbol]);

    useEffect(() => {
      const chart = chartRef.current;
      const candleSeries = candleSeriesRef.current;
      if (!chart || !candleSeries) {
        return;
      }

      candleSeries.setData(candlestickData);
      chart.timeScale().fitContent();
      setSelected((current) => current ?? latestSnapshot);
      setHovered(null);
    }, [candlestickData, latestSnapshot]);

    useEffect(() => {
      const chart = chartRef.current;
      if (!chart) {
        return;
      }

      overlaySeriesRef.current.forEach((series) => {
        chart.removeSeries(series);
      });
      overlaySeriesRef.current.clear();

      artifact.overlays.forEach((overlay) => {
        /**
         * The palette ref keeps the latest themed colours so overlays blend
         * seamlessly with the surrounding UI in both light and dark contexts.
         */
        const overlayColourValue =
          overlay.type === "sma"
            ? paletteRef.current.overlaySma
            : paletteRef.current.overlayEma;
        const series = chart.addLineSeries({
          color: overlayColourValue,
          lineWidth: 2,
          priceScaleId: "right",
          title: `${overlay.type.toUpperCase()} (${overlay.length})`,
        });
        const lineData = overlay.values
          .filter((point) => point.v !== null)
          .map((point) => ({
            time: point.t as UTCTimestamp,
            value: point.v as number,
          }));
        series.setData(lineData);
        overlaySeriesRef.current.set(overlayId(overlay), series);
      });

      setOverlayVisibility((prev) => {
        const next: OverlayVisibilityState = {};
        const stored = overlayPreferencesRef.current;
        artifact.overlays.forEach((overlay) => {
          const id = overlayId(overlay);
          const visible = stored?.[id] ?? prev[id] ?? true;
          next[id] = visible;
          const series = overlaySeriesRef.current.get(id);
          if (series) {
            series.applyOptions({ visible });
          }
        });
        return next;
      });

      return () => {
        overlaySeriesRef.current.forEach((series) => {
          chart.removeSeries(series);
        });
        overlaySeriesRef.current.clear();
      };
    }, [artifact.overlays]);

    useEffect(() => {
      overlayPreferencesRef.current = overlayVisibility;

      if (typeof window === "undefined") {
        return;
      }

      if (Object.keys(overlayVisibility).length === 0) {
        return;
      }

      try {
        window.localStorage.setItem(
          overlayStorageKey,
          JSON.stringify(overlayVisibility)
        );
      } catch {
        /**
         * Silently ignore storage quota or privacy mode errors. Persisting the
         * overlays is a progressive enhancement and should not break the chart
         * when the browser refuses to store the data.
         */
      }
    }, [overlayVisibility, overlayStorageKey]);

    useEffect(() => {
      /**
       * Sync the runtime palette with the underlying chart instance so the
       * axis labels, candles and overlays react to theme changes instantly.
       */
      paletteRef.current = palette;

      const chart = chartRef.current;
      const candleSeries = candleSeriesRef.current;
      if (!chart || !candleSeries) {
        return;
      }

      chart.applyOptions({
        layout: {
          textColor: palette.text,
          background: { color: "transparent" },
        },
        grid: {
          horzLines: { color: palette.grid },
          vertLines: { color: palette.grid },
        },
      });

      candleSeries.applyOptions({
        upColor: palette.candleUp,
        borderUpColor: palette.candleUpBorder,
        wickUpColor: palette.candleUpWick,
        downColor: palette.candleDown,
        borderDownColor: palette.candleDownBorder,
        wickDownColor: palette.candleDownWick,
      });

      overlaySeriesRef.current.forEach((series, id) => {
        const overlayDefinition = artifact.overlays.find(
          (candidate) => overlayId(candidate) === id
        );
        if (!overlayDefinition) {
          return;
        }
        series.applyOptions({
          color:
            overlayDefinition.type === "sma"
              ? palette.overlaySma
              : palette.overlayEma,
        });
      });
    }, [palette, artifact.overlays]);

    const handleToggleOverlay = (id: string) => {
      setOverlayVisibility((prev) => {
        const visible = !(prev[id] ?? true);
        const next = { ...prev, [id]: visible };
        const series = overlaySeriesRef.current.get(id);
        if (series) {
          series.applyOptions({ visible });
        }
        return next;
      });
    };

    const handleRangePreset = (preset: (typeof RANGE_PRESETS)[number]) => {
      const chart = chartRef.current;
      if (!chart) {
        return;
      }
      if (preset.lookbackDays === Number.POSITIVE_INFINITY) {
        chart.timeScale().fitContent();
        return;
      }
      const last = artifact.ohlcv.at(-1);
      const first = artifact.ohlcv.at(0);
      if (!last || !first) {
        return;
      }
      const from = Math.max(
        last.t - preset.lookbackDays * SECONDS_PER_DAY,
        first.t
      );
      const visibleRange: ChartTimeRange = {
        from: from as UTCTimestamp,
        to: last.t as UTCTimestamp,
      };
      chart.timeScale().setVisibleRange(visibleRange);
    };

    const findSnapshotIndex = (snapshot: CandleSnapshot | null) => {
      if (!snapshot) {
        return -1;
      }
      return candleSnapshots.findIndex(
        (candidate) => candidate.candle.time === snapshot.candle.time
      );
    };

    const handleChartFocus = () => {
      if (!candleSnapshots.length) {
        return;
      }
      setHovered((current) => current ?? selected ?? latestSnapshot);
      setSelected((current) => {
        if (current) {
          return current;
        }
        return latestSnapshot;
      });
    };

    const handleChartBlur = () => {
      setHovered(null);
    };

    const handleChartKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!candleSnapshots.length) {
        return;
      }

      const active = hovered ?? selected ?? latestSnapshot;
      const lastIndex = candleSnapshots.length - 1;
      const currentIndex = findSnapshotIndex(active);
      const baseIndex = currentIndex === -1 ? lastIndex : currentIndex;
      let nextIndex = baseIndex;

      switch (event.key) {
        case "ArrowLeft":
          nextIndex = baseIndex <= 0 ? 0 : baseIndex - 1;
          break;
        case "ArrowRight":
          nextIndex = baseIndex >= lastIndex ? lastIndex : baseIndex + 1;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = lastIndex;
          break;
        case "PageUp":
          nextIndex = Math.max(0, baseIndex - 5);
          break;
        case "PageDown":
          nextIndex = Math.min(lastIndex, baseIndex + 5);
          break;
        case "Enter":
          if (onExplainCandle && active) {
            event.preventDefault();
            onExplainCandle({
              timestamp: Number(active.candle.time),
              symbol: artifact.symbol,
            });
          }
          return;
        default:
          return;
      }

      event.preventDefault();

      if (nextIndex === baseIndex) {
        return;
      }

      const snapshot = candleSnapshots[nextIndex];
      if (!snapshot) {
        return;
      }

      setSelected(snapshot);
      setHovered(snapshot);
    };

    const activeSnapshot = hovered ?? selected ?? latestSnapshot;

    return (
      <div className="space-y-4" data-testid="finance-chart-artifact">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-lg" id={chartHeadingId}>
              {artifact.symbol} · {artifact.timeframe}
            </h3>
            <p className="text-muted-foreground text-sm">
              Fenêtre {artifact.range.from} → {artifact.range.to}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {RANGE_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                aria-label={`Zoom ${preset.label}`}
                aria-controls={chartContainerId}
                onClick={() => handleRangePreset(preset)}
                size="sm"
                type="button"
                variant="outline"
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </header>

        <div
          aria-describedby={[keyboardHintId, activeSnapshot ? detailPanelId : null]
            .filter(Boolean)
            .join(" ") || undefined}
          aria-labelledby={`${chartAccessibleLabelId} ${chartHeadingId}`}
          className="relative overflow-hidden rounded-lg border bg-card"
          id={chartContainerId}
          ref={containerRef}
          role="img"
          tabIndex={0}
          onFocus={handleChartFocus}
          onBlur={handleChartBlur}
          onKeyDown={handleChartKeyDown}
        >
          <span className="sr-only" id={chartAccessibleLabelId}>
            Graphique en chandeliers pour {artifact.symbol} en {artifact.timeframe}
          </span>
          <span className="sr-only" id={keyboardHintId}>
            Utilisez les flèches gauche et droite pour parcourir les bougies, Page
            Up/Page Down pour avancer ou reculer par blocs, Home/End pour accéder
            aux extrêmes et Entrée pour lancer l'explication lorsqu'elle est
            disponible.
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <fieldset
            aria-controls={chartContainerId}
            aria-describedby={overlayDescriptionId}
            className="flex min-w-0 flex-wrap items-center gap-2 border-0 p-0"
          >
            <legend className="sr-only">Indicateurs superposés</legend>
            {artifact.overlays.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Aucun indicateur superposé.
              </p>
            ) : (
              artifact.overlays.map((overlay) => {
                const id = overlayId(overlay);
                const isActive = overlayVisibility[id] ?? true;
                return (
                  <Button
                    key={id}
                    aria-pressed={isActive}
                    className={cn(
                      "border",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                    onClick={() => handleToggleOverlay(id)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {overlay.type.toUpperCase()} ({overlay.length})
                  </Button>
                );
              })
            )}
          </fieldset>
          <p
            className="flex items-center gap-2 text-muted-foreground text-sm"
            id={overlayDescriptionId}
            role="note"
          >
            <InfoIcon aria-hidden="true" className="size-4" />
            Survolez ou cliquez une bougie pour voir les détails.
          </p>
        </div>

        {activeSnapshot ? (
          <div
            aria-live="polite"
            className="rounded-lg border p-4"
            data-testid="finance-chart-details"
            id={detailPanelId}
            role="status"
          >
            <p className="font-medium">{activeSnapshot.label}</p>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Ouverture</dt>
                <dd>{formatPrice(Number(activeSnapshot.candle.open ?? 0))}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Haut</dt>
                <dd>{formatPrice(Number(activeSnapshot.candle.high ?? 0))}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Bas</dt>
                <dd>{formatPrice(Number(activeSnapshot.candle.low ?? 0))}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Clôture</dt>
                <dd>{formatPrice(Number(activeSnapshot.candle.close ?? 0))}</dd>
              </div>
            </dl>
            {selected && onExplainCandle ? (
              <Button
                className="mt-3"
                onClick={() =>
                  onExplainCandle({
                    timestamp: Number(selected.candle.time),
                    symbol: artifact.symbol,
                  })
                }
                size="sm"
                type="button"
              >
                Expliquer cette bougie
              </Button>
            ) : null}
          </div>
        ) : null}

        {annotations ? <ChartAnnotationsPanel annotations={annotations} /> : null}
      </div>
    );
  }
);

FinanceChartArtifact.displayName = "FinanceChartArtifact";
