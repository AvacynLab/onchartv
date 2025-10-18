Voici ta **liste de tâches exhaustive**, agent. Elle est calée sur la **dernière version du code** que je viens d’auditer et sur nos analyses précédentes (causes d’échecs E2E principales : overlay Next suite à exception client, et divergence d’auth). Les tâches sont **opérationnelles**, **hiérarchisées**, et **précisées fichier par fichier**. Les objectifs et critères d’acceptation (Definition of Done) sont inclus à chaque bloc.

---

## BRIEF — objectifs à atteindre (par toi, l’agent)

* Supprimer toute **exception client** qui déclenche l’overlay Next sur les écrans Chat/Finance.
* **Unifier l’auth** en **mode regular-only** et **aligner les E2E** avec un **storage state** déjà authentifié.
* Rendre les **E2E déterministes** : mocks complets `/api/finance/*`, **horloge gelée**, **bypass rate-limit** sous `PLAYWRIGHT=true`.
* Uniformiser les **erreurs API** (`{ error: { code, message } }`) et les **validations Zod** sur toutes les routes finance.
* Verrouiller **build/CI** : migrations idempotentes, `engines.node`, variables d’env, healthcheck dev-server, artefacts de tests.

---

## Plan de correction (2025-10-30)

1. **Finance – artefacts backtest**
   * [x] Vérifier que la requête backtest renvoie bien un unique artefact `finance-backtest-artifact`.
   * [x] Corriger les doublons/absences en garantissant une clé stable et un rendu conditionnel explicite.
   * [x] Couvrir le scénario par un test ciblé (composant ou route) validant l’unicité et la disponibilité de la table des trades.
2. **Chat – réédition de message**
   * [x] Inspecter le flux `editMessage` pour s’assurer que la réponse assistant est propagée après modification.
   * [x] Sécuriser la logique de streaming côté client et côté test helper (`ChatPage.waitForChatApiResponse`).
   * [ ] Ajouter une couverture test (unit ou integration) pour éviter une régression silencieuse.
3. **Session – enregistrement utilisateur**
   * Diagnostiquer pourquoi la création d’un compte ne redirige plus vers `/chat`.
   * Harmoniser la réponse du handler `register` et l’attente Playwright (toast + redirection).
   * Vérifier via test E2E ciblé ou test API que la redirection est assurée.

---

---

## 0) Préparation & nettoyage (local)

* [ ] Supprime les résidus d’anciennes runs : `.next/`, `node_modules/`, `playwright-report/`, `playwright-results/`.
* [ ] Réinstalle et rebâtis : `pnpm install` puis `pnpm build`.
  **DoD** : build local OK, pas d’erreurs TypeScript.

---

## 1) Auth — option **B (regular-only)** et cohérence bout-en-bout

* [x] `app/(chat)/page.tsx`

  * [x] Si pas de session **ou** `session.user.type !== "regular"` → **redirect `/login`** (comportement unique et documenté).
* [x] `app/(chat)/api/chat/route.ts`

  * [x] En cas de non-regular : **renvoyer** `403` avec payload **JSON** : `{ error: { code: "forbidden:chat", message: "Regular session required" } }`.
  * [x] Aucune `throw` non capturée.
* [ ] `tests/setup/auth.setup.ts`

  * [x] Implémente un **register/login** fiable (sélecteurs exacts), **attends** la redirection vers `/chat`.
  * [x] **Sauvegarde** le **storage state** et **réutilise-le** dans toutes les suites E2E.
  * [x] (Nettoyage) Retire toute dépendance résiduelle aux parcours invités (`/api/auth/guest`) depuis les tests.
  **DoD** : toute suite E2E démarre déjà **authentifiée**; plus aucun 403/redirect inattendu en E2E.

---

## 2) Robustesse UI — **error boundary** & rendu défensif

* [x] `app/(chat)/error.tsx` (à créer si absent)

  * [x] **Error boundary** de segment : fallback clair (titre, explication, bouton “Réessayer”), `console.error(error)`.
* [x] `components/finance/finance-chart-artifact.tsx`

  * [x] **Créer** l’instance chart **une seule fois** (guard via `useRef`).
  * [x] **Cleanup** complet au démontage : `unsubscribe` des handlers (click, crosshair), suppression des séries, `chart.remove()`.
  * [x] **Null-checks** sur data : si `ohlcv.length === 0`, afficher un **empty state** et **ne pas** initialiser le chart.
  * [x] **Ne jamais** accéder à des refs si le composant est démonté (flag `mountedRef`).
  * [x] Vérifie/garantis les `data-testid` utilisés en E2E :

    * [x] `finance-chart-artifact`
    * [x] `finance-chart-details`
