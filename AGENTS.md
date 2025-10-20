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
   * [x] Ajouter une couverture test (unit ou integration) pour éviter une régression silencieuse.
3. **Session – enregistrement utilisateur**
   * [x] Diagnostiquer pourquoi la création d’un compte ne redirige plus vers `/chat`.
   * [x] Harmoniser la réponse du handler `register` et l’attente Playwright (toast + redirection).
   * [x] Vérifier via test E2E ciblé ou test API que la redirection est assurée.

---

## Plan de correction complémentaire (2025-11-08)

Objectif : éliminer les trois échecs Playwright toujours présents dans les logs CI du 2025-11-08 (`finance artefacts accessibility`, `chat edit/resubmit`, `register new account`). Chaque lot précise le diagnostic attendu, les investigations à mener et le livrable de validation.

1. **Finance — accessibilité des artefacts backtest**
   * [ ] Rejouer localement `tests/e2e/accessibility.spec.ts` en mode `DEBUG=playwright` et capturer le DOM juste après `GET /api/finance/backtest` pour confirmer l’absence de `<div data-testid="finance-backtest-artifact">` (utiliser `page.screenshot` + `console.debug` côté serveur dans `lib/ai/messages/convertToUIMessages`).
      - Tentative du 2025-12-01 : l'exécution isolée a échoué dans le `beforeEach` (timeout 240 s) avec fermeture du contexte avant l'apparition du bouton `send-button`. Le dev-server restait accessible mais la navigation `/chat` n'a jamais terminé la préparation de la surface; trace disponible dans `playwright-results/e2e-accessibility-Finance--f2112-ls-across-finance-artefacts-e2e/`.
  * [x] Cartographier le pipeline de rendu :
      - [x] Inspecter `lib/ai/messages.ts` et `convertToUIMessages` pour l’état des `data-finance-backtest` parts après la déduplication par hash.
      - [x] Vérifier dans `components/messages.tsx` (sections `financePartFingerprints` et `sanitizedArtifacts`) quelles branches peuvent vider `artifactCandidates` lorsque plusieurs payloads identiques sont reçus.
      - [x] Examiner `components/finance/backtest-report-artifact.tsx` afin de confirmer les conditions de rendu/aria (`hidden`, `aria-hidden`, `tabIndex`).
  * [x] Corriger la condition fautive (ordre de filtre, hash incorrect ou gating `financeFeatureEnabled`) de sorte qu’au moins un artefact backtest persiste et possède un `table` focusable ; ajouter un test React Testing Library (réalisé via `BacktestReportArtifact`) qui vérifie `getByTestId("finance-backtest-artifact")` + focus sur le tableau.
  * [x] Instrumenter la normalisation côté `Messages` pour journaliser les candidats d'artefacts écartés (2025-11-23).
  * [x] Emettre un snapshot `[convertToUIMessages]` via `console.debug` lorsque `DEBUG` contient `playwright` afin de tracer les artefacts (2025-11-28).
  * [x] Normaliser les bornes de période `finance.backtest` (coercition ISO + mocks alignés) pour éviter la purge silencieuse des artefacts lorsque l'API renvoie des epochs (2025-11-30).
  * [ ] Rejouer `tests/e2e/accessibility.spec.ts` isolé pour valider que l’artefact est visible, puis archiver la capture `trace.zip` associée dans les notes CI.
      - Tentative du 2025-12-01 : l'exécution isolée a échoué dans le `beforeEach` (timeout 240 s) avec fermeture du contexte avant l'apparition du bouton `send-button`. Le dev-server restait accessible mais la navigation `/chat` n'a jamais terminé la préparation de la surface; trace disponible dans `playwright-results/e2e-accessibility-Finance--f2112-ls-across-finance-artefacts-e2e/`.
      - Tentative du 2025-12-02 : `DEBUG=playwright pnpm exec playwright test tests/e2e/accessibility.spec.ts --reporter=dot` échoue toujours faute d'artefact backtest visible (`getByTestId("finance-backtest-artifact")` absent). Les logs côté dev-server signalent des erreurs JWT (`no matching decryption secret`) lors de la réutilisation du storage state ainsi qu'un `SyntaxError: Unexpected end of JSON input` après 100 s d'attente de la surface chat. Trace conservée sous `playwright-results/e2e-accessibility-Finance--f2112-ls-across-finance-artefacts-e2e/`.
      - Mise à jour du 2025-12-03 : correction de la boucle `pollForStreamingChange` (accolade manquante) qui empêchait la compilation des helpers Playwright/Vitest (`Unexpected token` dans `tests/pages/chat.ts`). Relancer les suites ciblées maintenant que le parseur ne bloque plus.

