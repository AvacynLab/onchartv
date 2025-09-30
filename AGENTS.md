Remet à zero le fichier AGENTS.md et importe la liste des taches fournit ci dessous ainsi que les informations (au mot près) dans le fichier. Une fois effectué, commence l'implementation, et prend ton temps. 

----------
Voici ta **to-do list exhaustive** (avec sous-étapes imbriquées) adressée **directement à toi, l’agent**. Elle s’appuie sur la version actuelle du projet (Next 15 canary, React 19 RC, Tailwind v4, Drizzle + Postgres, Auth.js Credentials, Vercel Blob, AI SDK) et sur l’objectif d’ajouter des artefacts financiers (graphique interactif, analyse technique, fondamentale, backtest) **sans casser la structure** existante.

---

## BRIEF — Objectifs & Correctifs attendus (lis bien avant d’agir)

**Objectifs fonctionnels**

* Tu permets à l’utilisateur d’analyser des actifs (technique + fondamentale), de **tester des stratégies (backtest)**, d’**interagir** avec des graphiques (cliquer une bougie, sélectionner un range, activer/désactiver des indicateurs) et d’obtenir des **rapports compréhensibles** et **traçables** (explications + statistiques).
* Tu **gardes la structure** du repo et t’intègres via de **nouveaux artefacts** cohérents avec l’app (renderer d’artefacts existant, routes API à la mode App Router, Drizzle/PG pour la persistance).

**Correctifs & points durs**

* Remplace l’ID de modèle IA **placeholder** (`gpt-5-nano`) par un **modèle réellement disponible** et fais passer la **clé API** par `.env`.
* Ajoute des **tables** pour actifs/stratégies/backtests/ préférences; écris **migrations** Drizzle SQL correctes et **index** utiles.
* Introduis des **endpoints API** clairs (`/api/finance/*`) avec **validation Zod** stricte et **rate-limit** de base.
* Ajoute des **artefacts** de rendu (chart, backtest, fundamentals, news) et leur **renderer** côté UI.
* Fournis des **mocks** de données (tests et dev) pour que le build CI et les e2e **n’aient pas besoin d’Internet**.
* Rends l’agent **explicable** (motifs détectés, sources, métriques du backtest) et **non intrusif** (pas de surcharge d’infos non demandées).

**Tests & Build — à respecter**

* **Node ≥ 20**, **pnpm 9.x**, jest/vitest + Playwright opérationnels.
* Le script `pnpm build` **lance les migrations** : assure-toi que les **migrations sont idempotentes** et ne dépendent pas de données externes.
* Les e2e Playwright **mockent** toutes les API de marché/news; pas de flaky tests; **isolation** par utilisateur/DB.
* Ne merge rien sans : **unit** verts, **e2e** verts, **type-check** TS, **lint/format** propres.
* CI: installe `playwright` (chromium), prépare Postgres, exécute migrations, **seed minimal**, puis build/test.

---

## CHECKLIST À COCHER — Fichier par fichier (avec sous-tâches)

### 0) Dépendances & Meta

* [x] **`package.json`**

* [x] Remplacer le modèle IA placeholder dans les prompts (voir §1) — pas ici, mais note que `OPENAI_MODEL_ID` sera lu du code.
* [x] **Ajouter deps** pour finance & tests :

    * [x] `lightweight-charts` (ou `recharts`) pour chandeliers interactifs.
    * [x] `zod` (si pas déjà), `zod-to-json-schema` (optionnel).
    * [x] `@testing-library/react`, `@testing-library/user-event`, `vitest`, `@vitest/coverage-v8`.
    * [x] (Option) `@tanstack/react-query` pour fetching/caching UI.
  * [x] **Scripts** : ajouter

    * [x] `"test": "vitest run --coverage"`, `"test:ui": "vitest"`.
    * [x] `"e2e": "playwright test"`, `"e2e:install": "playwright install --with-deps chromium"`.
    * [x] `"db:seed": "tsx lib/db/seed.ts"` (si tu crées un seed).
  * [x] **packageManager** : conserver `pnpm@9.12.3`.
* [x] **`.env.example`**

  * [x] Ajouter : `OPENAI_API_KEY=`, `OPENAI_MODEL_ID=...` (valide), `MARKET_DATA_API_KEY=` (si provider), `NEWS_API_KEY=` (si provider), `FEATURE_FINANCE=true`.
  * [x] Documenter `POSTGRES_URL`, `BLOB_READ_WRITE_TOKEN`, `AUTH_SECRET`.
* [x] **`next.config.js`**

* [x] (Option) Ajouter domaines d’images pour logos de news si tu en affiches.
  * [x] Vérifier `images.remotePatterns` existants.

---

### 1) IA — Provider & outils

* [x] **`lib/ai/providers.ts`**

  * [x] Remplacer la constante `OPENAI_MODEL_ID = "gpt-5-nano"` par `process.env.OPENAI_MODEL_ID!`.
  * [x] Vérifier l’enregistrement des **capabilities** (chat, reasoning, title, artifact) et **mapper** :

    * [x] `chat-model` → modèle chat valide.
    * [x] `chat-model-reasoning` → modèle reasoning/large (si dispo).
    * [x] `title-model` → petit modèle rapide.
    * [x] `artifact-model` → même que chat ou dédié (supporte JSON tool-calling).
  * [x] Ajouter **timeouts** et **maxTokens** raisonnables; gérer erreurs (429/5xx) avec retry exponentiel.