* [x] `components/messages.tsx`

  * [x] Utilise `(messages ?? [])` et `(artifacts ?? [])`.
  * [x] Fallback visuel pour artefact inconnu/malformé (pas de `throw`).
* [x] `components/chat.tsx`

  * [x] Guards autour des contexts/stores pendant le streaming.
  * [x] Pas d’accès DOM/ref avant montage.
    **DoD** : plus **aucun overlay Next** visible en conditions de test; les interactions chart fonctionnent (clic/hover) sans exception.

---

## 3) Rate-limit — **bypass E2E**

* [x] `lib/ratelimit.ts`

  * [x] Si `process.env.PLAYWRIGHT === "true"` → **autoriser** (pas de 429) ou multiplier sévèrement le quota.
  * [x] Conserver la politique standard hors E2E.
    **DoD** : pas de 429 durant les E2E; tests unitaires confirment que le bypass est **limité à E2E**.

---

## 4) API Finance — validations & erreurs uniformes

Pour **chaque** route :

* [x] `app/api/finance/history/route.ts`

  * [x] **Zod** strict (symbol, timeframe enum bornée, `from`/`to`, `limit`).
  * [x] Cap `limit` (ex. ≤ 5000), normalise `from <= to`, fuseau OK.
  * [x] **Erreurs** : `{ error: { code: "bad_request", message } }` + status (400/422).

* [x] `app/api/finance/backtest/route.ts`

  * [x] Zod strict pour la stratégie et les bornes.
  * [x] Réponse : `metrics` (totalReturn, CAGR, maxDrawdown, winRate, sharpe, profitFactor), `equityCurve`, `trades`.
  * [x] Erreurs uniformes (400/422), jamais d’exception brute.

* [x] `app/api/finance/quote/route.ts`, `fundamentals/route.ts`, `news/route.ts`, `screen/route.ts`

  * [x] Inputs validés (symbol requis, pagination et bornes).
  * [x] Erreurs au même format `{ error: { code, message } }`.

* [x] `lib/finance/data-adapter.ts`

  * [x] Conversion centralisée (string→number, timestamps normalisés), tolérance aux valeurs manquantes/NaN.

**DoD** : tous les tests unitaires **routes** passent, le format d’erreur est **identique** partout; aucune route ne jette d’exception non gérée.

---

## 5) UI Finance — interactions & a11y

* [x] `components/finance/finance-chart-artifact.tsx`

  * [x] Toggling overlays (SMA/EMA) modifie réellement l’état des séries (mock chart pour tests).
  * [x] `finance-chart-details` actualisé au survol/clic d’une bougie.

* [x] `components/finance/backtest-report-artifact.tsx`

  * [x] Table **a11y** (thead/th/aria-*), unités explicites.
  * [x] Bouton “Re-tester” : validation client (Zod) sur les paramètres.

* [x] `components/finance/fundamentals-card.tsx`, `components/finance/news-list.tsx`

  * [x] Rendu **robuste** avec données partielles (placeholders, pas de crash).

**DoD** : tests UI unitaires verts; E2E peuvent cliquer/attendre des états stables sans flaky.

---

## 6) Backtest & indicateurs — cas limites

* [x] `lib/finance/backtest/engine.ts`

  * [x] **Zéro trade** : `winRate=0`, `profitFactor=0`, `maxDrawdown` calculé sur courbe plate; aucune division par 0.
  * [x] **Fees/slippage** : calculs cohérents pour valeurs élevées.

* [x] `lib/finance/indicators.ts`

  * [x] EMA/RSI : bornes strictes, séries < fenêtre, séries constantes.

* [x] `lib/finance/patterns.ts`

  * [x] Non-détection sur bruit; détection stable sur fixtures (hammer/engulfing).

**DoD** : tests unitaires **complets** sur ces cas limites (verts).

---

## 7) E2E — stabilisation (finance + chat)

* [x] `tests/setup/auth.setup.ts`

  * [x] Exécute **register/login** une fois, **sauvegarde le storage state**, et réutilise-le.
  * [x] Vérifie les **sélecteurs** et la redirection `/chat`.

* [x] `tests/e2e/finance.spec.ts`

  * [x] **Intercepte** toutes les routes `/api/finance/*` (history/quote/fundamentals/news/backtest/screen) avec fixtures **stables**.
  * [x] **Gèle l’horloge** au démarrage.
  * [x] Scénarios :

    * [x] BTCUSD 1D + SMA(50/200) → clic bougie → **détails visibles**.
    * [x] Toggling SMA/EMA → assertions visible/masqué.
    * [x] Backtest SMA 50/200 AAPL → métriques + `equityCurve` + `trades`.
    * [x] Fundamentals + 3 news NVDA → titres/dates visibles.