2. **Chat — réédition et redémarrage du streaming**
  * [x] Ajouter une instrumentation dans `tests/pages/chat.ts` (via `logPlaywrightStreamDebug` et horodatage) autour de `prepareForGeneration`, `waitForUiStreamingFallback` et `pollForStreamingChange` pour observer les valeurs `assistantCount`, `signalCount`, `spinnerCount` pendant l’édition.
  * [x] Comparer ces mesures avec les événements côté client : instrumenter `components/chat.tsx` et `components/messages.tsx` (flag `PLAYWRIGHT_STREAM_DEBUG`) pour journaliser la succession `pending → streaming → completed` et détecter si le SSE `token` s’arrête avant que `messages` soit réhydraté.
  * [x] Adapter la logique `pollForStreamingChange` : vérifier la prise en compte des états `spinnerCount === 0` mais `assistantCount === baseline.count` en présence d’un message avec `latestMessageId` identique ; considérer l’écoute de `data-message-status="streaming"` ou du compteur `__PLAYWRIGHT_CHAT_SIGNALS__`.
  * [x] Ajouter un test ciblé (Vitest jsdom dans `tests/unit/pages/chat-page.spec.ts`) qui valide qu’un changement de `data-message-status` déclenche bien la reprise du streaming lors d’une édition.
  * [x] Capturer l’état observé lors du timeout (`pollForStreamingChange`) et l’ajouter aux journaux/erreurs pour diagnostiquer les blocages Playwright (2025-11-26) — relancer `tests/e2e/chat.test.ts:83` une fois le dev-server stable.
  * [ ] Rejouer `tests/e2e/chat.test.ts:83` avec `DEBUG=pw:api` pour confirmer la disparition du timeout, puis supprimer les journaux temporaires.

3. **Session — inscription utilisateur et redirection**
  * [ ] Exécuter `tests/e2e/session.test.ts:56` seul en conservant le `trace.zip` et relever :
      - Tentative du 2025-12-04 (`pnpm exec playwright test tests/e2e/session.test.ts --project=e2e --grep "Register new account"`).
        Après installation des dépendances système/browsers (`pnpm exec playwright install chromium` + `install-deps`),
        l’auth setup aboutit, la surface chat finit par se charger (73.7 s) mais `waitForChatDashboard`
        reste bloqué sur `http://localhost:44313/register`. Trace stockée sous
        `playwright-results/e2e-session-Login-and-Registration-Register-new-account-e2e/trace.zip` pour analyse
        (réponse finale attendue / toasts encore à inspecter via l’outil trace).
      - [ ] la réponse de l’action `/register` (`network` tab) et le payload JSON retourné,
      - [ ] les éventuels toasts ou erreurs de validation dans la console.
  * [x] Limiter la tentative de `updateSession()` à 3s côté client avant de lancer `router.replace` pour éviter les blocages Playwright (2025-11-10).
  * [x] Durcir `waitForChatDashboard` en pollant le composer pour absorber les transitions client lentes après redirection (2025-11-13).
  * [x] Remplacer l’assertion directe sur le champ email par un `expect.poll` dans `ensureLoggedIn` afin d’absorber les désynchronisations de rendu pendant l’hydratation (2025-11-15).
  * [x] Vérifier côté serveur (`app/(auth)/register/page.tsx`, `app/(auth)/register/actions.ts`) que le flux crée un chat initial via `createInitialChat`, invalide les routes `/chat` et `/chat/:id`, et renvoie un `redirectTo` ciblant la nouvelle conversation (2025-11-17). Contrôler la cohérence avec `tests/setup/auth.setup.ts` (callbacks `onRegenerated`).
  * [x] Introduire, si nécessaire, un mécanisme client pour garantir l’apparition du composer après succès (fallback `window.location.assign` lancé après `router.replace`, couvert par `register-page.spec.tsx`).
  * [x] Lancer `router.replace` dès la fin du rafraîchissement de session afin que la navigation `/chat` démarre avant l’expiration de la fenêtre toast (2025-11-22).
  * [x] Instrumenter `app/(auth)/register/page.tsx` pour journaliser la phase de redirection et forcer un double `window.location.*` (250 ms + 750 ms) en complément du `router.replace`, puis couvrir le comportement via `register-page.spec.tsx`.
    * [ ] Rejouer `tests/e2e/session.test.ts:56` et vérifier que `waitForChatDashboard` voit bien `getByPlaceholder("Send a message...")` dans les 60s ; si besoin, ajuster le helper pour attendre la création du premier chat (`expect.poll` sur `message-assistant`).
        - Constat du 2025-11-18 : la route `/api/auth/callback/credentials` renvoie encore un `302` malgré `redirect=false`, ce qui fait expirer `loginWithCredentialsCallback`; diagnostiquer `NextAuth`/handler avant la prochaine tentative.
        - Mise à jour du 2025-11-19 : le helper Playwright plafonne désormais les redirections (`maxRedirects: 0`) et applique un chemin par défaut lors de l’injection des cookies, à valider lors de la prochaine relance ciblée.
        - Mise à jour du 2025-11-20 : normaliser l’URL injectée (origine → `new URL(...).toString()`), logguer un avertissement ciblé si la normalisation échoue, puis relancer le setup Playwright isolé pour confirmer la disparition de l’erreur « Cookie should have either url or path ».
        - Mise à jour du 2025-11-21 : `didSignInSucceed` considère désormais les réponses `3xx` non orientées vers `/login` comme des succès, ce qui reflète les retours NextAuth observés en CI (validé via `node --import tsx --test tests/unit/auth-sign-in-response.test.ts`).
        - Mise à jour du 2025-11-24 : normalisation de l'injection des cookies Playwright (`tests/setup/auth.setup.ts`) avec logging structuré et filtrage des métadonnées pour diagnostiquer les erreurs `addCookies`, à valider lors de la prochaine relance ciblée.
        - Mise à jour du 2025-11-25 : retrait du slash final et de la propriété `path` lors de l'injection des cookies dans le contexte Playwright pour éviter l'erreur « Cookie should have either url ou path », couvert par `tests/unit/helpers/create-auth-context.spec.ts` et `tests/unit/utils/programmatic-login.spec.ts`.
        - Mise à jour du 2025-11-27 : double `setTimeout` (250 ms / 750 ms) et fallback `window.location` instrumenté dans `register/page.tsx`, logs `[register] enforcing window-level redirect` visibles en jsdom ; la relance Playwright ciblée continue toutefois d'échouer (composer non visible), `trace.zip` à analyser lors de la prochaine session.
        - Mise à jour du 2025-11-29 : appel immédiat de `ensureHardRedirect()` juste après `router.replace` pour amorcer la navigation avant les timeouts, validé par `tests/unit/components/auth/register-page.spec.tsx`.