* [x] **`lib/ai/tools/index.ts`** (ou équivalent)

* [x] **Créer** et **enregistrer** les nouveaux outils :

    * [x] `tool.finance.chart.fetch` (OHLCV + métadonnées indicateurs).
    * [x] `tool.finance.chart.annotate` (motifs détectés).
    * [x] `tool.finance.fundamentals.fetch`.
    * [x] `tool.finance.news.fetch`.
    * [x] `tool.finance.strategy.backtest`.
    * [x] `tool.finance.screen` (optionnel).
* [x] Chaque outil :

    * [x] Input/Output **Zod schema** strict.
    * [x] Limiter taille/intervalle (ex: max candles).
    * [x] Journaliser pour audit (sans secrets).
* [x] **`lib/ai/system-prompts/*.md`** (ou où résident les prompts)

  * [x] Ajouter un **manuel Finance** : règles d’explicabilité, quand proposer chart/news/fundamentals, comment résumer un backtest (rendement, winrate, DD).
  * [x] Ajouter **guardrails** (pas de conseil financier personnalisé, avertissements de risques, sources citées quand possible).

**Tests IA**

* [x] **`tests/unit/ai/providers.spec.ts`** : vérifie mapping des modèles & erreurs si env manquant.
* [x] **`tests/unit/ai/tools.finance.spec.ts`** : tests de validation Zod & exécution happy-path avec **mocks** data.

---

### 2) Base de données — schéma & migrations

* [x] **`lib/db/schema.ts`**

  * [x] Ajouter tables :

    * [x] `Asset` `{ id, symbol, type('equity'|'crypto'|'fx'|...), name, exchange, currency, createdAt }` + unique `(symbol, exchange)`.
    * [x] `Watchlist` `{ id, userId, name, createdAt }` et `WatchlistItem` `{ watchlistId, assetId, note? }`.
    * [x] `Strategy` `{ id, userId, name, description, createdAt }`.
    * [x] `StrategyVersion` `{ id, strategyId, params JSONB, createdAt }`.
    * [x] `BacktestRun` `{ id, strategyVersionId, assetId, timeframe, periodStart, periodEnd, metrics JSONB, trades JSONB, createdAt }` (+ index sur `assetId, timeframe, periodStart`).
    * [x] `IndicatorConfig` `{ id, userId, name, spec JSONB, createdAt }` (optionnel).
    * [x] (Option) `NewsItemCache` `{ id, assetId, source, title, url, publishedAt, summary, sentiment }`.
  * [x] **Augmenter** `Message_v2` si nécessaire : champ `artifacts JSONB` ou lien vers table `Artifact` `{ type, payload }`.
* [x] **`lib/db/migrations/*`**

  * [x] Écrire migration SQL **ordonnée** (timestamps) créant ces tables + index.
  * [x] Ajouter **constraints** FK (on delete cascade appropriés).
* [x] **`lib/db/queries.ts`** (ou équivalent)

  * [x] Fonctions d’accès standard : `getAssetBySymbol`, `upsertAsset`, `createBacktestRun`, `listBacktestsByStrategy`, etc.
* [x] **`lib/db/seed.ts`**

  * [x] Insérer 3–5 actifs (AAPL, NVDA, BTCUSD, EURUSD…) pour les tests/dev.

**Tests DB**

* [x] **`tests/unit/db/migrations.spec.ts`** : apply/rollback sur une DB temporaire.
* [x] **`tests/unit/db/queries.spec.ts`** : CRUD de base + contraintes.

---

### 3) API — nouvelles routes Finance

Crée un **dossier dédié** :

* [x] **`app/api/finance/quote/route.ts`**

  * [x] GET `?symbol=BTCUSD` → dernier prix + OHLC récent.
  * [x] Valider input (Zod), limiter `symbol` à un set test en dev si besoin.
* [x] **`app/api/finance/history/route.ts`**

  * [x] GET `?symbol=BTCUSD&tf=1d&from=...&to=...&limit=...` → série OHLCV.
  * [x] Pagination (cursor ou `limit/offset`), cap hard (ex 5k candles).
* [x] **`app/api/finance/fundamentals/route.ts`**

  * [x] GET `?symbol=AAPL` → ratios clés, revenus, etc. (mock si pas d’API).
* [x] **`app/api/finance/news/route.ts`**

  * [x] GET `?symbol=AAPL&limit=10` → liste news (mock + sentiment simple).
* [x] **`app/api/finance/backtest/route.ts`**

  * [x] POST `{ symbol, timeframe, period, strategyParams }` → calcule backtest et **persiste** `BacktestRun`.
  * [x] Retourne `metrics` (CAGR, WinRate, MaxDD, Sharpe simple), `trades` et un **id** de run.
* [x] **`app/api/finance/screen/route.ts`** (option)

  * [x] POST `{ filters }` → renvoie liste d’actifs correspondants (mock en dev).