* [x] `tests/e2e/accessibility.spec.ts`

  * [x] Vérifie l’a11y des artefacts (table backtest, états vides lisibles), **sans** overlay Next.

* [x] `tests/pages/chat.ts`

  * [x] Mets à jour les **sélecteurs** (input, envoyer, items de message) si divergences.
  * [x] Évite toute dépendance à des ressources externes (mock si besoin).

**DoD** : tous les E2E **passent localement**; pas de timeouts; plus d’overlay Next dans les traces.

---

## 8) CI / Build

* [x] `.github/workflows/ci.yml`

  * [x] Expose `PLAYWRIGHT: "true"` et `FEATURE_FINANCE: "true"`.
  * [x] Ordre jobs : **db:migrate → db:seed → build → test (unit) → e2e**.
  * [x] **Healthcheck** du dev-server avant e2e (200 attendu).
  * [x] Upload artefacts : **Playwright report**, **trace.zip**, **coverage** Vitest.

* [x] `package.json`

  * [x] `"engines": { "node": ">=20.10" }`.
  * [x] `packageManager` renseigné (ex. `pnpm@x.y.z`).
  * [x] Scripts présents : `build`, `test`, `e2e`, `e2e:install`, `db:migrate`, `db:seed`.

**DoD** : pipeline CI **vert** de bout en bout; artefacts accessibles.

---

## 9) Base de données & seeds

* [x] `lib/db/schema.ts`

  * [x] Index & uniques pertinents (ex. `BacktestRun(assetId, timeframe, periodStart)`; `(symbol, exchange)` unique sur `Asset`).
  * [x] FK + `onDelete` cohérentes (`Strategy` → `StrategyVersion` → `BacktestRun`).

* [x] `lib/db/migrations/*.sql`

  * [x] **Idempotentes** : re-jouables sans erreur.
  * [x] À jour avec le schéma.

* [x] `lib/db/seed.ts`

  * [x] Jeux d’exemples (`AAPL`, `NVDA`, `BTCUSD`, `EURUSD`) alignés sur les **fixtures E2E**.

**DoD** : migrations et seeds tournent en CI; données cohérentes avec les tests.

---

## 10) ENV & Docs

* [x] `.env.example`

  * [x] Clés présentes : `OPENAI_API_KEY`, `OPENAI_MODEL_ID`, `FEATURE_FINANCE`, `MARKET_DATA_API_KEY`, `NEWS_API_KEY`, `POSTGRES_URL`.
  * [x] Commentaires brefs (portée de chaque clé).

* [x] `README.md`

  * [x] **Disclaimer** (“Pas un conseil financier”).
  * [x] Explications : flags `FEATURE_FINANCE`, `PLAYWRIGHT`, gel de l’horloge E2E, mocks, choix **regular-only**, et comment les tests s’appuient sur le storage state.

**DoD** : onboarding clair; aucun test ne dépend d’un secret non documenté.

---

## 11) Qualité & garde-fous

* [x] Typage & Zod

  * [x] Types inférés via `z.infer` (éviter `any`), union discriminée pour artefacts (clé `type`).
* [x] Feature flag

  * [x] `FEATURE_FINANCE` réellement pris en compte dans l’UI (masquage sections si désactivé).
* [x] Logs

  * [x] Pas de secrets/PII; niveaux `info/warn/error` pertinents; format concis.

**DoD** : lint/tsc propres; logs propres; flags efficaces.

---

## Validation finale

* [ ] Local : `/chat` → “Montre BTCUSD 1D avec SMA(50/200)” → chart interactif **sans overlay**, détails au clic OK.
* [ ] `pnpm test` (unit) → **verts**.
* [ ] `pnpm e2e` → **verts** (finance + accessibilité); traces **sans** “Application error: a client-side exception…”.
* [ ] CI → **vert**; rapports et artefacts disponibles.

---

Si tu veux un lot de **patchs diff prêts à coller** pour les fichiers clés (`app/(chat)/error.tsx`, `app/(chat)/api/chat/route.ts`, `lib/ratelimit.ts`, `components/finance/finance-chart-artifact.tsx`, `tests/setup/auth.setup.ts`, et les routes finance), je te les fournis dans la foulée.

---

## Historique des actions

