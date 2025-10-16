Remet à zero le fichier AGENTS.md et importe la liste des taches fournit ci dessous ainsi que les informations (au mot près) dans le fichier. Une fois effectué, commence l'implementation, et prend ton temps. 

----------
Voici ta feuille de route complète, agent. Elle se base sur la **version actuelle du code**, la **boilerplate ai-chatbot** et l’**analyse des artéfacts Playwright**. Ton but : supprimer l’exception client (overlay Next), stabiliser l’auth par rapport aux E2E, fiabiliser l’API & l’UI finance, et verrouiller tests/build.

---

## BRIEF — objectifs & critères de succès

* Tu **élimines** toute **exception client** sur la page de chat et les artefacts finance (fin de l’overlay “Application error…”).
* Tu **unifies le flux d’auth** sur l’option **B (regular-only)** et **alignes** le code + les tests : l’API chat refuse l’anonyme **avec** une erreur JSON propre et l’E2E utilise un **storage state** régulier.
* Tu rends les **E2E déterministes** : toutes les routes `/api/finance/*` sont **mockées** côté navigateur, l’**horloge** est gelée, et le **rate-limit** est **bypassé** quand `PLAYWRIGHT=true`.
* Tu **standardises** les **erreurs API** (`{ error: { code, message } }`) et les **validations Zod** sur toutes les routes finance.
* Tu ajoutes un **error boundary** au segment `(chat)` et **des garde-fous de rendu** (null-checks, cleanup d’effets, refs).
* Tu verrouilles la **chaîne CI** (migrations idempotentes, `engines.node`, variables d’env, healthcheck dev-server, artefacts de tests).

**Règles tests & build à respecter**

* Node **≥ 20.10**, `packageManager` défini (pnpm).
* CI : `FEATURE_FINANCE=true`, `PLAYWRIGHT=true`, ordre **db:migrate → db:seed → build → unit → e2e**.
* Tests **offline** (aucun appel externe), **horloge gelée** en e2e finance, **rate-limit bypass** actif en e2e.

---

## CHECKLIST — fichier par fichier (avec sous-étapes)

### 0) Nettoyage local (pour repartir propre)

* [ ] Supprimer caches & artefacts locaux

  * [ ] `rm -rf .next/ node_modules/ playwright-report/ playwright-results/`
  * [ ] `pnpm install && pnpm build` (vérifier qu’aucune dégradation n’apparaît)

---

### 1) Robustesse UI — éliminer l’overlay Next (exceptions client)

* [x] `app/(chat)/error.tsx` — **Créer un error boundary de segment**

  * [x] Rendu fallback (titre, info, bouton “Réessayer”).
  * [x] `console.error(error)` (log minimal, pas de PII).
  * [x] **Test unitaire** : enfant qui `throw` → fallback visible, pas d’overlay.

* [x] `components/finance/finance-chart-artifact.tsx` — **Cycle de vie & sécurité**

  * [x] Créer le chart **une seule fois** avec `useRef` + guard si déjà créé.
  * [x] **Cleanup** complet au `useEffect` retour : `unsubscribe` des handlers (`subscribeClick`, `subscribeCrosshairMove`), `remove()` du chart et des séries.
  * [x] **Null-checks** systématiques : si `ohlcv.length === 0` → empty state (ne **pas** initialiser de série).
  * [x] **Ne jamais lire** une ref de série si composant démonté (flag `mountedRef`).
  * [x] **Tests unitaires** :

    * [x] Série vide → aucun crash, empty state.
    * [x] Clic/hover mockés → callbacks sans exception.
    * [x] Montage/démontage répétés → pas de double init, pas de fuite d’écouteurs.

* [x] `components/messages.tsx`

  * [x] Remplacer itérations directes par `(messages ?? []).map(...)` et `(artifacts ?? []).map(...)`.
  * [x] Fallback lisible pour artefact inconnu/malformé (sans `throw`).
  * [x] **Tests** : rendu avec messages vides/malformés → aucun crash.

