----------  

# Actions à mener — checklist à cocher (agent, suis l’ordre)

## 1) E2E manquant : ajouter un scénario “finance” complet

* [x] **Créer** `tests/e2e/finance.spec.ts`

  * [x] **Scenario 1 — Chart**

    * [x] Ouvre la page chat, envoie “Montre BTCUSD 1D avec SMA(50/200)”.
    * [x] **Attends** l’artefact `finance.chart`.
    * [x] **Clique** une bougie → **assert** apparition d’un tooltip OHLC.
    * [x] **Toggle** un overlay (SMA/EMA) → **assert** série visible/masquée.
  * [x] **Scenario 2 — Backtest SMA 50/200**

    * [x] Requête : “Backteste SMA 50/200 sur AAPL 2018-01-01 → 2020-12-31”.
    * [x] **Mock** data via les fixtures internes (pas d’Internet).
    * [x] **Assert** métriques rendues (clé `CAGR`, `maxDrawdown`, `winRate`) et présence `equityCurve` + `trades`.
  * [x] **Scenario 3 — Fundamentals + News**

    * [x] “Donne fondamentaux + 3 news pour NVDA”.
    * [x] **Assert** ratios clés + 3 items news (titre + date).
  * [x] **Scenario 4 — Preferences**

    * [x] Ouvre settings finance, **désactive** l’auto-affichage news.
    * [x] Re-demande news → **assert** comportement conforme (non affiché par défaut, proposition contextuelle ou CTA).
* [x] **Brancher les mocks** (si pas déjà fait au niveau fixtures Playwright)

  * [x] Intercepter `/api/finance/*` et renvoyer les payloads stables des **mocks** (`lib/finance/mock-data.ts`).
  * [x] **Geler le temps** côté tests si nécessaire (dates de news, timestamps OHLC).
* [x] **CI** : le workflow appelle déjà `pnpm e2e` — le nouveau fichier sera pris en compte automatiquement.

> Fichiers : `tests/e2e/finance.spec.ts` (+ fixtures existants sous `tests/e2e/fixtures` si applicable)

---

## 2) Documentation & garde-fous

* [ ] **Ajouter un disclaimer** “**Ce n’est pas un conseil financier**” + risques

  * [ ] `README.md` : nouvelle section **Avertissements / Usage responsable**.
  * [ ] `docs/finance/api.md` : rappeler la nature mock/offline par défaut.
* [ ] **Aligner terminologie métriques** dans la doc

  * [ ] Dans les exemples de payloads (docs), utiliser les **mêmes clés** que le moteur (`maxDrawdown`, pas `maxDD`).
  * [ ] Vérifier les exemples JSON d’artefacts dans `docs/finance/artifacts.md` s’ils existent.

> Fichiers : `README.md`, `docs/finance/api.md`, `docs/finance/*`

---

## 3) Durcissement des tests unitaires (couverture comportements limites)

* [ ] **Backtest** (`lib/finance/backtest/engine.ts`)

  * [ ] Ajouter cas limites : séries courtes (< slow MA), période vide, fees élevés, slippage ≠ 0.
  * [ ] **Assert** que `runBacktest` renvoie des métriques cohérentes (0 trades ⇒ `winRate=0`, `profitFactor=0`…).
* [ ] **Indicateurs** (`lib/finance/indicators.ts`)

  * [ ] Tests sur **EMA** edge cases (constantes, oscillations rapides), **RSI** bornes [0,100].
* [ ] **Patterns** (`lib/finance/patterns.ts`)

  * [ ] Confirmer **non-détection** sur bruit aléatoire ; **détection** stable sur fixtures connues.
* [ ] **Tools Finance** (`lib/ai/tools/finance.ts`)

  * [ ] Tests de validation Zod des inputs (timeframe invalide, symbol inconnu), **erreurs normalisées**.
  * [ ] Tests que l’outil renvoie bien des artefacts conformes (types/shape stricts).

> Fichiers tests :
> `tests/unit/finance/engine.spec.ts`, `tests/unit/finance/indicators.spec.ts`,
> `tests/unit/finance/patterns.spec.ts`, `tests/unit/ai/tools.finance.spec.ts`

---

## 4) API Finance — cohérence et robustesse

* [ ] **Uniformiser** le schéma d’erreurs JSON

  * [ ] Toutes les routes `/api/finance/*` renvoient `{ error: { code, message } }` avec **codes HTTP** cohérents.
* [ ] **Limiter** strictement l’intervalle et la taille des séries

  * [ ] `history` : **cap** (ex. 5000 bougies), `from/to` normalisés, fuseaux.
* [ ] **Logging**

  * [ ] Vérifier `logRouteLatency` sur chaque route ; pas de secrets ; latence mesurée.
* [ ] **Rate-limit**

  * [ ] Vérifier que **toutes** les routes importent `enforceRateLimit` (c’est OK sur notre échantillon).

> Fichiers : `app/api/finance/*/route.ts`, `lib/finance/api-utils.ts`, `lib/ratelimit.ts`

---

## 5) Artefacts UI — finitions et accessibilité

* [ ] **Chart** (`components/finance/finance-chart-artifact.tsx`)

  * [ ] Vérifier props contrôlées pour overlays (SMA/EMA) + persistance via URL/state si prévu.
  * [ ] A11y : focus management, tooltips accessibles (non exclusivement à la souris).
  * [ ] Tests unitaires : events `subscribeClick` / `subscribeCrosshairMove` **mockés** et assertés.