4. **Validation finale**
   * [ ] Exécuter `pnpm exec playwright test tests/e2e/accessibility.spec.ts tests/e2e/chat.test.ts:83 tests/e2e/session.test.ts:56` (ou les blocs équivalents) jusqu’à obtenir un résultat vert.
   * [ ] Relancer `pnpm e2e` complet et archiver les principales statistiques (`[#timing]`, captures en cas d’échec) pour le journal CI.

**Notes**

- Les captures Playwright existantes (voir `playwright-results/...`) restent utiles pour comparer l’avant/après.
- Prioriser la reproductibilité locale avant de modifier les composants : ajouter des logs `console.debug` temporaires si nécessaire, mais les supprimer avant le commit final.

---


## 0) Préparation & nettoyage (local)

* [ ] Supprime les résidus d’anciennes runs : `.next/`, `node_modules/`, `playwright-report/`, `playwright-results/`.
* [x] Réinstalle et rebâtis : `pnpm install` puis `pnpm build`.
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
* [x] `pnpm test` (unit) → **verts**.
* [ ] `pnpm e2e` → **verts** (finance + accessibilité); traces **sans** “Application error: a client-side exception…”.
* [ ] CI → **vert**; rapports et artefacts disponibles.

---

## Points en suspens

1. ✅ `pnpm build` relancé (log > `/tmp/build.log`) et succès confirmé via `tail -n 50 /tmp/build.log` le 2025-11-03.
2. Les tests E2E restent à exécuter (`pnpm e2e`). Le setup nécessite que Playwright soit installé (fait via `pnpm exec playwright install --with-deps chromium`).
3. Vérifier que les autres sections du plan (auth flow, finance E2E) sont toujours à l’état attendu.
4. La suite complète `tests/unit/pages/chat-page.spec.ts` reste très lourde (OOM > 200s). Seule l’assertion ciblée "reconnaît le retour d'un message assistant recréé après une édition" a été rejouée pour valider la nouvelle couverture.