* [x] `components/chat.tsx`

  * [x] Guards autour des contexts/stores pendant le streaming (pas d’accès avant init).
  * [x] Éviter toute dépendance à des refs DOM avant montage.
  * [x] **Tests** : montage minimal, envoi d’un message → stable, sans erreur console.

* [x] `components/ArtifactRenderer.tsx`

  * [x] **Case par défaut** sur type d’artefact inconnu → message + log, **pas** d’exception.
  * [x] **Test snapshot** avec type inconnu.

---

### 2) Auth — unifier sur **Option B (regular-only)** et aligner tests

* [x] `app/(chat)/page.tsx`

  * [x] Conserver/ajouter redirection vers `/login` si pas de session **ou** si `session.user.type !== "regular"`.

* [x] `app/(chat)/api/chat/route.ts`

  * [x] En tête de handler :

    ```ts
    if (!session || session.user?.type !== "regular") {
      return Response.json(
        { error: { code: "forbidden:chat", message: "Regular session required" } },
        { status: 403 }
      );
    }
    ```
  * [x] S’assurer que **toutes** les branches d’erreur renvoient `{ error: { code, message } }` avec status.

* [x] `tests/setup/auth.setup.ts`

  * [x] Parcours **register/login** : vérifier les **sélecteurs exacts** (inputs, submit), attendre la redirection vers `/chat`.
  * [x] **Sauvegarder** le storage state et le **réutiliser** dans les suites.
  * [x] **Éviter** tout passage par `/api/auth/guest` (supprimer/adapter si hérité).

* [ ] **E2E (chat)** — si des specs héritées attendent l’invité :

  * [x] Adapter pour **reposer sur le storage state regular** (supprimer la dépendance au flux guest).
  * [x] Sur 403 de l’API (si scénario sans user), **asserter** le toast/UI d’erreur plutôt que de laisser un timeout.

---

### 3) Rate-limit & env E2E

* [x] `lib/ratelimit.ts`

  * [x] Bypass E2E :

    ```ts
    const isE2E = process.env.PLAYWRIGHT === "true";
    export function enforceRateLimit(key: string) {
      if (isE2E) return { allowed: true, resetInMs: 0 };
      // logique existante…
    }
    ```
  * [x] **Test unitaire** : quand `PLAYWRIGHT=true`, `allowed === true`.

* [x] `playwright.config.ts`

  * [x] Injecter `env: { PLAYWRIGHT: "true", FEATURE_FINANCE: "true" }`.
  * [x] Dev-server **avec healthcheck** (ex. GET `/` ou `/api/health`).
  * [x] Timeout raisonnable, tracing activé sur échec.

---

### 4) API Finance — validations Zod, limites, erreurs uniformes

* [x] `app/api/finance/history/route.ts`

  * [x] Zod strict (symbol, timeframe enum, `from`/`to`, `limit`).
  * [x] **Limiter `limit`** (ex. ≤ 5000).
  * [x] Normaliser `from`/`to` (ordre, fuseau).
  * [x] **Erreurs** : `{ error: { code: "bad_request", message } }` + `400/422`.
  * [x] **Tests unitaires** : invalides (timeframe inconnu, limit>max, dates inversées), série vide (OK).

* [x] `app/api/finance/backtest/route.ts`

  * [x] Valider stratégie (params bornés), période max.
  * [x] Réponse cohérente : `metrics`, `equityCurve`, `trades`.
  * [x] **Tests unitaires** : invalides (param manquant/sensé), fees/slippage extrêmes, période courte.

* [x] `app/api/finance/quote/route.ts`, `fundamentals/route.ts`, `news/route.ts`, `screen/route.ts`

  * [x] Zod inputs (symbol obligatoire, pagination bornée).
  * [x] **Erreurs** uniformes (même format + status).
  * [x] **Tests** : invalides + “happy path” mocké.

* [x] `lib/finance/data-adapter.ts`

  * [x] Convertir types (string→number), normaliser timestamps.
  * [x] **Tests** : conversions, valeurs manquantes.

---