**Transversal**

* [x] **Validation Zod** sur **toutes** les routes; **normalisation** des erreurs (code + shape JSON).
* [x] **Rate-limit** simple (e.g., 60 req/min/IP) pour `/finance/*`.
* [x] **Auth** : lecture autorisée en public pour data publiques ? Décider; sinon, require session.
* [x] **Logs** : pas de secrets; tag route + latence.

**Tests API**

* [x] **`tests/routes/finance.history.spec.ts`** : happy path + limites invalides.
* [x] **`tests/routes/finance.backtest.spec.ts`** : paramètres manquants, persistance, shape `metrics`.
* [x] **`tests/routes/finance.news.spec.ts`** : mock stable, pagination.
* [x] **`tests/unit/routes/finance.screen.spec.ts`** : filtre le catalogue et gère les erreurs de payload.

---

### 4) Backtest — moteur & lib technique


* [x] **`lib/finance/backtest/engine.ts`**

  * [x] Implémenter moteur discret **TS** (évite Pyodide pour l’instant) :

    * [x] Entrées : OHLCV[], params (par ex. SMA crossover `{ fast=50, slow=200 }`, risk `{ stopATR=2, rrr=2 }`).
    * [x] Sorties : `trades[]` (entry/exit/qty/pnl), `equityCurve[]`.
  * [x] **Calculs** :

    * [x] PnL en devise, glissement (slippage) fixe ou % (param).
    * [x] Frais (commission) paramétrables.
  * [x] **Metrics** :

    * [x] CAGR, Total Return, Max Drawdown, WinRate, Avg Win/Loss, Sharpe (simple, sans rf), Profit Factor.
* [x] **`lib/finance/indicators.ts`**

  * [x] SMA/EMA/RSI/Bollinger de base; **pure** functions, pas d’effets.
* [x] **`lib/finance/patterns.ts`**

  * [x] Détection simple de chandeliers (hammer, engulfing) + S/R basiques (pivot).
* [x] **`lib/finance/data-adapter.ts`**

  * [x] Interface `MarketData` (`history(symbol, tf, from, to): OHLCV[]`, `quote(symbol)`) + **impl Mock**.
  * [x] (Option) Impl fournisseur réel derrière un `FEATURE_USE_REAL_DATA` + keys `.env`.

**Tests Backtest**

* [x] **`tests/unit/finance/indicators.spec.ts`** : cas connus (SMA 3 points, RSI plateau).
* [x] **`tests/unit/finance/engine.spec.ts`** : scénario synthétique (SMA cross) avec courbe attendue.
* [x] **`tests/unit/finance/patterns.spec.ts`** : chandeliers simples.

---

### 5) Intégration Agent ⇄ Artefacts

* [x] **`lib/ai/messages/convertToModelMessages.ts`** (ou équivalent)

  * [x] Supporter `artifact` types : `"finance.chart" | "finance.backtest" | "finance.fundamentals" | "finance.news"`.
  * [x] Encoder/décoder payloads **JSON** pour le stream SSE.
* [x] **`app/api/chat/route.ts`**

  * [x] Étendre la pipeline stream pour **émettre** ces artefacts (chunks idempotents).
  * [x] **Sauvegarder** dans DB : messages + `artifacts` (JSON).
* [x] **`components/ArtifactRenderer.tsx`**

  * [x] Ajouter `case "finance.chart"` → affiche `<FinanceChartArtifact .../>`.
  * [x] `case "finance.backtest"` → `<BacktestReportArtifact .../>`.
  * [x] `case "finance.fundamentals"` / `"finance.news"` → fiches/listes.
* [x] **`components/finance/FinanceChartArtifact.tsx`**

  * [x] Utiliser `lightweight-charts` :

    * [x] Série chandeliers.
    * [x] Séries overlay (SMA/EMA) togglables.
    * [x] **Click/hover handlers** : montrer OHLC, indices, attacher callback pour « explique cette bougie ».
    * [x] Sélecteur timeframe + range (zoom/pan).
    * [x] Bouton « Expliquer cette bougie » pré-remplit le compositeur du chat avec un prompt contextualisé.
* [x] **`components/finance/BacktestReportArtifact.tsx`**

  * [x] Cartes métriques (CAGR, MaxDD, WinRate).
  * [x] Graph `equityCurve` (Line).
  * [x] Tableau `trades` (paginé).
  * [x] Bouton « Re-tester avec… » (ouvre params).
  * [x] Le bouton « Re-tester » alimente le compositeur avec la commande `/backtest` correspondante.
* [x] **`components/finance/FundamentalsCard.tsx`**

  * [x] Tableau ratios clés + mini-explications.
* [x] **`components/finance/NewsList.tsx`**

  * [x] Liste titres + résumé + sentiment (icône).

**Tests UI**

* [x] **`tests/unit/components/FinanceChartArtifact.spec.tsx`** : rendu, toggles, click event produit callback.
* [x] **`tests/unit/components/BacktestReportArtifact.spec.tsx`** : calc métriques affichées correctement (avec données figées).
* [x] **`tests/unit/components/fundamentals-card.spec.tsx`** : vérifie le formatage des ratios, les points saillants et les messages de prudence.
* [x] **`tests/unit/components/news-list.spec.tsx`** : garantit la présence des liens externes, dates ISO et icônes de sentiment.