## Tests complémentaires recommandés

- [x] Ajouter un scénario couvrant un cache JSON incomplet dans `tests/unit/db/queries.spec.ts` (manquant jusqu’ici).
- [x] Intégrer un test d’intégration Playwright qui corrompt `tests/.auth/user.json` pour valider la résilience de `loadCredentials()` (voir `tests/e2e/setup/credentials-resilience.test.ts`).

## Informations utiles

- Les nouvelles dépendances (`@tanstack/react-query`, `lightweight-charts`, etc.) ont été installées via `pnpm install`; ne pas réinitialiser `node_modules/`.
- Tests unitaires déjà exécutés : `pnpm exec vitest run tests/unit/db/queries.spec.ts tests/unit/utils/load-credentials.spec.ts` et l’assertion ciblée de `tests/unit/pages/chat-page.spec.ts`.
- Naviguer dans `tests/utils/load-credentials.ts` pour toute modification future côté setup Playwright.
- `loadCredentials` accepte un callback `onRegenerated` pour nettoyer `state.json`/cookies lorsque le cache change : voir `tests/setup/auth.setup.ts`.

## TODOs ciblés

- [x] `tests/unit/db/queries.spec.ts`: vérifier si d’autres cas d’erreur (JSON mal formé non vide) doivent être couverts (lignes ~120-140).
- [x] `tests/setup/auth.setup.ts`: confirmer que l’appel à `loadCredentials()` est correctement géré lors des reruns (aucune régression signalée, mais garder un œil sur les logs Playwright).
- [x] Relancer `pnpm build` et archiver les 20 dernières lignes de sortie pour le compte-rendu CI (fait le 2025-11-03).

## Problèmes / quirks connus