### 5) UI Finance — interactions, a11y & résilience

* [x] `components/finance/finance-chart-artifact.tsx`

  * [x] Confirmer `data-testid="finance-chart-artifact"` et `data-testid="finance-chart-details"`.
  * [x] Empty state quand pas de data.
  * [x] **Tests** : toggles SMA/EMA (mock chart) → assertions sur état de séries.

* [x] `components/finance/backtest-report-artifact.tsx`

  * [x] Tableau a11y (thead/th, `aria-*`), unités claires.
  * [x] Bouton “Re-tester” : validation params (form Zod côté client).
  * [x] **Tests** : soumissions valides/invalides, métriques mappées (CAGR, maxDrawdown, winRate, Sharpe, profitFactor, totalReturn).

* [x] `components/finance/fundamentals-card.tsx`, `components/finance/news-list.tsx`

  * [x] Supporter champs manquants (afficher placeholders).
  * [x] **Tests** : données minimales/vides → pas de crash, rendu lisible.

---

### 6) Moteur de backtest & indicateurs — cas limites sûrs

* [x] `lib/finance/backtest/engine.ts`

  * [x] **Zéro trade** → `winRate=0`, `profitFactor=0`, `maxDrawdown` sur courbe plate (éviter divisions par 0).
  * [x] **Fees/slippage** : calculs cohérents pour valeurs élevées.
  * [x] **Tests** : séries trop courtes, périodes vides, fees élevées.

* [x] `lib/finance/indicators.ts`

  * [x] EMA/RSI : bornes strictes, séries < fenêtre, séries constantes.
  * [x] **Tests** : cas limites documentés.

* [x] `lib/finance/patterns.ts`

  * [x] Non-détection sur bruit; détection stable sur fixtures (hammer, engulfing).
  * [x] **Tests** correspondants.

---

### 7) E2E — stabilisation finance + chat

* [x] `tests/e2e/finance.spec.ts`

  * [x] **Intercepter toutes** les routes `/api/finance/*` (history/quote/fundamentals/news/backtest/screen) avec fixtures **stables**.
  * [x] **Geler l’horloge** dès le début.
  * [x] Scénarios :

    * [x] BTCUSD 1D + SMA(50/200) → clic bougie → **détails visibles**.
    * [x] Toggling overlays SMA/EMA → visible/masqué.
    * [x] Backtest SMA 50/200 AAPL → métriques attendues + `equityCurve` + `trades`.
    * [x] Fundamentals + 3 news NVDA → titres/dates visibles.

* [x] `tests/setup/auth.setup.ts`

  * [x] **Option B** : register/login, redirection `/chat`, storage state sauvegardé.
  * [x] Réutilisation du storage state dans toutes les suites.

* [x] `tests/e2e/accessibility.spec.ts`

  * [x] Vérifier a11y des artefacts (table backtest, chart focusable si pertinent) — plus d’overlay Next.

* [x] `tests/pages/chat.ts`

  * [x] Mettre à jour les sélecteurs (bouton envoyer, input message, etc.) si divergences.
  * [x] **Zéro dépendance** à des appels externes (mock si nécessaire).

---

### 8) CI / Build / Outils

* [x] `.github/workflows/ci.yml`

  * [x] Exporter `PLAYWRIGHT: "true"`, `FEATURE_FINANCE: "true"`.
  * [x] Jobs : `db:migrate` → `db:seed` → `build` → `test` (unit) → `e2e`.
  * [x] Healthcheck du dev server avant e2e (curl `/` ou `/api/health` 200).
  * [x] Upload des artefacts (Playwright report, traces, coverage Vitest).

* [x] `package.json`

  * [x] `"engines": { "node": ">=20.10" }`.
  * [x] Vérifier `packageManager` (ex. `pnpm@X.Y.Z`).
  * [x] Scripts présents : `test`, `e2e`, `e2e:install`, `db:migrate`, `db:seed`, `build`.

---

### 9) Base de données & seeds

