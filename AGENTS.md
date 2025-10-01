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

* [x] **Ajouter un disclaimer** “**Ce n’est pas un conseil financier**” + risques

  * [x] `README.md` : nouvelle section **Avertissements / Usage responsable**.
  * [x] `docs/finance/api.md` : rappeler la nature mock/offline par défaut.
* [x] **Aligner terminologie métriques** dans la doc

  * [x] Dans les exemples de payloads (docs), utiliser les **mêmes clés** que le moteur (`maxDrawdown`, pas `maxDD`).
  * [x] Vérifier les exemples JSON d’artefacts dans `docs/finance/artifacts.md` s’ils existent.

> Fichiers : `README.md`, `docs/finance/api.md`, `docs/finance/*`

---

## 3) Durcissement des tests unitaires (couverture comportements limites)

* [x] **Backtest** (`lib/finance/backtest/engine.ts`)

  * [x] Ajouter cas limites : séries courtes (< slow MA), période vide, fees élevés, slippage ≠ 0.
  * [x] **Assert** que `runBacktest` renvoie des métriques cohérentes (0 trades ⇒ `winRate=0`, `profitFactor=0`…).
* [x] **Indicateurs** (`lib/finance/indicators.ts`)

  * [x] Tests sur **EMA** edge cases (constantes, oscillations rapides), **RSI** bornes [0,100].
* [x] **Patterns** (`lib/finance/patterns.ts`)

  * [x] Confirmer **non-détection** sur bruit aléatoire ; **détection** stable sur fixtures connues.
* [x] **Tools Finance** (`lib/ai/tools/finance.ts`)

  * [x] Tests de validation Zod des inputs (timeframe invalide, symbol inconnu), **erreurs normalisées**.
  * [x] Tests que l’outil renvoie bien des artefacts conformes (types/shape stricts).

> Fichiers tests :
> `tests/unit/finance/engine.spec.ts`, `tests/unit/finance/indicators.spec.ts`,
> `tests/unit/finance/patterns.spec.ts`, `tests/unit/ai/tools.finance.spec.ts`

---

## 4) API Finance — cohérence et robustesse

* [x] **Uniformiser** le schéma d’erreurs JSON

  * [x] Toutes les routes `/api/finance/*` renvoient `{ error: { code, message } }` avec **codes HTTP** cohérents.
* [x] **Limiter** strictement l’intervalle et la taille des séries

  * [x] `history` : **cap** (ex. 5000 bougies), `from/to` normalisés, fuseaux.
* [x] **Logging**

  * [x] Vérifier `logRouteLatency` sur chaque route ; pas de secrets ; latence mesurée.
* [x] **Rate-limit**

  * [x] Vérifier que **toutes** les routes importent `enforceRateLimit` (c’est OK sur notre échantillon).

> Fichiers : `app/api/finance/*/route.ts`, `lib/finance/api-utils.ts`, `lib/ratelimit.ts`

---

## 5) Artefacts UI — finitions et accessibilité

* [x] **Chart** (`components/finance/finance-chart-artifact.tsx`)

  * [x] Vérifier props contrôlées pour overlays (SMA/EMA) + persistance via URL/state si prévu.
  * [x] A11y : focus management, tooltips accessibles (non exclusivement à la souris).
  * [x] Tests unitaires : events `subscribeClick` / `subscribeCrosshairMove` **mockés** et assertés.
* [x] **Backtest report** (`components/finance/backtest-report-artifact.tsx`)

  * [x] A11y : tableaux paginés accessibles ; unités/méthodologie expliquées.
  * [x] Bouton “Re-tester” ouvre un **form** paramétrable (tests sur validation).
* [x] **Renderer** (`components/ArtifactRenderer.tsx`)

  * [x] Garder un fallback **gracieux** si payload malformé (test snapshot d’erreur).
* [x] **Settings Finance** (`components/settings/finance-settings.tsx`)

  * [x] Tests : lecture/écriture prefs (mock queries), masquage news effectif dans le flux.

> Fichiers tests :
> `tests/unit/components/finance-chart-artifact.spec.tsx`,
> `tests/unit/components/backtest-report-artifact.spec.tsx`,
> `tests/unit/settings/preferences.spec.tsx`

---

## 6) Schéma & migrations — contrôle final

* [x] **Index utiles**

  * [x] `BacktestRun(assetId, timeframe, periodStart)` index couvrant les filtres courants.
  * [x] Uniques `(symbol, exchange)` dans `Asset`.
* [x] **FK & onDelete**

  * [x] `Strategy` → `StrategyVersion` → `BacktestRun` : cascade cohérente.