* [ ] **Backtest report** (`components/finance/backtest-report-artifact.tsx`)

  * [ ] A11y : tableaux paginés accessibles ; unités/méthodologie expliquées.
  * [ ] Bouton “Re-tester” ouvre un **form** paramétrable (tests sur validation).
* [ ] **Renderer** (`components/ArtifactRenderer.tsx`)

  * [ ] Garder un fallback **gracieux** si payload malformé (test snapshot d’erreur).
* [ ] **Settings Finance** (`components/settings/finance-settings.tsx`)

  * [ ] Tests : lecture/écriture prefs (mock queries), masquage news effectif dans le flux.

> Fichiers tests :
> `tests/unit/components/finance-chart-artifact.spec.tsx`,
> `tests/unit/components/backtest-report-artifact.spec.tsx`,
> `tests/unit/settings/preferences.spec.tsx`

---

## 6) Schéma & migrations — contrôle final

* [ ] **Index utiles**

  * [ ] `BacktestRun(assetId, timeframe, periodStart)` index couvrant les filtres courants.
  * [ ] Uniques `(symbol, exchange)` dans `Asset`.
* [ ] **FK & onDelete**

  * [ ] `Strategy` → `StrategyVersion` → `BacktestRun` : cascade cohérente.
* [ ] **Seed** (`lib/db/seed.ts`)

  * [ ] Vérifier seed d’actifs (AAPL, NVDA, BTCUSD, EURUSD…) aligné aux **mocks**.
* [ ] **Idempotence**

  * [ ] Exécuter `db:migrate` **plusieurs fois** en local (dev) : pas d’échec/duplication.

> fichiers : `lib/db/schema.ts`, `lib/db/migrations/*.sql`, `lib/db/seed.ts`

---

## 7) CI/CD — petits durcissements

* [ ] **Node engines**

  * [ ] Ajouter `"engines": { "node": ">=20.10" }` au `package.json` pour éviter des runs CI avec Node trop vieux.
* [ ] **Artefacts de test**

  * [ ] Publier `coverage` vitest et un JUnit (si non déjà fait) pour observabilité.
* [ ] **Playwright**

  * [ ] Garder `PLAYWRIGHT=true` dans les tests de route qui s’y réfèrent ; s’assurer que le **scénario e2e** nouvellement ajouté passe en CI.

> fichiers : `.github/workflows/ci.yml`, `package.json`

---

## 8) Prompting & Explicabilité (rappel de garde-fous)

* [ ] **Prompts** (`lib/ai/prompts.ts` ou équivalent)

  * [ ] Conserver les règles d’explication : toujours **expliquer** un motif, une stratégie, un backtest (quelles données, quelles hypothèses).
  * [ ] Mentionner les **sources** (même si mock) et incertitudes ; **ne pas sur-promettre** (pas de conseils personnalisés).

---

# Notes finales (tests & build — ce qu’il faut respecter)

* **Build** : `pnpm build` **lance les migrations** (`tsx lib/db/migrate && next build`) → tes migrations doivent être **idempotentes** et **sans dépendance réseau**.
* **Tests unitaires** : déjà nombreux et couvrants ; **compléter surtout les cas limites** (indicateurs & backtest).
* **E2E** : **ajouter `tests/e2e/finance.spec.ts`** (c’est l’unique vrai manque) ; **tout doit fonctionner offline** grâce aux mocks.
* **CI** : pipeline déjà prêt (migrate → seed → build → unit → e2e). Assure-toi que les nouvelles assertions E2E ne dépendent pas d’horodatages non gelés (fixer l’horloge si nécessaire).

---

## Ce que j’ai explicitement vérifié (exemples concrets)

* `lib/ai/providers.ts` → **OK** : `process.env.OPENAI_MODEL_ID` utilisé, **aucun** `gpt-5-nano`.
* `app/api/finance/*` → **OK** (6 routes), Zod + `enforceRateLimit` présents.
* `components/ArtifactRenderer.tsx` → **OK** : 4 cas finance gérés.
* `components/finance/finance-chart-artifact.tsx` → **OK** : `subscribeClick`, `subscribeCrosshairMove`, overlays SMA/EMA.
* `lib/finance/backtest/engine.ts` → **OK** : `runBacktest`, métriques (`CAGR`, `maxDrawdown`, `winRate`, `sharpe`, `profitFactor`, `totalReturn`), `equityCurve`, `trades`.
* `tests/unit/routes/finance.*.spec.ts` → **OK** (history, backtest, news).
* `tests/e2e` → **Manque** `finance.spec.ts` (seul `accessibility.spec.ts` présent).
* `.env.example` → **OK** (toutes clés finance + `POSTGRES_URL`).
* `.github/workflows/ci.yml` → **OK** (migrate/seed/build/test/e2e).

---

## En résumé

Tout le **socle finance** est en place (IA tools, API, DB, artefacts UI, unit tests, CI). Le **dernier jalon nécessaire** pour coller entièrement à la liste précédente est **d’ajouter le scénario E2E “finance” principal** (chart → backtest → fundamentals/news → préférences), et de **documenter un court disclaimer**. Une fois ces cases cochées, l’ensemble sera **aligné**, **explicable** et **testé de bout en bout**.

---

## Historique des actions

- **2025-10-01** — Vérification du scénario e2e finance complet : gel de l’horloge, interceptions `/api/finance/*`, contrôle des 4 sous-scénarios et exécution de `pnpm exec playwright test tests/e2e/finance.spec.ts --list` pour confirmer la détection des cas.