* [x] `lib/db/schema.ts`

  * [x] Index pertinents (`BacktestRun(assetId, timeframe, periodStart)`, unique `(symbol, exchange)` sur `Asset`).
  * [x] FK + `onDelete` cohérentes (`Strategy` → `StrategyVersion` → `BacktestRun`).

* [x] `lib/db/migrations/*.sql`

  * [x] **Idempotence** : re-lancer sans erreur.
  * [x] Cohérence stricte avec le schéma.

* [x] `lib/db/seed.ts`

  * [x] Jeux d’exemples (`AAPL`, `NVDA`, `BTCUSD`, `EURUSD`) **alignés sur les fixtures** E2E.

---

### 10) Documentation

* [x] `README.md`

  * [x] **Disclaimer** (“Pas un conseil financier”).
  * [x] `.env` requis, flags `FEATURE_FINANCE`, `PLAYWRIGHT`.
  * [x] Guide “**Résolution E2E**” (overlay → vérifier error boundary, auth → vérifier storage state, mocks → vérifier interceptions).

* [x] `docs/finance/api.md`

  * [x] Exemples à jour avec **clés métriques exactes** (`maxDrawdown`, pas `maxDD`), limites/pagination, format erreurs.

---

### 11) Divers qualité

* [x] Typage & Zod

  * [x] Utiliser `z.infer<>` (éviter `any`), types discriminants pour artefacts.
  * [x] 2025-10-18 — Finalisation : les artefacts finance injectés dans `components/messages.tsx` sont désormais validés via le
        `financeArtifactSchema` (union discriminée). Les payloads invalides consignent leurs `issues` et sont filtrés avant le
        rendu pour éviter toute propagation de structures `any`. Suite ciblée : `pnpm exec vitest run
        tests/unit/components/messages.spec.tsx --no-coverage --reporter=basic`.
  * [x] 2025-10-17 — Progression : typage strict des helpers Playwright (`ChatPage`) via `zod` pour les réponses d’erreur et
        suppression des `any` sur les flux réseau/chat. Reste à étendre l’effort aux autres modules serveur. Les inspections de
        réponses `request.response()` sont désormais typées (`PlaywrightResponse | null`) sans cast `as any`, et le nouveau test
        hermétique couvre le cas où l’appel réseau se résout sans payload.
  * [x] 2025-10-17 — Progression : factorisation du parsing `{ error: { code, message, cause } }` côté `lib/utils.ts` avec un
        schéma Zod partagé et un helper `ChatSDKError` typé. Les fetchers client (`fetcher`, `fetchWithErrorHandlers`) loggent
        désormais les enveloppes invalides via `logError` et renvoient des erreurs déterministes. Suite de tests dédiée :
        `pnpm exec vitest run tests/unit/lib/utils.fetcher.spec.ts --no-coverage --reporter=basic`.
* [x] Logs

  * [x] Pas de secrets/PII, niveaux `info/warn/error` pertinents. — 2025-10-18 : les avertissements runtime (`components/messages.tsx`, `components/message.tsx`, `lib/utils.ts`, `lib/finance/server-adapter.ts`, `lib/ai/providers.ts`, `lib/ai/system-prompts/index.ts`, `lib/db/queries.ts`) transitent désormais par `logWarning` afin de bénéficier de la sanitisation. Les suites ciblées (`tests/unit/finance/server-adapter.spec.ts`, `tests/unit/ai/messages.spec.ts`, `tests/unit/components/messages.spec.tsx`, `tests/unit/db/queries-runtime.spec.ts`) valident la nouvelle instrumentation.
* [x] Feature flag

  * [x] `FEATURE_FINANCE` réellement respecté dans l’UI (masquer modules si désactivé).

---

## Contrôle final (acceptation)

* [ ] **Local** : `/chat` → “Montre BTCUSD 1D avec SMA(50/200)” : **aucun overlay**, chart interactif OK.
* [x] **Unitaires** : `pnpm test` verts, couverture stable.
* [ ] **E2E** : `pnpm e2e` verts (finance + accessibilité), traces **sans** “Application error: a client-side exception…”.
* [ ] **CI** : pipeline vert de bout en bout, artefacts publiés.