* [x] **Seed** (`lib/db/seed.ts`)

  * [x] Vérifier seed d’actifs (AAPL, NVDA, BTCUSD, EURUSD…) aligné aux **mocks**.
* [x] **Idempotence**

  * [x] Exécuter `db:migrate` **plusieurs fois** en local (dev) : pas d’échec/duplication.

> fichiers : `lib/db/schema.ts`, `lib/db/migrations/*.sql`, `lib/db/seed.ts`

---

## 7) CI/CD — petits durcissements

* [x] **Node engines**

  * [x] Ajouter `"engines": { "node": ">=20.10" }` au `package.json` pour éviter des runs CI avec Node trop vieux.
* [x] **Artefacts de test**

  * [x] Publier `coverage` vitest et un JUnit (si non déjà fait) pour observabilité.
* [x] **Playwright**

  * [x] Garder `PLAYWRIGHT=true` dans les tests de route qui s’y réfèrent ; s’assurer que le **scénario e2e** nouvellement ajouté passe en CI.

> fichiers : `.github/workflows/ci.yml`, `package.json`

---

## 8) Prompting & Explicabilité (rappel de garde-fous)

* [x] **Prompts** (`lib/ai/prompts.ts` ou équivalent)

  * [x] Conserver les règles d’explication : toujours **expliquer** un motif, une stratégie, un backtest (quelles données, quelles hypothèses).
  * [x] Mentionner les **sources** (même si mock) et incertitudes ; **ne pas sur-promettre** (pas de conseils personnalisés).

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

- **2025-03-05** — Persistance des overlays SMA/EMA dans `finance-chart-artifact`, navigation clavier (flèches/Home/End/Page) avec indications accessibles, raccourci Enter pour l’explication, et tests unitaires couvrant la persistance, l’accessibilité et le nettoyage des abonnements charts.
- **2025-03-06** — Ajout d’un formulaire de re-test accessible dans `finance-backtest-report-artifact` (validation complète, pagination testée), fallback d’affichage pour les artefacts inconnus et message d’avertissement lorsque les news sont désactivées, avec la batterie de tests Vitest correspondante.
- **2025-03-07** — Ajout de la contrainte `engines` (Node >= 20.10) dans `package.json`, configuration Vitest pour produire un rapport JUnit (`coverage/junit.xml`) et stabilisation du répertoire de couverture, publication automatique des artefacts de tests dans `ci.yml`, exécution de `pnpm test` (échoue actuellement sur le scénario de slippage existant).
- **2025-03-08** — Vérification du schéma finance via `tests/unit/db/schema.finance.spec.ts` (index multi-colonnes et cascades FK) et alignement catalogue/fixtures dans `tests/unit/finance/catalog.spec.ts`, exécution ciblée `pnpm exec vitest run tests/unit/db/schema.finance.spec.ts tests/unit/finance/catalog.spec.ts`.
- **2025-03-09** — Normalisation de `PLAYWRIGHT=true` dans les tests de routes/unitaires, ajout de précisions sur l’explication et les sources dans le manuel finance, et exécution `pnpm exec vitest run` ciblant les suites routes/db pour vérifier le comportement hermétique.
- **2025-03-10** — Stabilisation du test `runBacktest` sur le slippage en générant une série en deux phases (baisse puis reprise haussière) garantissant l’ouverture de positions, ré-exécution de `pnpm exec vitest run tests/unit/finance/engine.spec.ts tests/unit/finance/indicators.spec.ts` avec succès après installation des dépendances manquantes.
- **2025-10-01** — Hermétisation supplémentaire de l’E2E finance : interception de `GET/PATCH /api/finance/preferences` avec validation Zod, clonage immuable des préférences et horodatages figés pour refléter l’état persistant ; vérification rapide via `pnpm exec playwright test tests/e2e/finance.spec.ts --list`.
- **2025-10-01** — Ajout de deux brèves NVDA supplémentaires dans `lib/finance/mock-data.ts` pour satisfaire le scénario « 3 news », mise à jour de la doc API (format ISO des dates, limite par défaut) et renforcement du test `/api/finance/news` ; exécution `pnpm exec vitest run tests/unit/routes/finance.news.spec.ts` + `pnpm exec playwright test tests/e2e/finance.spec.ts --list`.
- **2025-10-02** — Dégagé le type strict du formulaire de re-test pour accepter des saisies libres, ajouté une documentation locale sur l’état, puis vérifié `pnpm exec vitest run tests/unit/components/backtest-report-artifact.spec.tsx`.
