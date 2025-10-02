# Finance API Reference

The `/api/finance/*` routes expose offline-friendly market data and analytics. All handlers enforce strict Zod validation, rate limiting, and return deterministic mock payloads for local development and CI.

## Usage responsable & mode hors ligne

- **Ce n’est pas un conseil financier** : les réponses issues des routes décrites ci-dessous sont éducatives et n’ont pas vocation à remplacer un avis professionnel.
- **Données simulées par défaut** : tant que `FEATURE_USE_REAL_DATA` n’est pas activé avec les identifiants requis, tous les endpoints répondent via les jeux de données de `lib/finance/mock-data.ts`. Les timestamps sont gelés pour garantir la reproductibilité des tests.
- **Vérifications nécessaires** : si vous activez un fournisseur externe, affichez un avertissement équivalent côté produit et exposez les hypothèses de calcul (commission, slippage, limites d’horizon) dans vos interfaces.
- **Terminologie normalisée** : les champs JSON documentés ci-dessous suivent exactement les clés exposées par `lib/finance/types.ts` (`maxDrawdown`, `winRate`, `profitFactor`, etc.) afin d’éviter toute ambiguïté dans les artefacts et la documentation.

> **Real provider opt-in**
>
> Set `FEATURE_USE_REAL_DATA=true` together with `MARKET_DATA_API_BASE_URL` and `MARKET_DATA_API_KEY` to switch the quote/history
> endpoints to the HTTP adapter. When the flag is disabled (default) or configuration is incomplete, the routes fall back to the
> deterministic mocks documented below.

## Authentication & Rate Limiting

- Routes are currently public; session checks can be added when multi-tenant isolation is required.
- Each endpoint is guarded by the shared limiter in `lib/ratelimit.ts` (default: 60 requests/minute/IP).
- Errors return a JSON body `{ "error": { "code": string, "message": string } }` with HTTP status codes aligned to the failure (400, 404, 429, 500).

## `GET /api/finance/quote`

Query parameters:

| Name   | Type   | Description                           |
|--------|--------|---------------------------------------|
| symbol | string | Supported ticker (e.g. `AAPL`, `BTCUSD`). |

Response body:

```jsonc
{
  "symbol": "AAPL",
  "price": 189.22,
  "change": 0.012,
  "changePct": 0.64,
  "asOf": 1736208000,
  "open": 187.2,
  "high": 190.4,
  "low": 186.7,
  "volume": 48200213
}
```

## `GET /api/finance/history`

Query parameters:

| Name   | Type   | Description |
|--------|--------|-------------|
| symbol | string | Supported ticker. |
| tf     | enum   | `1d`, `4h`, `1h`, `15m`. |
| from   | number _(optional)_ | Unix timestamp lower bound. |
| to     | number _(optional)_ | Unix timestamp upper bound. |
| limit  | number _(optional)_ | Max candles to return (default 500, cap 5000). |

Response body:

```jsonc
{
  "symbol": "BTCUSD",
  "timeframe": "1D",
  "candles": [
    { "t": 1672531200, "o": 16493.4, "h": 17000.0, "l": 16000.1, "c": 16854.2, "v": 2145.2 }
  ]
}
```

## `GET /api/finance/fundamentals`

Query parameters:

| Name   | Type   | Description |
|--------|--------|-------------|
| symbol | string | Equity ticker (e.g. `NVDA`). |

Response body:

```jsonc
{
  "symbol": "NVDA",
  "asOf": 1736208000,
  "summary": "Croissance portée par les GPU IA avec marge brute record.",
  "metrics": [
    { "label": "Market Cap", "value": 2.1e12, "unit": "USD" }
  ],
  "sources": [
    { "name": "MockEDGAR", "url": "https://example.com/nvda/q4" }
  ]
}
```

## `GET /api/finance/news`

Query parameters:

| Name   | Type   | Description |
|--------|--------|-------------|
| symbol | string | Equity or crypto ticker. |
| limit  | number _(optional)_ | Number of articles (default 10). |