---

Si tu veux, je peux décliner cette checklist en **diffs unifiés** (patchs prêts à coller) pour : `app/(chat)/error.tsx`, `app/(chat)/api/chat/route.ts`, `lib/ratelimit.ts`, `components/finance/finance-chart-artifact.tsx`, `tests/setup/auth.setup.ts`, et les routes finance (schémas Zod + erreurs uniformes).

## Historique des actions

- **2025-10-15** — Ajout du contournement total du rate-limit sous `PLAYWRIGHT=true`, harmonisation des réponses `{ allowed, resetInMs }` sur toutes les routes finance et mise à jour des suites Vitest associées (`lib/ratelimit`, endpoints finance, e2e mocks). Tests `pnpm test` exécutés et verts.
- **2025-10-15** — Alignement de l’API chat sur l’option regular-only : réponse JSON `{ error: { code: "forbidden:chat", message: "Regular session required" } }` sur POST/DELETE quand la session est absente ou non-regular, ajustement des specs Vitest (`chat.post.auth`, `chat.delete`) et exécution de `pnpm test tests/unit/routes/chat.post.auth.spec.ts tests/unit/routes/chat.delete.spec.ts`.
- **2025-10-16** — Durcissement de `components/messages.tsx` : normalisation stricte des artefacts, fallback utilisateur lisible et avertissement console lorsqu’un payload est invalide, couverture Vitest ciblée (`pnpm test tests/unit/components/messages.spec.tsx`).
- **2025-10-16** — Finalisation du segment error boundary `app/(chat)/error.tsx` avec journalisation minimale et documentation, mise à jour de la spec Vitest pour asserter `console.error(error)` et réinstallation des dépendances (`pnpm install`) avant `pnpm test tests/unit/components/chat-error-boundary.spec.tsx`.
- **2025-10-16** — Normalisation du paramètre `query` dans `components/chat.tsx` pour ignorer les requêtes vides et conserver les trim, avec deux tests Vitest garantissant l’envoi auto et le cas blanc (`pnpm test tests/unit/components/chat.spec.tsx`).
- **2025-10-16** — Durcissement de `playwright.config.ts` : injection forcée des variables d’environnement `PLAYWRIGHT`/`FEATURE_FINANCE` dans le navigateur Playwright, bascule du healthcheck vers `/api/health` et documentation associée. Tests ciblés `pnpm test tests/unit/routes/health.spec.ts` exécutés.
- **2025-10-16** — Stabilisation d’`ArtifactRenderer` : vérification runtime des artefacts inconnus, fallback utilisateur conservé et test unitaire dédié (`pnpm test tests/unit/components/artifact-renderer.spec.tsx`) garantissant le rendu et la journalisation sans exception.
- **2025-10-16** — Extension des mocks Playwright finance : interception systématique des routes quote/screen avec validations Zod, assertions supplémentaires dans `tests/e2e/finance.spec.ts` et tentative d’exécution `pnpm exec playwright test tests/e2e/finance.spec.ts --project=e2e --reporter=line` (échec attendu pour le moment sur `tests/setup/auth.setup.ts` à cause d’un timeout de redirection `/login` → `/chat`).
- **2025-10-16** — Harmonisation de la détection des cookies de session Auth.js/NextAuth (`tests/utils/auth-session.ts`, `tests/utils/session-persistence.ts`) pour reconnaître les variantes `next-auth`/`__Secure-next-auth`, mise à jour des suites unitaires (`pnpm exec vitest run …`, `pnpm exec tsx --test tests/unit/auth-session-utils.test.ts`) et tentative Playwright bloquée faute de navigateurs installés (`pnpm exec playwright test …`).
- **2025-10-16** — Factorisation des interceptions finance dans `tests/helpers/finance-mocks.ts`, réutilisation partagée dans `tests/e2e/finance.spec.ts` et `tests/e2e/accessibility.spec.ts` (horloge figée et mocks offline dès le `beforeEach`). Tentative `pnpm exec playwright test tests/e2e/accessibility.spec.ts --project=e2e --reporter=line` interrompue par les erreurs Next.js « Module not found: Can't resolve '@tanstack/react-query' » émises par le dev-server hermétique.【ce9692†L1-L19】
- **2025-10-16** — Vérification complète des artefacts finance (chart/backtest/fundamentals/news) et des utilitaires backtest côté serveur : toutes les validations Zod et tests associés sont verts (`pnpm exec vitest run --no-coverage tests/unit/components/finance-chart-artifact.spec.tsx tests/unit/components/finance-backtest-report-artifact.spec.tsx tests/unit/components/fundamentals-card.spec.tsx tests/unit/components/news-list.spec.tsx tests/unit/lib/finance-data-adapter.spec.ts tests/unit/lib/finance.engine.spec.ts tests/unit/lib/finance.indicators.spec.ts tests/unit/lib/finance.patterns.spec.ts`). Pin du workflow CI sur Node 20.10.0 pour refléter la contrainte `package.json#engines`.
- **2025-10-16** — Durcissement du helper Playwright `ChatPage.waitForChatApiResponse` : détection explicite des réponses 403 `forbidden:chat`, vérification du toast utilisateur associé et message d'erreur enrichi. Ajout de la méthode `expectForbiddenToast` avec garde sur le contenu, refactorisation des tests unitaires correspondants et couverture ciblée via `pnpm exec vitest run tests/unit/pages/chat-page.spec.ts --no-coverage --reporter=basic -t "chat API rejects"`.
- **2025-10-16** — Vérification de la pipeline CI et du package : contrôle que `.github/workflows/ci.yml` exporte bien `PLAYWRIGHT`/`FEATURE_FINANCE`, enchaîne `db:migrate → db:seed → build → test → e2e`, probe `/api/health` et archive les artefacts. Confirmation du `package.json` (engines ≥20.10, packageManager pnpm@9.12.3, scripts db/test/e2e présents). Tests ciblés exécutés : `pnpm test tests/unit/routes/health.spec.ts` après installation des dépendances (`pnpm install`).
- **2025-10-17** — Mise à jour de la documentation finance : ajout du tableau `.env` (avec `FEATURE_FINANCE`/`PLAYWRIGHT`) et du guide de dépannage e2e dans `README.md`, normalisation des sections requête/réponse et des exemples d'erreurs dans `docs/finance/api.md`. Vérification via `pnpm test tests/unit/routes/health.spec.ts` (couverture activée) pour s'assurer qu'aucune régression n'a été introduite.【a03ac6†L1-L62】
- **2025-10-17** — Durcissement du helper Playwright `ChatPage`: filtrage explicite des hôtes non locaux pour empêcher toute attente sur des APIs externes, ajout du whitelisting interne et d'un test Vitest ciblé garantissant le comportement (`CI=1 pnpm exec vitest run tests/unit/pages/chat-page.spec.ts --no-coverage --reporter=basic -t "ignores chat API requests targeting non-local hosts"`).
- **2025-10-17** — Masquage des outils finance lorsque `FEATURE_FINANCE=false` dans `components/message.tsx`, plus création d’un test `PreviewMessage` dédié (`pnpm exec vitest run tests/unit/components/message.finance.spec.tsx --no-coverage --reporter=basic`) afin de couvrir les cas activé/désactivé du flag côté UI.
- **2025-10-17** — Typage renforcé des helpers Playwright `ChatPage` : retrait des `any`, ajout d’un schéma Zod pour analyser les réponses `{ error: { code, message } }` et normalisation des watchers réseau. Ajout de garde `unknown` côté route `app/(chat)/api/chat/route.ts` pour éviter les catches permissifs. Tentatives de `pnpm exec vitest run tests/unit/pages/chat-page.spec.ts --no-coverage --reporter=basic --pool=threads --poolOptions.threads.maxThreads=1` avortées par `ERR_WORKER_OUT_OF_MEMORY` malgré `NODE_OPTIONS=--max-old-space-size=8192`.【0bc24a†L1-L19】
- **2025-10-17** — Sécurisation de `ChatPage.waitForChatApiResponse` : typage explicite du transport Playwright (`Promise<PlaywrightResponse | null>`), suppression des cast `as any` et ajout du test unitaire « handles chat requests that resolve without a response payload ». Installation des dépendances (`pnpm install`) puis exécution ciblée `pnpm exec vitest run tests/unit/pages/chat-page.spec.ts --no-coverage --reporter=basic -t "handles chat requests that resolve without a response payload"`.
- **2025-10-17** — Alignement de `tests/e2e/chat.test.ts` sur le storage state régulier : initialisation systématique du `ChatPage` via le contexte `adaContext` afin d’éliminer toute dépendance au flux invité et commentaire de garde expliquant le recours au storage state. Les scénarios conservent les assertions existantes et utilisent désormais `adaContext.page` lorsque nécessaire.
- **2025-10-17** — Audit du socle base de données finance : vérification des index/contraintes décrits dans `lib/db/schema.ts`, contrôle de l’idempotence des migrations finance et durcissement de `lib/db/seed.ts` (tri déterministe + garde sur les symboles requis). Ajout de specs Vitest (`tests/unit/db/seed.spec.ts`) couvrant l’upsert normalisé et l’erreur lorsque des symboles Playwright manquent, exécutées via `pnpm dlx vitest@2.1.9 run tests/unit/db/seed.spec.ts --no-coverage --reporter=basic`.
- **2025-10-17** — Normalisation des helpers `fetcher`/`fetchWithErrorHandlers` : enveloppe d’erreur API typée via Zod, journalisation des réponses invalides et propagation d’un `ChatSDKError` cohérent côté client. Suite dédiée : `pnpm exec vitest run tests/unit/lib/utils.fetcher.spec.ts --no-coverage --reporter=basic`.
- **2025-10-18** — Validation stricte des artefacts finance dans `components/messages.tsx` via `financeArtifactSchema`, consignation des `issues` pour les payloads rejetés et nouveau test garantissant la propagation exclusive des artefacts valides (`pnpm exec vitest run tests/unit/components/messages.spec.tsx --no-coverage --reporter=basic`).
- **2025-10-18** — Remplacement des `console.warn` sensibles par `logWarning` sur les modules chat/finance/IA (`lib/db/queries.ts`, `lib/finance/server-adapter.ts`, `lib/ai/providers.ts`, `lib/ai/system-prompts/index.ts`, `lib/utils.ts`, `components/messages.tsx`, `components/message.tsx`). Ajout d’un test hermétique garantissant la journalisation des caches Playwright corrompus et mise à jour des suites React/serveur (`pnpm exec vitest run tests/unit/finance/server-adapter.spec.ts tests/unit/ai/messages.spec.ts tests/unit/components/messages.spec.tsx tests/unit/db/queries-runtime.spec.ts --no-coverage --reporter=basic`).
- **2025-10-18** — Ajustement de `resolveNextDevCommand` pour forcer `next dev --no-turbo` lorsque les drapeaux Playwright/hermetic sont actifs. Cela évite les erreurs « Can't resolve '@tanstack/react-query' » observées avec Turbopack et garantit le recours au serveur webpack pendant les E2E. Suite Vitest ciblée : `pnpm dlx vitest@2.1.9 run tests/unit/utils/next-dev-command.spec.ts --no-coverage --reporter=basic`.
- **2025-10-18** — Ajout d’un échange de signature texte client ↔ serveur pour les régénérations (`lib/ai/messages/signature.ts`, `components/chat.tsx`, `app/(chat)/api/chat/{schema,route}.ts`). Le serveur privilégie désormais les fragments persistés quand la signature client concorde et retombe sur le payload entrant quand elle diverge, évitant les réponses obsolètes observées en E2E. Le bouton de re-test finance expose aussi une étiquette ARIA stable. Suites exécutées : `pnpm test` (couverture complète).