- **2025-10-17** — Ajout du helper `isChatPathname` pour fiabiliser la détection de la redirection `/chat` dans le setup Playwright, ajout d’un poll `expect` garantissant que la session authentifiée atterrit bien sur le tableau de bord chat, et création d’un test Vitest couvrant les cas acceptés/refusés.
- **2025-10-18** — Vérification du bootstrap Playwright : validation de la persistance/recyclage du storage state partagé par les suites, purge des restes d'API invitées et mise à jour du journal des tâches pour refléter ces états.
- **2025-10-19** — Durcissement du garde `/login` sur le segment racine chat avec réutilisation de session pré-authentifiée, alignement de l’import aliasé pour faciliter les tests, vérification du handler API régulier et ajout d’un test Vitest isolé validant les redirections et la délégation de rendu.
- **2025-10-20** — Vérification approfondie de la robustesse UI : contrôle du fallback error boundary `(chat)`, audit du renderer du chart finance (instanciation unique, teardown complet, états vides, guards `mountedRef`), validation des fallbacks `components/messages` et des garde-fous de streaming dans `components/chat`, puis mise à jour du journal des tâches pour refléter ces accomplissements.
- **2025-10-21** — Validation du bypass rate-limit Playwright : documentation du court-circuit dans `lib/ratelimit.ts`, ajout d’un test Vitest garantissant l’absence de fuite d’état lorsque le flag est désactivé, et mise à jour de la checklist pour clôturer la section.
- **2025-10-22** — Harmonisation des routes finance : validations Zod complètes (history/backtest/quote/fundamentals/news/screen), format d’erreur `{ code, message }` généralisé via `ChatSDKError`, durcissement de l’adapter marché contre NaN, et exécution des suites `tests/unit/routes/finance.*` pour couvrir les régressions.
- **2025-10-23** — Validation UI finance : renforcement du toggle des overlays (tests persistants, `aria-pressed` attendu), persistance des sélections de bougies et couverture Vitest du panneau de détails, introduction d’un schéma Zod client pour le formulaire de re-test avec messages localisés, et ajout de tests couvrant les bornes SMA/dates.
- **2025-10-24** — Stabilisation E2E finance : clic clavier + souris sur le graphique Playwright avec vérification des overlays itératifs, assertions d’a11y (tableau journal, pagination, absence d’overlay Next) et journalisation des interceptions stables. Tentative de `pnpm exec playwright test …` interrompue par le module manquant `@tanstack/react-query` côté dev-server.
- **2025-10-25** — Renforcement de la couche données finance : index unique `BacktestRun_asset_timeframe_period_unique`, migration idempotente associée, garde miroir dans l’ORM en mémoire et tests Vitest couvrant le rejet des doublons + vérification PGlite de l’index.
- **2025-10-26** — Documentation et configuration Playwright : ajout des variables `PLAYWRIGHT` et `NEXT_PUBLIC_FEATURE_FINANCE` dans `.env.example`, rédaction d’une section README détaillant le mode regular-only (redirection `/login`, erreur 403 JSON, storage state Playwright), vérification de la pipeline CI et mise à jour de la checklist.
- **2025-10-27** — Consolidation des cas limites finance : clamp explicite du drawdown plat dans `lib/finance/backtest/engine.ts`, couverture Vitest du scénario quantité nulle et des frais extrêmes, garde vide/period invalide pour les indicateurs EMA/RSI avec tests directionnels, et filtrage des patterns marteau/engulfing via une analyse de tendance pour éviter les faux positifs.
- **2025-10-28** — Ajout d’un override testable pour masquer les artefacts finance côté Messages, journalisation explicite des artefacts filtrés, et correction du handler NextAuth credentials pour bannir l’usage de `any`; couverture Vitest mise à jour (`messages.spec.tsx`).
- **2025-10-29** — Introduction d’un schéma discriminant pour les artefacts persistés (`lib/artifacts/types.ts`), branchement de `convertToUIMessages` sur la nouvelle union, exécution de `pnpm install --frozen-lockfile`, et ajout de tests Vitest couvrant le wrapper (`artifacts.types.spec.ts`, `messages.spec.tsx`, `ai/messages.spec.ts`).
- **2025-10-30** — Harmonisation des journaux : ajout de `logInfo`, conservation des empreintes anonymisées dans les logs finance, mise à jour du seed Postgres pour émettre un journal structuré, et rafraîchissement des tests Vitest (`logging`, `finance.api-utils`, `db/seed`).
- **2025-10-31** — Déduplication des artefacts finance côté `convertToUIMessages` et `components/messages`, ajout d’un hash déterministe pour éviter les doublons, écriture des tests ciblés (`tests/unit/ai/messages.spec.ts`, `tests/unit/components/messages.spec.tsx`) et exécution de `pnpm exec vitest run …` pour valider le comportement.
- **2025-11-01** — Élimination des doublons de parts finance côté `components/messages`, ajout d’un test RTL couvrant le scénario de streaming et renforcement du helper Playwright (`isGenerationComplete`) pour attendre le retour d’un message assistant avant les assertions, puis exécution de `pnpm exec vitest run tests/unit/components/messages.spec.tsx`.
