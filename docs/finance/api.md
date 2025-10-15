# Finance API Reference

The `/api/finance/*` routes expose offline-friendly market data and analytics.
Every handler validates input with Zod, enforces rate limiting via
`lib/ratelimit.ts`, and falls back to deterministic mock datasets so tests run
reliably without external network calls.

## Usage responsable & mode hors ligne

- **Ce n’est pas un conseil financier** : les réponses issues des routes ci-dessous
  sont éducatives et n’ont pas vocation à remplacer un avis professionnel.
- **Données simulées par défaut** : tant que `FEATURE_USE_REAL_DATA` n’est pas
  activé avec les identifiants requis, tous les endpoints répondent via les jeux
  de données de `lib/finance/mock-data.ts`.
- **Vérifications nécessaires** : si vous activez un fournisseur externe,
  affichez un avertissement équivalent côté produit et exposez les hypothèses de
  calcul (commission, slippage, limites d’horizon) dans vos interfaces.
- **Terminologie normalisée** : les champs JSON documentés ci-dessous suivent
  exactement les clés exposées par `lib/finance/types.ts` (`maxDrawdown`,
  `profitFactor`, etc.) afin d’éviter toute ambiguïté.

> **Real provider opt-in** — définissez `FEATURE_USE_REAL_DATA=true` ainsi que
> `MARKET_DATA_API_BASE_URL` et `MARKET_DATA_API_KEY` pour basculer l’adaptateur
> vers un fournisseur HTTP. En l’absence de configuration complète, les routes
> reviennent automatiquement aux mocks déterministes documentés ci-dessous.

## Rate limiting & erreurs

- Le rate limit est appliqué par clé client (`IP` ou en-tête `x-forwarded-for`).
  Les réponses réussies incluent `rateLimit: { remaining, reset }` pour faciliter
  le suivi côté client.
- Quand `PLAYWRIGHT=true`, `lib/ratelimit.ts` bypass le quota afin que les
  suites e2e puissent intercepter les endpoints sans déclencher de 429.
- Les erreurs retournent toujours un corps `{ "error": { "code", "message" } }`
  avec un statut HTTP cohérent :
  - `400` pour les validations échouées (`bad_request:api`).
  - `401`/`403` pour les accès non autorisés.
  - `404` lorsque la ressource n’existe pas.
  - `429` en cas de dépassement de quota.
  - `500` pour les erreurs inattendues (`internal_error:api`).

```jsonc
{
  "error": {
    "code": "bad_request:api",
    "message": "Parameter 'limit' must be a positive integer when provided."
  }
}
```

## `GET /api/finance/quote`

### Requête

| Paramètre | Type   | Description                                 |
|-----------|--------|---------------------------------------------|
| symbol    | string | Symbole supporté (`AAPL`, `BTCUSD`, etc.).  |

### Réponse

```jsonc
{
  "symbol": "AAPL",
  "exchange": "NASDAQ",
  "currency": "USD",
  "price": 189.22,
  "timestamp": 1736208000,
  "rateLimit": { "remaining": 59, "reset": 1736208060 },
  "source": "mock"
}
```

## `GET /api/finance/history`

### Requête

| Paramètre | Type                 | Description                                                                 |
|-----------|----------------------|-----------------------------------------------------------------------------|
| symbol    | string               | Ticker pris en charge.                                                      |
| timeframe | enum _(optionnel)_   | Fenêtres supportées : `1D`. Valeur par défaut : `1D`.                       |
| from      | string _(optionnel)_ | Limite inférieure (ISO 8601 ou timestamp Unix en secondes).                |
| to        | string _(optionnel)_ | Limite supérieure (ISO 8601 ou timestamp Unix en secondes).                |
| limit     | string _(optionnel)_ | Nombre maximum de chandelles (positif, plafonné à `5000`).                  |

### Réponse

```jsonc
{
  "symbol": "BTCUSD",
  "timeframe": "1D",
  "range": { "from": 1672531200, "to": 1675209600 },
  "ohlcv": [
    {
      "timestamp": 1672531200,
      "open": 16493.4,
      "high": 17000.0,
      "low": 16000.1,
      "close": 16854.2,
      "volume": 2145.2
    }
  ],
  "count": 1,
  "rateLimit": { "remaining": 59, "reset": 1675209660 },
  "source": "mock"
}
```

## `GET /api/finance/fundamentals`

### Requête

| Paramètre | Type   | Description                          |
|-----------|--------|--------------------------------------|
| symbol    | string | Symbole equity (`NVDA`, `AAPL`, …).  |

### Réponse

```jsonc
{
  "symbol": "NVDA",
  "exchange": "NASDAQ",
  "currency": "USD",
  "metrics": {
    "marketCap": 2.1e12,
    "peRatio": 24.3,
    "dividendYield": 0.012
  },
  "rateLimit": { "remaining": 29, "reset": 1736208060 },
  "source": "mock"
}
```

## `GET /api/finance/news`

### Requête

| Paramètre | Type                 | Description                                                     |
|-----------|----------------------|-----------------------------------------------------------------|
| symbol    | string               | Ticker equity ou crypto.                                        |
| limit     | string _(optionnel)_ | Nombre d’articles souhaité (défaut : `10`, minimum `1`).        |