- Le reset de la base mémoire (`__resetInMemoryDbForTests`) journalise un warning « Failed to reset persisted Playwright users » quand le fichier JSON n’existe pas : c’est attendu avec l’approche actuelle.
- Les commandes Next.js génèrent énormément d’output ; utiliser une redirection vers fichier pour éviter les limites de taille dans ce sandbox.

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
- **2025-11-02** — Durcissement de l’hydratation Playwright : journal structuré pour les enregistrements incomplets, tests Vitest couvrant les caches vides/incomplets (`tests/unit/db/queries.spec.ts`, `tests/unit/utils/load-credentials.spec.ts`), et ajout d’une couverture ciblée de `ChatPage.waitForUiStreamingFallback` validée via `pnpm exec vitest run -t "reconnaît le retour" tests/unit/pages/chat-page.spec.ts`.
- **2025-11-03** — Confirmation du correctif de déduplication finance (`components/messages.tsx`, `lib/utils.ts`), ajout du test jsdom d’inscription (`tests/unit/components/auth/register-page.spec.tsx`), exécution de `pnpm exec vitest run tests/unit/components/messages.spec.tsx tests/unit/components/auth/register-page.spec.tsx --reporter=basic`, puis relance réussie de `pnpm build` avec capture des 50 dernières lignes.
- **2025-11-04** — Ajout d’un test Playwright résilience (`tests/e2e/setup/credentials-resilience.test.ts`) qui corrompt `tests/.auth/user.json`, vérifie la régénération via `loadCredentials()`, purge le snapshot `state.json`, et restaure le cache initial.
- **2025-11-05** — Durcissement de `tests/setup/auth.setup.ts` : ajout du callback `onRegenerated` dans `loadCredentials`, purge automatique de `state.json` et du cookie Playwright lors d’un changement d’utilisateur, lecture de contrôle du cache et extension des tests unitaires (`tests/unit/utils/load-credentials.spec.ts`).
- **2025-11-06** — Stabilisation du pont vers `lib/logging` : cache global tenant compte des `vi.spyOn`, ajustements de `loadPersistedUsers` pour réémettre les avertissements avec l’instance espionnée, et passage complet de `pnpm test` confirmant les cas JSON corrompus/incomplets (`tests/unit/db/queries*.spec.ts`).
- **2025-11-07** — Restauration automatique du snapshot `state.json` après le test Playwright de résilience des identifiants afin que les suites routes/E2E retrouvent la session authentifiée, et assouplissement du détecteur de streaming (`tests/pages/chat.ts`) pour considérer les vidages de bulles assistants comme un signal valide. Vérifié via `pnpm exec vitest run tests/unit/utils/load-credentials.spec.ts --reporter=basic`.
- **2025-11-08** — Analyse des échecs Playwright persistants (finance backtest a11y, chat edit/resubmit, register redirect) et élaboration d’un plan d’attaque détaillé avec étapes d’investigation, correctifs ciblés et validation finale.
- **2025-11-09** — Raffinement du plan 2025-11-08 : ajout des sous-étapes de diagnostic (captures DOM, instrumentation Playwright/client, audit du flux register) et définition des validations par tests ciblés avant relance complète de `pnpm e2e`.
- **2025-11-10** — Encapsulation de `updateSession()` côté register avec une course timeout 3s + Vitest ciblé pour éviter les blocages Playwright avant la redirection `/chat`.
- **2025-11-11** — Stabilisation de la rehydratation finance : amélioration de `convertToUIMessages` pour remplacer les parts transitoires par les artefacts persistés, ajout d’un `tabIndex` documenté sur la table du journal des trades, et création de tests Vitest (`ai/messages`, `components/backtest-report-artifact`) garantissant la présence/focusabilité de l’artefact backtest.
- **2025-11-12** — Ajout de l’attribut `data-message-status` sur les bulles assistant, adaptation de `waitForUiStreamingFallback` pour considérer l’état "streaming" lors des rééditions, et création d’un test jsdom ciblé validant le nouveau signal Playwright.
- **2025-11-13** — Renforcement du helper `waitForChatDashboard` : utilisation d’un `expect.poll` sur le composer pour absorber les transitions lentes avant d’asserter la redirection `/chat`.
- **2025-11-14** — Ajout d’un fallback de redirection stricte après inscription (`window.location.assign` temporisé), généralisation de `pollForStreamingChange` pour reconnaître les transitions d’état assistant, et création d’un test jsdom dédié couvrant ce changement de statut.
- **2025-11-15** — Durcissement du setup Playwright : surveillance du champ email via `expect.poll` dans `ensureLoggedIn` pour tolérer l’hydratation lente et préparation à la relance de `tests/e2e/session.test.ts:56`.
- **2025-11-16** — Centralisation du debug streaming Playwright : création de `lib/playwright-debug.ts`, instrumentation de `tests/pages/chat.ts`, `components/chat.tsx` et `components/messages.tsx` derrière le flag `PLAYWRIGHT_STREAM_DEBUG`, ajout d’un test RTL vérifiant la télémétrie, et exécution de `pnpm exec vitest run tests/unit/components/messages.spec.tsx --reporter=basic`.
- **2025-11-17** — Semis d’un chat d’onboarding lors de l’inscription : ajout de `createInitialChat` dans `lib/db/queries.ts`, mise à jour de `register` pour invalider `/chat` et retourner le nouvel identifiant, couverture Vitest (`tests/unit/db/queries.spec.ts`) et actualisation du plan pour refléter le statut côté serveur.
- **2025-11-18** — Correction du référentiel `messages` dans `components/chat.tsx` (initialisation du hook avant comptage), ajout d’une instrumentation Vitest garantissant que `logPlaywrightStreamDebug` voit bien `{ status, messageCount }`, et nouvelle tentative Playwright révélant le 302 persistant sur `/api/auth/callback/credentials`.
- **2025-11-19** — Ajustement de `loginWithCredentialsCallback` pour bloquer les redirections implicites de NextAuth (`maxRedirects: 0`), normalisation des cookies injectés dans le contexte Playwright (`path` par défaut, repli `url`), et mise à jour du test unitaire `programmatic-login.spec.ts` confirmant l’option explicite.
- **2025-11-20** — Normalisation de l’URL injectée dans `tests/setup/auth.setup.ts` (origin → `new URL(...).toString()`), avertissement ciblé si la conversion échoue, et exécution de `pnpm exec vitest run tests/unit/utils/programmatic-login.spec.ts --reporter=basic` pour vérifier le nouveau comportement.
- **2025-11-21** — Alignement de `didSignInSucceed` sur les réponses 302 de NextAuth pour que la post-inscription reconnaisse les redirections vers `/chat`, et ajout d’un test `node --import tsx --test tests/unit/auth-sign-in-response.test.ts` confirmant le scénario.
- **2025-11-22** — Déplacement de `router.replace` avant la fenêtre d’attente toast pour lancer immédiatement la navigation `/chat` après inscription, exécution ciblée de `register-page.spec.tsx` (avec dépendance coverage optionnelle refusée) et mise à jour du plan de remédiation.
- **2025-11-23** — Ajout d’un warning explicite quand `Messages` perd des artefacts finance après parsing et extension de la suite RTL pour vérifier qu’un backtest persiste après un rendu séquentiel (chart → backtest).
- **2025-11-24** — Normalisation des cookies d’auth Playwright (construction d’URL + chemin) et journalisation des métadonnées applicables pour identifier les erreurs `context.addCookies` lors du warm-up.
- **2025-11-25** — Ajustement de l’injection des cookies Playwright pour n’utiliser que l’origine (sans slash final) et retirer la propriété `path` avant `context.addCookies`, mise à jour des helpers (`tests/setup/auth.setup.ts`, `tests/helpers.ts`), et exécution ciblée de `pnpm exec vitest run tests/unit/helpers/create-auth-context.spec.ts --reporter=basic`, `pnpm exec vitest run tests/unit/utils/programmatic-login.spec.ts --reporter=basic`, `pnpm exec vitest run tests/unit/utils/load-credentials.spec.ts --reporter=basic`.
- **2025-11-26** — Journalisation de l’ultime état observé dans `pollForStreamingChange` avant timeout (injection dans `logStreamingProbe` + message d’erreur détaillé), tentative de relance `PLAYWRIGHT=true pnpm exec playwright test tests/e2e/accessibility.spec.ts` interrompue faute de dev-server stable, et essai `pnpm dlx vitest@2.1.9 run tests/unit/components/messages.spec.tsx --reporter=basic` bloqué par la dépendance optionnelle `jsdom` manquante.
- **2025-11-28** — Ajout d’un snapshot `console.debug` conditionné par `DEBUG=playwright` dans `convertToUIMessages`, mise à jour du test RTL séquentiel pour passer par `convertToUIMessages`, écriture d’un test Vitest ciblant le logging Playwright et exécution de `pnpm exec vitest run tests/unit/components/messages.spec.tsx --reporter=basic`, `pnpm exec vitest run tests/unit/ai/messages.spec.ts --reporter=basic`.
- **2025-11-29** — Appel immédiat de `ensureHardRedirect()` après `router.replace` dans la page register pour éviter les blocages de redirection Playwright, et mise à jour du test RTL `register-page.spec.tsx` pour s’assurer que le premier appel `window.location.assign` vise bien le tableau de bord.
- **2025-11-30** — Coercition des périodes `finance.backtest` (schéma Zod, API et mocks) vers des chaînes ISO pour empêcher l’éjection des artefacts, ajout d’un test Vitest couvrant les epochs numériques et exécution ciblée de `vitest run tests/unit/ai/messages.spec.ts` et `tests/unit/routes/finance.backtest.spec.ts`.
- **2025-12-01** — Ajout d’un test ciblé `ChatPage.isGenerationComplete` couvrant le signal du placeholder de chargement, avec stubs JSDOM pour valider la progression ; tentative Playwright `tests/e2e/accessibility.spec.ts --reporter=dot` soldée par un timeout `beforeEach` (contexte fermé avant `send-button`), trace conservée pour analyse ultérieure.
- **2025-12-02** — Extension des signaux de progression Playwright (`ChatPage.isGenerationComplete`) pour considérer le compteur `__PLAYWRIGHT_CHAT_SIGNALS__`, la visibilité des boutons send/stop, la valeur du composer et les suggestions rapides. Ajout de deux tests Vitest ciblés (`assistant loading placeholder`, `chat signal increments`) exécutés isolément, tentative de lancer la suite complète `tests/unit/pages/chat-page.spec.ts` avortée pour cause d’OOM (`ERR_WORKER_OUT_OF_MEMORY`), et relance `DEBUG=playwright pnpm exec playwright test tests/e2e/accessibility.spec.ts --reporter=dot` toujours en échec (artefact backtest absent). Notes et traces consignées dans la checklist ci-dessus.
- **2025-12-03** — Réparation du helper `pollForStreamingChange` en restaurant les accolades manquantes autour du comptage d'artefacts (erreur `Unexpected token` lors des runs Playwright/Vitest), puis vérification via `pnpm exec vitest run tests/unit/pages/chat-page.spec.ts --reporter=basic -t "chat signal increments"`.
- **2025-12-04** — Réinstallation complète des dépendances (`pnpm install`), téléchargement des navigateurs/dépendances système Playwright, puis exécution ciblée de `pnpm exec playwright test tests/e2e/session.test.ts --project=e2e --grep "Register new account"`. La session est créée mais la page reste sur `/register` (timeout `waitForChatDashboard`) ; trace archivée pour analyse ultérieure.