---

### 6) UX/Paramètres & Permissions

* [x] **`components/settings/FinanceSettings.tsx`** (ou section Settings existante)

  * [x] Préférences : marchés d’intérêt, indicateurs par défaut, niveau de détail des explications, cacher news.
* [x] Enregistrer en DB (`UserPreference` ou JSON dans User).
* [x] **`lib/auth/secret.ts`**

  * [x] **En prod**, interdire fallback secret; throw si `AUTH_SECRET` vide.
* [x] **`lib/ratelimit.ts`** (si inexistant)

  * [x] Limite simple sur `/api/finance/*`.

**Tests**

* [x] **`tests/unit/settings/preferences.spec.ts`** : sauvegarde/lecture prefs.

---

### 7) Fichiers existants — ajustements précis

* [x] **`app/(chat)/*`** (page & layout)

  * [x] S’assurer que la zone d’artefacts **supporte** les nouveaux types (taille, scroll, focus states).
  * [x] Ajouter raccourcis (ex: `/chart BTCUSD 1D`).
* [x] **`app/(auth)/auth.ts`**

  * [x] Rien de spécifique, sauf si tu limites `/api/finance/*` aux utilisateurs connectés.
* [x] **`app/api/files/upload/route.ts`**

  * [x] Étendre MIME si tu veux autoriser **CSV** pour backtests custom.
  * [x] Cap taille (ex 2–5 MB) & validation.
* [x] **`lib/pyodide.ts`**

  * [x] Laisser en l’état (on backteste en TS). Si plus tard tu passes Python, veille aux **mocks** e2e.
* [x] **`components/*` généraux**

  * [x] Vérifier que la typographie (Tailwind v4) et les couleurs conviennent pour graphiques sombres/clair.
  * [x] Accessibilité : contrastes, `aria` sur toggles.

**Tests**

* [x] **Snapshots** pour artefacts (avec `@testing-library/react`).

---

### 8) E2E — scénarios Playwright

* [x] **`tests/e2e/finance.test.ts`**

  * [x] **Setup** : créer user, seed 3 actifs, mock API `/finance/*`.
  * [x] **Scenario 1 — Chart basique**

    * [x] L’utilisateur tape “Montre BTCUSD 1D avec SMA(50/200)”.
    * [x] L’agent génère artefact `finance.chart`.
    * [x] Le test **clique** sur une bougie → tooltip OHLC visible.
  * [x] **Scenario 2 — Backtest SMA Cross**

    * [x] L’utilisateur : “Backteste SMA 50/200 sur AAPL 2018-2020”.
    * [x] Vérifie métriques (CAGR>0 attendu selon mock), trades>0, equityCurve non vide.
  * [x] **Scenario 3 — Fundamentals + News**

    * [x] L’utilisateur : “Montre fondamentaux + 3 dernières news de NVDA”.
    * [x] Vérifie presence des ratios clés + liste news (titres & dates).
  * [x] **Scenario 4 — Preferences**

    * [x] Désactive news dans settings → relance requête news → l’agent propose d’activer ou n’affiche pas automatiquement.
  * [x] **`tests/e2e/accessibility.spec.ts`**

    * [x] Vérifie focusable/tabs des artefacts.

---

### 9) CI/CD — stabilité des builds