### Réponse

```jsonc
{
  "symbol": "NVDA",
  "exchange": "NASDAQ",
  "items": [
    {
      "id": "news_nvidia_1",
      "symbol": "NVDA",
      "source": "Reuters",
      "title": "NVIDIA étend sa feuille de route data center",
      "url": "https://news.example.com/nvda-datacenter",
      "publishedAt": "2025-01-22T09:15:00Z",
      "summary": "Le groupe annonce une nouvelle gamme de GPU axés sur l'inférence temps réel.",
      "sentiment": "positive"
    }
  ],
  "count": 1,
  "rateLimit": { "remaining": 29, "reset": 1736208060 },
  "source": "mock"
}
```

> **Offline defaults** — le dataset hermétique embarque plusieurs articles NVDA
> pour satisfaire le scénario Playwright "Fondamentaux + 3 news" sans appel HTTP.

## `POST /api/finance/backtest`

### Requête

```jsonc
{
  "symbol": "AAPL",
  "timeframe": "1D",
  "period": { "from": "2018-01-01T00:00:00Z", "to": "2020-12-31T00:00:00Z" },
  "strategy": {
    "type": "sma-crossover",
    "name": "SMA 50/200",
    "params": { "fastPeriod": 50, "slowPeriod": 200 }
  },
  "risk": {
    "initialCapital": 25000,
    "commissionPerTrade": 1,
    "slippageBps": 25
  }
}
```

### Réponse

```jsonc
{
  "type": "finance.backtest",
  "runId": "bt_mock_aapl_2020",
  "symbol": "AAPL",
  "timeframe": "1D",
  "period": { "from": 1514764800, "to": 1609372800 },
  "strategy": {
    "id": "strategy_aapl",
    "versionId": "strategy_aapl_v1",
    "name": "SMA 50/200",
    "type": "sma-crossover",
    "params": { "fastPeriod": 50, "slowPeriod": 200 }
  },
  "assetId": "asset_aapl",
  "risk": {
    "initialCapital": 25000,
    "commissionPerTrade": 1,
    "slippageBps": 25
  },
  "metrics": {
    "totalReturn": 0.32,
    "cagr": 0.14,
    "maxDrawdown": 0.18,
    "winRate": 0.55,
    "averageWin": 420.12,
    "averageLoss": 210.11,
    "sharpe": 1.05,
    "profitFactor": 1.6,
    "trades": 84
  },
  "trades": [
    {
      "entryTimestamp": 1520035200,
      "entryPrice": 172.3,
      "exitTimestamp": 1522540800,
      "exitPrice": 177.5,
      "quantity": 10,
      "grossPnl": 520,
      "netPnl": 500
    }
  ],
  "equityCurve": [
    { "timestamp": 1514764800, "equity": 25000 },
    { "timestamp": 1514851200, "equity": 25080 }
  ],
  "rateLimit": { "remaining": 14, "reset": 1736208060 },
  "source": "mock"
}
```

## `POST /api/finance/screen`

### Requête

| Paramètre             | Type              | Description                                                             |
|-----------------------|-------------------|-------------------------------------------------------------------------|
| filters.minMarketCap  | number _(opt.)_   | Capitalisation minimum (USD).                                           |
| filters.maxPeRatio    | number _(opt.)_   | Ratio P/E maximum (les valeurs négatives sont ignorées).                |
| filters.assetTypes    | string[] _(opt.)_ | Sous-ensemble de `equity`, `crypto`, `fx`, `etf`, `index`, `commodity`. |
| limit                 | number _(opt.)_   | Nombre de résultats (défaut `10`, maximum `25`).                        |

### Réponse

```jsonc
{
  "type": "finance.screen",
  "totalMatches": 12,
  "results": [
    {
      "symbol": "NVDA",
      "name": "NVIDIA Corporation",
      "type": "equity",
      "exchange": "NASDAQ",
      "marketCap": 2.1e12,
      "peRatio": 24.3,
      "dividendYield": 0.012
    }
  ],
  "appliedFilters": {
    "minMarketCap": 1000000000,
    "maxPeRatio": 40,
    "assetTypes": ["equity"]
  },
  "rateLimit": { "remaining": 29, "reset": 1736208060 },
  "source": "mock"
}
```

## `GET /api/finance/preferences`

### Méthodes

| Route  | Description                                                               |
|--------|---------------------------------------------------------------------------|
| GET    | Retourne les préférences actuelles (`showNews`, `defaultTimeframe`, ...). |
| PATCH  | Met à jour les préférences en respectant le schéma Zod `financePreferencesSchema`. |

### Réponse

```jsonc
{
  "preferences": {
    "showNews": true,
    "defaultTimeframe": "1D",
    "defaultIndicators": ["sma-50", "sma-200"]
  },
  "createdAt": "2025-03-01T12:00:00Z",
  "updatedAt": "2025-03-01T12:00:00Z",
  "rateLimit": { "remaining": 29, "reset": 1736208060 },
  "source": "database"
}
```