Response body:

```jsonc
{
  "symbol": "NVDA",
  "exchange": "NASDAQ",
  "items": [
    {
      "id": "news_nvidia_1",
      "source": "Reuters",
      "title": "NVIDIA étend sa feuille de route data center",
      "url": "https://news.example.com/nvda-datacenter",
      "publishedAt": "2025-01-22T09:15:00Z",
      "summary": "Le groupe annonce une nouvelle gamme de GPU axés sur l'inférence temps réel et des partenariats cloud renforcés.",
      "sentiment": "positive"
    },
    {
      "id": "news_nvidia_2",
      "source": "MockWire",
      "title": "La division gaming de NVIDIA franchit un nouveau palier",
      "url": "https://news.example.com/nvda-gaming",
      "publishedAt": "2025-02-10T14:05:00Z",
      "summary": "Les revenus gaming progressent de 18 % grâce aux cartes spécialisées IA et au ray tracing génératif.",
      "sentiment": "neutral"
    },
    {
      "id": "news_nvidia_3",
      "source": "Les Échos",
      "title": "NVIDIA investit dans une chaîne d'approvisionnement européenne",
      "url": "https://news.example.com/nvda-europe",
      "publishedAt": "2025-02-24T07:45:00Z",
      "summary": "Un plan d'investissement conjoint avec plusieurs fondeurs vise à sécuriser la production de puces haut de gamme.",
      "sentiment": "positive"
    }
  ],
  "count": 3,
  "rateLimit": { "remaining": 42, "reset": 1_706_949_600_000 },
  "source": "mock"
}
```

> **Offline defaults** — The hermetic dataset ships with at least three NVDA
> articles so the end-to-end scenario "Fondamentaux + 3 news" can validate the
> rendered list without reaching external providers.

## `POST /api/finance/backtest`

Request body:

```jsonc
{
  "symbol": "AAPL",
  "timeframe": "1D",
  "period": { "from": 1514764800, "to": 1609459200 },
  "strategy": {
    "name": "sma-crossover",
    "params": { "fast": 50, "slow": 200, "riskPerTrade": 0.01 }
  }
}
```

Response body:

```jsonc
{
  "runId": "bt_abc123",
  "metrics": {
    "totalReturn": 0.32,
    "cagr": 0.14,
    "maxDrawdown": 0.18,
    "winRate": 0.55,
    "averageWin": 0.042,
    "averageLoss": 0.021,
    "sharpe": 0.9,
    "profitFactor": 1.6,
    "trades": 84
  },
  "equityCurve": [ { "t": 1514764800, "e": 1.0 } ],
  "trades": [
    {
      "id": "trade_1",
      "entry": { "t": 1514937600, "price": 172.3 },
      "exit": { "t": 1516852800, "price": 177.5 },
      "qty": 1,
      "side": "long",
      "pnl": 5.2,
      "pnlPct": 0.0302
    }
  ]
}
```

## `POST /api/finance/screen`

Request body:

```jsonc
{
  "filters": {
    "marketCapMin": 20000000000,
    "peMax": 30,
    "dividendYieldMin": 0.01,
    "sector": "Technology"
  }
}
```

Response body:

```jsonc
{
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

## `GET /api/finance/preferences`

- Returns the saved finance preferences for the authenticated user (or defaults when none exist).

## `PATCH /api/finance/preferences`

- Accepts the preference schema `{ markets: string[], indicators: IndicatorConfig[], newsOptIn: boolean, explanationLevel: 'concise'|'detailed' }` and persists the payload.

### Error Codes

| Code              | Meaning                                  |
|-------------------|------------------------------------------|
| `invalid_request` | Validation failed (400).                 |
| `rate_limited`    | Too many requests (429).                  |
| `not_found`       | Symbol not present in offline catalogue. |
| `internal_error`  | Unexpected failure (500).                 |
