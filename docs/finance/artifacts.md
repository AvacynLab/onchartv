# Finance Artefact Payloads

This document describes the JSON payloads that power the finance artefacts streamed by the chat agent. The schema mirrors the Zod definitions in `lib/finance/types.ts` and the artefact renderer components under `components/finance/*`.

## Common Conventions

- All timestamps are encoded as Unix seconds.
- Numeric values are expressed as floats unless otherwise stated.
- Optional fields are marked with _(optional)_.

## `finance.chart`

```jsonc
{
  "type": "finance.chart",
  "symbol": "BTCUSD",
  "timeframe": "1D",
  "range": { "from": 1672531200, "to": 1735689600 },
  "ohlcv": [
    { "t": 1672531200, "o": 16493.4, "h": 17000.0, "l": 16000.1, "c": 16854.2, "v": 2145.2 }
  ],
  "overlays": [
    { "kind": "sma", "length": 50 },
    { "kind": "sma", "length": 200 }
  ],
  "indicators": [
    { "kind": "rsi", "length": 14, "values": [ 55.2, 52.9 ] }
  ],
  "annotations": [
    { "kind": "pattern", "name": "hammer", "index": 12, "confidence": 0.82 },
    { "kind": "level", "name": "resistance", "price": 17500.0 }
  ],
  "metadata": {
    "requestedBy": "user",
    "generatedAt": 1735689600
  }
}
```

- `overlays` exposes overlays rendered on top of the candles (SMA, EMA, Bollinger bands).
- `indicators` contains oscillator series rendered in separate panes.
- `annotations` captures automatically detected patterns or support/resistance levels.

## `finance.backtest`

```jsonc
{
  "type": "finance.backtest",
  "runId": "bt_abc123",
  "symbol": "AAPL",
  "timeframe": "1D",
  "period": { "from": 1514764800, "to": 1609459200 },
  "strategy": {
    "name": "SMA Cross",
    "params": { "fast": 50, "slow": 200, "stopAtr": 2.0, "riskPerTrade": 0.01 }
  },
  "metrics": {
    "totalReturn": 0.32,
    "cagr": 0.14,
    "maxDrawdown": 0.18,
    "winRate": 0.55,
    "sharpe": 0.9,
    "profitFactor": 1.6,
    "averageTrade": 0.0042,
    "trades": 84
  },
  "equityCurve": [
    { "t": 1514764800, "e": 1.0 },
    { "t": 1517443200, "e": 1.01 }
  ],
  "trades": [
    {
      "id": "trade_1",
      "entry": { "t": 1514937600, "price": 172.3 },
      "exit": { "t": 1516852800, "price": 177.5 },
      "qty": 1,
      "side": "long",
      "pnl": 5.2,
      "pnlPct": 0.0302,
      "maxAdverseExcursion": -0.012,
      "maxFavourableExcursion": 0.034
    }
  ],
  "explanation": "La stratégie croisée SMA a généré un rendement annuel composé de 14% en surfant sur les tendances longues." 
}
```

## `finance.fundamentals`

```jsonc
{
  "type": "finance.fundamentals",
  "symbol": "NVDA",
  "asOf": 1736208000,
  "summary": "Croissance portée par les GPU IA avec marge brute record.",
  "metrics": [
    { "label": "Market Cap", "value": 2.1e12, "unit": "USD" },
    { "label": "Revenue (TTM)", "value": 60500000000, "unit": "USD" },
    { "label": "P/E", "value": 35.2 },
    { "label": "ROE", "value": 0.28 },
    { "label": "Debt/Equity", "value": 0.23 }
  ],
  "breakdowns": {
    "incomeStatement": [
      { "period": "2024-Q4", "revenue": 22000000000, "netIncome": 8500000000 }
    ],
    "balanceSheet": [
      { "period": "2024-Q4", "totalAssets": 150000000000, "totalLiabilities": 45000000000 }
    ]
  },
  "sources": [
    { "name": "MockEDGAR", "url": "https://example.com/nvda/q4" }
  ]
}
```

## `finance.news`

```jsonc
{
  "type": "finance.news",
  "symbol": "NVDA",
  "items": [
    {
      "id": "news_nvidia_1",
      "source": "MockWire",
      "title": "NVIDIA dévoile une nouvelle architecture GPU IA",
      "url": "https://example.com/nvidia-gpu",
      "publishedAt": 1736208000,
      "summary": "La société lance une puce optimisée pour les centres de données edge.",
      "sentiment": "positive"
    }
  ]
}
```

## `finance.screen`

```jsonc
{
  "type": "finance.screen",
  "filters": { "marketCapMin": 10000000000, "sector": "Technology" },
  "results": [
    {
      "symbol": "AAPL",
      "name": "Apple Inc.",
      "exchange": "NASDAQ",
      "score": 0.87,
      "highlights": [
        "Croissance du chiffre d'affaires de 8% YoY",
        "Marge brute stable à 43%"
      ]
    }
  ]
}
```

These shapes are stable contracts between the backend streaming pipeline and the renderer components. Any breaking change must update the associated Zod schemas, tests, and this document.
