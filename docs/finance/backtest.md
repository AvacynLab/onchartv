# Backtest Engine Assumptions

The TypeScript backtest engine in `lib/finance/backtest/engine.ts` evaluates strategies deterministically using offline market data. This document details the calculation methodology, limits, and interpretation guidelines.

## Supported Strategies

- **SMA Crossover**: Generates a long signal when the fast SMA crosses above the slow SMA and exits when the inverse cross occurs.
- Additional strategies can plug into the engine by implementing the `StrategyExecutor` interface and returning trade signals on each candle.

## Input Expectations

- OHLCV candles must be chronologically ordered and share a uniform timeframe.
- Strategy parameters (e.g. `fast`, `slow`, `riskPerTrade`) are validated via Zod before execution.
- Optional risk controls:
  - `slippageBps` (default 10 bps) applies on both entry and exit prices.
  - `commissionPct` (default 0.0005) is deducted from trade PnL.
  - `riskPerTrade` (default 0.01) defines the fraction of equity risked per signal.

## Trade Lifecycle

1. A signal opens a position sized from the configured risk and stop distance.
2. The engine simulates price evolution candle-by-candle, applying stop-loss and take-profit logic when provided.
3. Positions close on opposite signals or when stops/targets trigger.
4. Each trade records:
   - Entry/exit timestamps and prices (adjusted for slippage).
   - Quantity and direction (`long` or `short`).
   - Realised PnL in currency and as a percentage of the entry price.
   - Maximum favourable and adverse excursions.

## Metrics

Let `E_t` be the equity curve sampled per candle and `r_i` the per-trade returns.

- **Total Return**: `E_T / E_0 - 1`.
- **CAGR**: `(E_T / E_0)^{252 / nBars} - 1` (assuming 252 trading days).
- **Max Drawdown**: Maximum peak-to-trough decline on the equity curve.
- **Win Rate**: `wins / trades`.
- **Average Trade**: Arithmetic mean of `r_i`.
- **Sharpe Ratio**: `mean(r_i) / std(r_i) * sqrt(252)` with zero risk-free rate.
- **Profit Factor**: `sum(r_i^+) / |sum(r_i^-)|`.

All metrics are rounded to four decimals before emission to keep artefacts readable.

## Limitations

- No overnight financing or corporate action adjustments are modelled.
- Intraday gaps are approximated by candle close-to-open transitions.
- When insufficient data exists for indicators (e.g. fewer candles than SMA length), the strategy defers entries until values stabilise.
- Offline datasets are bounded; requesting a period beyond the mock catalogue returns the available window.

## Interpreting Reports

- Validate that `trades` is non-empty before drawing conclusions; zero trades often indicates parameter mismatch or trendless data.
- Cross-reference `annotations` from the chart artefact to contextualise entries and exits.
- Always communicate risk disclosures in user-facing explanations (no personalised investment advice).