* [x] **Workflow CI** (GitHub Actions ou autre)

  * [x] **Services** : Postgres 16, `POSTGRES_URL` exposé.
  * [x] Steps :

    * [x] `pnpm i` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm build`.
    * [x] `pnpm e2e:install` → `pnpm test` → `pnpm e2e`.
  * [x] **Cache** pnpm; upload de rapports (coverage, junit).
* [x] **Vercel / Prod**

  * [x] Variables requises définies : `AUTH_SECRET`, `OPENAI_API_KEY`, `OPENAI_MODEL_ID`, `POSTGRES_URL`, `BLOB_READ_WRITE_TOKEN`, éventuellement providers data/news.
  * [x] **Healthcheck** simple (GET `/api/finance/quote?symbol=BTCUSD` renvoie 200 avec mock si pas de clé).

---

### 10) Documentation & Garde-fous

* [x] **`README.md`**

  * [x] Section **Finance** : comment activer, variables `.env`, limites de données, exemples de requêtes utilisateur (“/chart”, “/backtest”).
  * [x] Avertissement **non-conseil financier**, risques, sources.
* [x] **`docs/finance/`**

  * [x] `artifacts.md` : shape JSON de chaque artefact.
  * [x] `api.md` : schémas des routes `/api/finance/*` (Zod → JSON Schema).
  * [x] `backtest.md` : hypothèses (slippage, fees), limites, interprétation.

---

## Contraintes et Rappels pour les **Tests** & le **Build**

* **Aucun test ne dépend d’Internet** : toutes les routes `/api/finance/*` **mockées** en e2e; les unit utilisent fixtures figées.
* **Snapshots** stables : freeze dates (`vi.setSystemTime`), random seeds fixés.
* **Migrations** : idempotentes; `db:migrate` peut tourner en `dev`, `build`, **CI** sans surprise.
* **Types TS** : tous les artefacts ont leur **type** et leur **zod schema**; pas de `any`.
* **Perf** : limite le volume de candles et pagine; évite de bloquer l’UI (stream si réponse longue).
* **Sécurité** : valider tous les inputs; pas de secrets dans les logs; rate-limit de base.
* **UX** : n’affiche que le **nécessaire**; propose le reste **à la demande** (anti-surcharge).
* **Explicabilité** : chaque motif/stratégie/backtest **explique son pourquoi** + métriques et, si possible, **sources**.

---

### Mini-exemples de **payloads artefacts** (pour t’aligner)

* **`finance.chart`**

  ```json
  {
    "type": "finance.chart",
    "symbol": "BTCUSD",
    "timeframe": "1D",
    "range": {"from":"2023-01-01","to":"2025-01-01"},
    "ohlcv": [{"t":1672531200,"o":..., "h":..., "l":..., "c":..., "v":...}, ...],
    "overlays": [{"type":"SMA","length":50},{"type":"SMA","length":200}],
    "annotations": [{"kind":"pattern","name":"hammer","index":123}]
  }
  ```
* **`finance.backtest`**

  ```json
  {
    "type": "finance.backtest",
    "runId": "bt_abc123",
    "symbol": "AAPL",
    "timeframe": "1D",
    "period": {"from":"2018-01-01","to":"2020-12-31"},
    "strategy": {"name":"SMA Cross","params":{"fast":50,"slow":200}},
    "metrics": {"totalReturn":0.32,"CAGR":0.14,"maxDD":0.18,"winRate":0.55,"sharpe":0.9,"trades":84},
    "equityCurve": [{"t":..., "e":...}, ...],
    "trades": [{"entryT":...,"exitT":...,"qty":1,"pnl":...}, ...]
  }
  ```
* **`finance.fundamentals`** / **`finance.news`** : fiches/listes concises, champs datés et sourcés.

---

### Ordre d’exécution suggéré

1. **Models IA & Env** → 2) **DB & migrations** → 3) **API finance** (mock d’abord) → 4) **Moteur backtest/indicateurs** → 5) **Artefacts UI** → 6) **Intégration agent** → 7) **Settings & rate-limit** → 8) **Tests unit** → 9) **E2E** → 10) **CI/CD & Docs**.

---

Quand tu coches tout ça, on obtient un agent financier **intégré proprement**, **explicable**, et **testé de bout en bout**, sans détourner l’architecture existante.

---

## Historique des actions (2025-10-12)

- Ajout des dépendances front/tests (lightweight-charts, vitest, testing-library, zod-to-json-schema) et des scripts `test`, `test:ui`, `test:node`, `e2e`, `e2e:install`, `db:seed` dans `package.json`.
- Mise à jour de `.env.example` avec les secrets IA/finance et documentation des variables existantes.
- Création des fondations finance côté code : `lib/finance/types.ts`, `lib/finance/indicators.ts`, `vitest.config.ts`, `tests/unit/finance/indicators.spec.ts` et script de seed placeholder (`lib/db/seed.ts`).
- Exécution des suites `pnpm test` et `pnpm test:node` pour valider les nouveaux helpers et garantir la compatibilité avec les tests Node existants.

---

## Historique des actions (2025-10-13)

- Implémentation du moteur de backtest SMA crossover (`lib/finance/backtest/engine.ts`) avec gestion du slippage, des commissions et calcul des métriques (CAGR, drawdown, Sharpe, profit factor).
- Ajout des détections de motifs et niveaux S/R (`lib/finance/patterns.ts`) ainsi que l’adaptateur de marché en mémoire et son générateur de séries (`lib/finance/data-adapter.ts`).
- Extension des types domaine finance (`lib/finance/types.ts`) pour supporter trades, equity curve et artefacts à venir.
- Couverture de tests unitaires dédiée (`tests/unit/finance/*.spec.ts`) et exécution de `pnpm test` pour valider les nouvelles briques.

---

## Historique des actions (2025-10-14)

- Renforcement du provider OpenAI (`lib/ai/providers.ts`) : lecture des identifiants via `.env`, mappage explicite des capacités, limitation des tokens et ajout d’un retry exponentiel avec timeouts.
- Ajout de l’alias Vitest (`vitest.config.ts`) pour aligner la résolution `@/` avec Next.js et faciliter les tests unitaires IA.
- Création de la suite `tests/unit/ai/providers.spec.ts` couvrant les erreurs d’environnement et le routage des modèles.
- Exécution de `pnpm test` pour valider la configuration mise à jour et générer la couverture.

---

## Historique des actions (2025-10-15)

- Ajout du socle financier côté base de données : nouvelles tables `Asset`, `Watchlist`, `Strategy`, `BacktestRun`, `IndicatorConfig`, `NewsItemCache` et colonne `artifacts` sur `Message_v2` (`lib/db/schema.ts`).
- Création de la migration `0008_resilient_finance_scaffold.sql` et du snapshot associé pour provisionner les tables, index et contraintes ainsi que la colonne `artifacts` (`lib/db/migrations/*`).
- Implémentation des accès finance (`lib/db/queries.ts`) : normalisation/`upsert` d’actifs, création de stratégies/versions/backtests, liste des runs, reset de l’in-memory store et documentation des interfaces.
- Mise à jour du seed pour insérer un catalogue déterministe d’actifs (`lib/db/seed.ts`).
- Ajout des tests unitaires `tests/unit/db/migrations.spec.ts` (pglite) et `tests/unit/db/queries.spec.ts` validant migrations, resets et ordre des backtests, exécutés via `pnpm test`.

---

## Historique des actions (2025-10-16)

- Création de l’outillage finance côté agent (`lib/ai/tools/finance.ts`) avec schémas Zod stricts, journalisation et injection de dépendances pour les mocks.
- Ajout des fixtures hermétiques (`lib/finance/mock-data.ts`) réutilisées par l’adaptateur mémoire et les outils (prix, fondamentaux, news).
- Intégration des nouveaux outils dans la route de chat (`app/(chat)/api/chat/route.ts`) et extension des types (`lib/types.ts`) pour exposer les clés `tool.finance.*` au SDK.
- Couverture dédiée via `tests/unit/ai/tools.finance.spec.ts` validant validation et happy paths, exécution avec `pnpm test`.

---

## Historique des actions (2025-10-17)

- Mise en place des routes finance (`app/api/finance/*`) couvrant la cotation, l’historique OHLCV, les fondamentaux, les news et l’orchestration de backtests persistant en base avec journalisation et rate limiting.
- Ajout d’un catalogue partagé (`lib/finance/catalog.ts`), d’outils serveur (`lib/finance/api-utils.ts`, `lib/finance/server-adapter.ts`) et d’un limiteur en mémoire (`lib/ratelimit.ts`) pour garder les mocks hermétiques.
- Couverture unitaire des nouvelles routes via `tests/unit/routes/finance.{history,news,backtest}.spec.ts` avec isolation Playwright et double vérification des cas limites.

---

## Historique des actions (2025-10-18)

- Rédaction du manuel finance (`lib/ai/system-prompts/finance.md`) détaillant le workflow, les artefacts et les garde-fous (non-conseil, risques, citations).
- Ajout du loader de prompt (`lib/ai/system-prompts/index.ts`) avec cache mémoire et gestion d’erreurs pour l’exécution serverless.
- Extension du `systemPrompt` (`lib/ai/prompts.ts`) pour inclure conditionnellement le manuel en fonction du flag `FEATURE_FINANCE`.
- Création des tests `tests/unit/ai/prompts.spec.ts` garantissant l’activation/désactivation du manuel et la présence des avertissements de risques.

---

## Historique des actions (2025-10-19)

- Implémentation de la route de screening (`app/api/finance/screen/route.ts`) avec validation Zod, journalisation et rate limiting cohérents avec les autres endpoints finance.
- Ajout des tests unitaires dédiés (`tests/unit/routes/finance.screen.spec.ts`) couvrant les filtres valides, les rejets de payload invalides et le comportement par défaut sans corps.
- Exécution de `pnpm test` après installation des dépendances pour vérifier la nouvelle couverture et conserver la suite vitest au vert.

---

## Historique des actions (2025-10-20)

- Injection de la capture d'artefacts finance dans `app/(chat)/api/chat/route.ts` pour streamer les payloads (`finance.chart`, `finance.backtest`, `finance.fundamentals`, `finance.news`) et les persister aux côtés des messages assistant.
- Extension des types UI (`lib/types.ts`) et du domaine finance (`lib/finance/types.ts`) pour typer précisément les artefacts chart/backtest/fundamentaux/news/screen.
- Ajout du hook `onArtifact` dans `lib/ai/tools/finance.ts` et d'un test vitest garantissant l'appel du callback, plus exécution de `pnpm install --frozen-lockfile` suivie de `pnpm test` pour valider la suite.

---

## Historique des actions (2025-10-21)

- Création du renderer centralisé `components/ArtifactRenderer.tsx` et des artefacts UI finance (graphique interactif, rapport de backtest, fondamentaux, news, screener) avec commentaires documentant chaque intention.
- Intégration des sorties `tool.finance.*` dans `components/message.tsx` via le renderer pour exposer les artefacts directement dans les messages de l'assistant.
- Ajout de tests React Testing Library ciblés (`tests/unit/components/finance-chart-artifact.spec.tsx`, `tests/unit/components/backtest-report-artifact.spec.tsx`) et ajustement de `vitest.config.ts` pour activer `jsdom` uniquement sur les tests UI.

---

## Historique des actions (2025-10-22)

- Ajout de la table `FinancePreference` et de la migration `0009_finance_preferences.sql` pour persister marchés, indicateurs et niveaux d'explication côté utilisateur avec snapshot/journal mis à jour.
- Implémentation des helpers `getFinancePreferencesByUserId` et `upsertFinancePreferences` (Drizzle + in-memory) et de la route `app/api/finance/preferences` incluant validation Zod et rate limiting dédié.
- Création du panneau `components/settings/finance-settings.tsx` (marchés, indicateurs, détail, news) et du test `tests/unit/settings/preferences.spec.tsx` couvrant chargement, édition et sauvegarde des préférences.

---

## Historique des actions (2025-10-23)

- Création de la documentation finance (`docs/finance/artifacts.md`, `docs/finance/api.md`, `docs/finance/backtest.md`) décrivant les payloads, les routes et les hypothèses du moteur.
- Mise à jour du `README.md` avec une section « Finance Tooling » détaillant l'activation, les jeux de données mockés et les avertissements de risques.
- Vérification de la checklist correspondante dans `AGENTS.md` pour signaler la complétion des tâches documentation.

---

## Historique des actions (2025-10-24)

- Passage des outils finance (`lib/ai/tools/finance.ts`) en mode préférences-aware : suppression des news lorsque `showNews` est à `false` avec journalisation structurée et test dédié.
- Chargement des préférences utilisateur dans la route de chat (`app/(chat)/api/chat/route.ts`) et injection dans `createFinanceTools` pour que les artefacts respectent les réglages persistés.
- Ajout de la page `/settings/finance` pour exposer le panneau `FinanceSettings` côté UI et permettre aux e2e d'orchestrer le toggle news.
- Création du scénario Playwright complet (`tests/e2e/finance.spec.ts`) couvrant graphique, backtest, fondamentaux/news et préférence news, plus extension des prompts hermétiques.

---

## Historique des actions (2025-10-25)

- Création du test Playwright `tests/e2e/accessibility.spec.ts` validant la navigation clavier sur les boutons du graphique, la relance de backtest et les liens d'actualités afin de garantir l'accessibilité des artefacts finance.
- Mise à jour de `AGENTS.md` pour cocher la tâche accessibilité et documenter la progression pour le prochain agent.

---

## Historique des actions (2025-10-26)

- Ajout de snapshots React Testing Library pour les artefacts `finance.chart` et `finance.backtest` afin de signaler rapidement les régressions de markup et d'accessibilité (`tests/unit/components/finance-chart-artifact.spec.tsx`, `tests/unit/components/backtest-report-artifact.spec.tsx`).
- Commentaires pédagogiques dans les tests pour rappeler l'objectif des snapshots et faciliter la revue des prochains agents.

---

## Historique des actions (2025-10-27)

- Hydratation des artefacts finance depuis `Message_v2.artifacts` lors de la conversion vers les messages UI (`lib/utils.ts`) afin que les conversations réaffichent graphiques, backtests et actualités après rechargement.
- Création d'un wrapper dédié (`lib/ai/messages/convert-to-model-messages.ts`) pour filtrer les `data-finance*` avant la délégation à l'AI SDK, plus tests unitaires ciblés (`tests/unit/ai/messages.spec.ts`).
- Exécution de `pnpm test` pour valider l'ensemble de la suite après l'ajout des conversions SSE ↔️ UI.

---

## Historique des actions (2025-10-28)

- Extension de l'upload de fichiers (`app/(chat)/api/files/upload/route.ts`) pour autoriser les CSV en plus des images tout en conservant la limite de 5MB et une liste blanche documentée des MIME types.
- Ajout du test hermétique `tests/unit/routes/files.upload.spec.ts` couvrant l'acceptation des CSV et le rejet des formats non pris en charge afin de sécuriser l'usage des backtests custom.
- Vérification et mise à jour de la checklist (`AGENTS.md`) pour refléter la complétion des tâches associées.

---

## Historique des actions (2025-10-29)

- Consolidation de la sécurité `lib/auth/secret.ts` en ajoutant des assertions `hasAuthSecret`/`resolveAuthSecret` couvrant le fallback Playwright et les erreurs production.
- Mise à jour de la checklist pour refléter la complétion de la tâche `lib/auth/secret.ts` et informer le prochain agent.

---

## Historique des actions (2025-10-30)

- Création du workflow GitHub Actions (`.github/workflows/ci.yml`) orchestrant migrations, seed, build, tests Vitest et Playwright contre Postgres 16 avec cache pnpm documenté.
- Ajout d’une section « Production & Vercel configuration » dans `README.md` détaillant les variables obligatoires, l’ordre `db:migrate` → `db:seed` → `build` et le healthcheck `/api/finance/quote` pour les sondes d’uptime.
- Ajustement des scripts `pnpm test`/`pnpm test:ui` dans `package.json` pour invoquer `pnpm exec vitest`, garantissant la disponibilité du binaire durant les exécutions locales et CI.
- Mise à jour de `AGENTS.md` afin de cocher la checklist CI/CD, noter la documentation Vercel et consigner ces actions pour le prochain agent.

---

## Historique des actions (2025-10-31)

- Ajout du module `lib/ai/chat-commands.ts` pour parser les raccourcis `/chart` et `/backtest`, générer des prompts explicites et garder la logique testable indépendamment de l’UI.
- Intégration des commandes dans l’input du chat (`components/multimodal-input.tsx`) et mise en avant via les suggestions (`components/suggested-actions.tsx`) afin que les utilisateurs découvrent rapidement les artefacts finance.
- Couverture unitaire dédiée (`tests/unit/ai/chat-commands.spec.ts`) et documentation des slash commands dans le `README.md`, puis validation avec `pnpm test`.

---

## Historique des actions (2025-11-01)

- Harmonisation des palettes du graphique finance : ajout de variables CSS (`app/globals.css`) pour les couleurs bougie/overlay et synchronisation dynamique côté composant (`components/finance/finance-chart-artifact.tsx`).
- Amélioration de l’accessibilité du renderer : légende sr-only couplée aux titres, regroupement des toggles dans un `fieldset` descriptif et panneau de détails `aria-live` (tests mis à jour dans `tests/unit/components/finance-chart-artifact.spec.tsx`).
- Rétablissement de la CLI Vitest via `pnpm install` puis exécution complète de `pnpm test` pour garantir une suite verte après les ajustements UI.

---

## Historique des actions (2025-11-02)

- Ajout de l’adaptateur HTTP `HttpMarketDataAdapter` avec validation Zod, timeout et gestion d’erreurs pour consommer un fournisseur réel lorsque `FEATURE_USE_REAL_DATA=true`.
- Sélection dynamique de l’adaptateur côté serveur (`lib/finance/server-adapter.ts`) avec repli documenté si la configuration (`MARKET_DATA_API_BASE_URL`, `MARKET_DATA_API_KEY`) est absente.
- Mise à jour de `.env.example`, du `README.md` et de `docs/finance/api.md` pour détailler le nouveau flag et les variables nécessaires.
- Création des tests unitaires `tests/unit/finance/http-adapter.spec.ts` et `tests/unit/finance/server-adapter.spec.ts` garantissant la validation des réponses, la gestion des timeouts et le choix de l’adaptateur.
- Exécution de `pnpm test` afin de vérifier que la suite Vitest reste entièrement verte après l’introduction du fournisseur réel optionnel.

---

## Historique des actions (2025-11-03)

- Connexion du bouton « Re-tester avec ces paramètres » aux slash commandes `/backtest` via le nouveau contexte du compositeur (`components/chat-composer-context.tsx`) et propagation jusque dans `components/message.tsx`/`components/ArtifactRenderer.tsx`.
- Pré-remplissage automatique du prompt « Expliquer cette bougie » pour les artefacts graphiques grâce aux helpers `buildExplainCandlePrompt` et à la gestion du focus dans `MultimodalInput`.
- Ajout des helpers `lib/finance/artifact-commands.ts` et des tests associés (`tests/unit/finance/artifact-commands.spec.ts`, `tests/unit/components/multimodal-input.spec.tsx`, mise à jour de `tests/unit/components/backtest-report-artifact.spec.tsx`) garantissant le comportement interactif.

---

## Historique des actions (2025-11-04)

- Introduction de TanStack Query côté client : création d’un provider dédié (`components/providers/query-client-provider.tsx`) et intégration dans `app/layout.tsx` pour mutualiser le cache des appels finance.
- Refactor complet du panneau `FinanceSettings` afin d’utiliser `useQuery`/`useMutation`, validation symétrique via Zod, gestion des erreurs centralisée et retrait des effets manuels `fetch`.
- Mise à jour du test unitaire `tests/unit/settings/preferences.spec.tsx` pour envelopper le composant avec `QueryClientProvider` et vérification que la mutation PATCH continue d’envoyer le bon payload après interaction.
- Exécution de `pnpm test` (Vitest + couverture) pour valider la régression et garantir la compatibilité du nouveau provider.
 
---

## Historique des actions (2025-11-05)

- Ajout de la couverture unitaire pour les artefacts fondamentaux et actualités (`tests/unit/components/fundamentals-card.spec.tsx`, `tests/unit/components/news-list.spec.tsx`) afin de verrouiller le formatage des ratios, les icônes de sentiment et les fallback UI.
- Vérification de la checklist UI correspondante dans `AGENTS.md` et documentation des objectifs pour les prochains agents.
- Exécution de `pnpm test` pour garantir que la suite Vitest reste entièrement verte après l'ajout de ces tests.

---

## Historique des actions (2025-11-06)

- Autorisation explicite des domaines `logo.clearbit.com` et `static.reuters.com` dans `next.config.ts` pour fiabiliser l'affichage des logos des sources d'actualités finance.
- Vérification de l'absence de modifications nécessaires côté authentification (`app/(auth)/auth.ts`) et Pyodide (`lib/pyodide.ts`), puis mise à jour de la checklist en conséquence.
- Ajout du test de régression `tests/unit/config/next-config.spec.ts` afin de s'assurer que les domaines critiques restent allowlistés.

---

## Historique des actions (2025-11-07)

- Relecture de `app/(auth)/auth.ts` pour confirmer qu'aucune restriction d'accès supplémentaire n'est appliquée aux routes `/api/finance/*`, puis validation de la checklist associée.
- Vérification de `lib/pyodide.ts` afin de garantir que le backtest reste côté TypeScript et que les stubs Playwright demeurent valides sans requêtes réseau.
- Mise à jour de `AGENTS.md` pour cocher les tâches restantes et informer le prochain agent de la revue effectuée.

---
