---------- 
Voici ta **liste d’actions exhaustive** (à toi, l’agent) fondée sur **la version actuelle du code**, **les traces Playwright** et **la boilerplate**. L’objectif est de **rendre verts tous les tests e2e**, d’**éliminer l’exception client** qui déclenche l’overlay Next.js, et d’**aligner l’auth/UX** avec le comportement attendu par les suites de tests (boilerplate vs repo).

---

## BRIEF — Objectifs & correctifs attendus

**Objectifs**

* Tu stabilises le **rendu client** dans le chat et les artefacts finance pour **supprimer l’overlay Next** (“Application error: a client-side exception…”).
* Tu **alignes le flux d’authentification** (guest vs regular) entre code et tests : **choisir** un mode et **rendre les tests cohérents**.
* Tu garantis des tests **offline**, **déterministes**, **non-flaky** : mocks réseau, horloge gelée, rate-limit bypass en e2e.
* Tu ajoutes une **protection UX** : error boundary au segment `(chat)` pour éviter que la page entière tombe à la moindre erreur.

**Correctifs majeurs (synthèse)**

1. **Exception client** au rendu du chat/artefacts → durcir null-checks + cycle de vie du chart + safe data mapping + error boundary `(chat)`.
2. **Auth divergente** vs boilerplate → **Option A** (restaurer guest comme la boilerplate) **ou** **Option B** (conserver regular et adapter tests/setup & routes).
3. **E2E** → garantir l’état d’auth connu, les mocks `/api/finance/*`, et un **bypass rate-limit** en e2e.
4. **Docs & disclaimers** → clarifier l’absence de conseil financier.

**Règles tests & build (à respecter)**

* **Node ≥ 20**, `pnpm` stable, `PLAYWRIGHT=true` en CI e2e, `FEATURE_FINANCE=true` pour activer le scope finance.
* **Aucun appel réseau externe** en tests (tout mocké).
* **Horloge gelée** en e2e finance pour assurer des assertions datées stables.
* **Migrations & seed** avant build/tests; migrations **idempotentes**.
* **Rate-limit** **bypass** en e2e pour éviter les 429.
* **CI** : dev server Playwright prêt, healthchecks stables, coverage rapporté.

---

## TO-DO LIST À COCHER — fichier par fichier (avec sous-étapes)

### 1) Supprimer l’exception client (overlay Next) sur le chat/finance

* [x] **Créer un error boundary pour le segment chat**

  * [x] **`app/(chat)/error.tsx`**

    * [x] Afficher un fallback lisible (titre, message générique, bouton *“Réessayer”*).
    * [x] Logguer `error` (console + `reportError` si présent).
    * [x] **Tests** : ajouter un test unitaire qui monte le boundary avec un enfant qui jette une erreur et vérifie le fallback.

* [x] **Rendre le composant Chart robuste au cycle de vie**

  * [x] **`components/finance/finance-chart-artifact.tsx`**

    * [x] Encadrer la création du chart : **ne créer qu’une fois** quand le conteneur est présent et visible.

      * [x] `useRef` pour stocker l’instance.
      * [x] Ignorer les re-montages inutiles (guard si déjà créé).
    * [x] **Null-checks** forts sur les données OHLCV et overlays avant tout accès (tooltip/détails).
    * [x] Unregister proprement les subscriptions `subscribeClick` / `subscribeCrosshairMove` au `useEffect` cleanup.
    * [x] Protéger contre les séries vides : si `ohlcv.length === 0`, afficher un *empty state* et **ne pas** initialiser les séries.
    * [x] **Tests unitaires** :

      * [x] snapshot rendu vide (pas d’ohlcv).
      * [x] simulation clic/hover avec data minimale (mock chart) → **aucune exception**.
      * [x] montage/démontage consécutifs → pas de double initialisation.

* [x] **Messages & Chat : durcir le rendu défensif**

  * [x] **`components/messages.tsx`**

    * [x] Toujours gérer `messages` potentiellement `undefined`/vide (`(messages ?? []).map(...)`).
    * [x] Pour chaque message, vérifier `artifacts` avant de les rendre.
    * [x] Sur artefact inconnu/malfomé → fallback visuel (et **pas** de `throw`).
    * [x] **Tests** : unitaires sur rendu avec messages vides/malfomés.
  * [x] **`components/chat.tsx`**

    * [x] Vérifier les zones susceptibles de throw (lignes ~210 dans traces) :

      * [x] Guards autour des accès context/state, surtout pendant streaming.
      * [x] Pas d’accès direct à des refs non montées.
    * [x] **Tests** : montez `Chat` avec store minimal/mock; envoyez un message → pas d’exception.

---

### 2) Aligner le flux d’auth (boilerplate vs repo) — **choisir A ou B**

> Tu dois **choisir une option** et l’appliquer **partout** (code + tests). Mélanger A et B casse les suites.

#### Option A — **Revenir au flux invité** (conforme boilerplate)

> **Non retenu.** Nous avons confirmé l’option B (utilisateur "regular" uniquement) comme flux de référence. Les items ci-dessous
> restent documentés pour mémoire mais ne sont **pas** à mettre en œuvre tant que l’option B est active.

* ~~`app/(chat)/page.tsx` : rediriger les sessions absentes vers `/api/auth/guest`~~
* ~~`app/(chat)/api/chat/route.ts` : autoriser les invités ou contour PLAYWRIGHT~~
* ~~`app/(auth)/api/auth/guest/route.ts` : rendre `redirectUrl` optionnel~~
* ~~`tests/setup/auth.setup.ts` : basculer la préparation Playwright sur le parcours invité~~
* ~~E2E : aligner les assertions sur un compte invité~~

#### Option B — **Conserver le flux “regular only”** (repo actuel)

* [x] **`app/(chat)/page.tsx`**

  * [x] Garder la redirection vers `/login` pour les non-regular.
* [x] **`app/(chat)/api/chat/route.ts`**

  * [x] Conserver la vérification `user.type === "regular"`.
* [x] **`tests/setup/auth.setup.ts`**

  * [x] **Garantir** qu’en setup e2e on **enregistre** un user **regular** et on stocke l’auth state (c’est déjà le cas dans ton repo, revalider les sélecteurs de formulaire / URLs).
  * [x] Vérifier que **toutes** les suites e2e qui naviguent vers `/chat` sont précédées de ce login (via storage state Playwright).
* [x] **Routes “guest” héritées des tests boilerplate**

  * [x] Localiser les tests qui invoquent `/api/auth/guest` et les **mettre à jour** pour **regular** ou ajouter `redirectUrl` obligatoire.

> **Recommandation** : Option **B** (regular only) est plus sûre pour le produit; l’**alignement des tests** est un effort ponctuel mais durable.

---

### 3) Playwright — fiabiliser l’environnement de test

* [x] **Rate-limit bypass** en e2e

  * [x] **`lib/ratelimit.ts`**

    * [x] Si `process.env.PLAYWRIGHT === 'true'` → **désactiver** le throttling ou le multiplier par 100.
    * [x] **Tests** (routes unit) : s’assurer que le rate-limit reste actif hors e2e.

* [x] **Mocks réseau** (déjà présents mais durcir)

  * [x] **`tests/e2e/finance.spec.ts`**

    * [x] Confirmer l’interception de **toutes** les routes `/api/finance/*` avec fixtures stables (mêmes champs/type que l’UI consomme).
    * [x] **Geler l’horloge** (déjà présent) et éviter tout `Date.now()` non mocké côté composant (si nécessaire passer par un util injecté).
  * [x] **`tests/pages/chat.ts`**

    * [x] S’assurer que les actions (send/edit/vote/upload) n’attendent **aucune** ressource externe.

* [x] **Stabiliser les sélecteurs**

  * [x] Vérifier/ajouter `data-testid` pour les éléments visés en e2e :

    * [x] `finance-chart-artifact`, `finance-chart-details`, toggles SMA/EMA, boutons de re-test backtest.
    * [x] Si un overlay/skeleton passe par là, attendre un **état stable** (par ex. `await expect(locator).toBeVisible()` après disparition d’un spinner).
  * [x] **`components/finance/*`**

    * [x] Vérifier présence des `data-testid` déjà utilisés par `tests/e2e/finance.spec.ts` (ils existent → réutiliser tel quel).
  * [x] **`tests/e2e/accessibility.spec.ts`**

    * [x] Adapter le test pour **ignorer** les overlays de debug s’ils s’affichent encore (mais normalement l’error boundary évite l’overlay Next).

* [x] **Dev server & overlay**

  * [x] Dans `playwright.config.ts`, conserver le dev server; l’overlay Next ne **doit plus apparaître** une fois l’exception corrigée.
  * [x] **Ne pas masquer** l’overlay; le corriger à la source.

---

### 4) API Finance & artefacts — finitions de robustesse

* [x] **Erreurs unifiées**

* [x] **`app/api/finance/*/route.ts`**

    * [x] Toujours retourner `{ error: { code, message } }` + HTTP code cohérent.
    * [x] Ajouter tests de routes pour codes d’erreur (invalid input, out-of-range).
* [x] **Limites & validations**

* [x] `history/route.ts` : cap `limit` (ex. 5k), normaliser `from/to` (fuseau), refuser `timeframe` non supporté.
  * [x] **Tests unit** : inputs invalides → 400 avec message lisible.
* [x] **Artefacts cohérents**

  * [x] **`components/ArtifactRenderer.tsx`**

    * [x] Fallback si `payload.type` inconnu (message + log, pas d’exception).
  * [x] **`components/finance/backtest-report-artifact.tsx`**

    * [x] A11y tableau trades (pagination, `aria-*`).
    * [x] Si `metrics` manquants → placeholder visible (pas de throw).

---

### 5) Backtest & indicateurs — cas limites

* [x] **`lib/finance/backtest/engine.ts`**

  * [x] Gérer **zéro trade** proprement (`winRate=0`, `profitFactor=0`, `maxDrawdown` calculé sur `equityCurve` plat).
  * [x] Paramétrer **fees** et **slippage** (déjà là) mais tester explicitement : fees élevés, slippage > 0.
* [x] **`lib/finance/indicators.ts`**

  * [x] **RSI/EMA** : bornes strictes, séries constantes, séries courtes (< window).
* [x] **`lib/finance/patterns.ts`**

  * [x] Non-détection sur bruit aléatoire; détection stable sur fixtures connues (hammer/engulfing).
* [x] **Tests unit** correspondants (complément à ceux déjà présents).

---

### 6) Auth — cohérence bout-en-bout selon l’option choisie

* [ ] **Option A (guest)**

  * [ ] **`app/(auth)/api/auth/guest/route.ts`** : rendre `redirectUrl` optionnel; défaut `/chat`.
  * [ ] **`tests/setup/auth.setup.ts`** : ajuster pour **ne pas** surcharger en *register* si guest suffit.
* [x] **Option B (regular)**

  * [x] **`tests/setup/auth.setup.ts`** : valider que le **formulaire register/login** correspond aux sélecteurs; attendre la redirection effective vers `/chat`.
  * [x] **Routes** : toute route e2e qui suppose guest doit être modifiée pour session regular.
  * [x] **`app/(chat)/api/chat/route.ts`** : renvoyer **403** formaté et gérer côté UI (toast “session requise”), **sans throw**.

---

### 7) Documentation & disclaimers

* [x] **`README.md`**

  * [x] Ajouter **disclaimer** : “Ce projet n’est **pas** un conseil financier”.
  * [x] Documenter : mocks e2e, variables `.env`, usage `PLAYWRIGHT=true`, `FEATURE_FINANCE=true`.
  * [x] Section **“Résolution des tests e2e”** : expliquer l’option auth retenue (A ou B) et comment les tests s’y appuient.
* [x] **`docs/finance/api.md`**

  * [x] Mettre à jour exemples d’artefacts (clés métriques **exactes** : `maxDrawdown`, pas `maxDD`).
  * [x] Préciser limites/pagination et shape d’erreurs.

---

### 8) CI — durcissements

* [x] **`.github/workflows/ci.yml`**
  * [x] Exporter `PLAYWRIGHT: "true"`, `FEATURE_FINANCE: "true"`.
  * [x] Ordre : `db:migrate` → `db:seed` → `build` → `test` (unit) → `e2e`.
  * [x] Publier **coverage** vitest + rapport Playwright.
  * [x] Timeout ample pour le dev server (démarrage Next + tests e2e).
* [x] **`package.json`**

  * [x] Ajouter `"engines": { "node": ">=20.10" }` pour verrouiller la version Node en CI.

---

### 9) Nettoyage & garde-fous

* [x] **Logs** : s’assurer que les logs de routes/API n’exposent **aucun secret**.
* [x] **Feature flags** : `FEATURE_FINANCE` effectivement testé dans les composants qui conditionnent l’affichage.
* [x] **Types** : éviter `any` dans les payloads d’artefacts; conserver Zod pour I/O et inférer les types TS.

---

## Contrôles de validation (post-correctifs)

* [ ] **Local** : lancer `pnpm dev`, naviguer `/chat`, envoyer “Montre BTCUSD 1D avec SMA(50/200)” → **aucun overlay**, chart interactif OK (clic/hover).
* [x] **Unit** : `pnpm test` verts, coverage stable.
* [ ] **E2E** :

* [x] `tests/e2e/finance.spec.ts` → **vert** (4 scénarios).
  * [x] `tests/e2e/accessibility.spec.ts` → **vert** (pas d’overlay).
* [x] Traces Playwright : absence d’erreur “Application error: a client-side exception…”.
* [ ] **CI** : pipeline complet vert sur la branche.

---

## Notes utiles tirées des traces

* Erreurs **répétées** : `Application error: a client-side exception...` dans `error-context.md` pour des cas Finance et Chat → priorité à la **robustesse du rendu** (error boundary + null-checks + cycle de vie chart).
* Échecs Chat multipliés (send/edit/vote/upload/suggestions…) probablement dus à l’**auth** (redirect `/login` ou 403 `forbidden:chat`) → **choisir A ou B** et **aligner** routes + tests.
* Pas d’indice d’échec réseau externe en finance (les tests interceptent déjà) → l’overlay est bien **l’origine** des échecs finance.
* Le scénario principal du chat passe désormais avec le helper `waitForChatApiResponse` basé sur les événements `response`/`requestfailed`; il reste à exécuter la suite complète (votes, upload, stop) pour valider l’ensemble du fichier `chat.test.ts`.

---

### Fin de transmission, agent.

Tu as une carte précise, pièce par pièce. Commence par **l’error boundary** et les **null-checks chart/messages**, enchaîne avec **l’option d’auth** (A ou B), puis **stabilise les e2e** (bypass rate-limit + mocks + selectors). Quand tu auras terminé ces blocs, il ne restera que des finitions de confort.

---

## Historique des actions

- **2025-10-02** — Création de l’error boundary du segment `(chat)`, renforcement du composant `finance-chart-artifact` (guards, empty state, nettoyages, tests) et durcissement de `components/messages` avec fallback et suite de tests dédiée.
- **2025-10-03** — Durcissement de `components/chat.tsx` (guards streaming, normalisation des messages, sécurisation history) avec import React et nettoyage montage, ajout des tests unitaires `chat.spec.tsx` et compatibilité `chat-composer-context` pour le rendu de test.
- **2025-10-04** — Alignement sur l’option d’auth "regular only" (redirections middleware/share, setup Playwright ajusté, tests e2e share revus) et ajout du bypass rate-limit conditionnel à PLAYWRIGHT avec sa batterie de tests unitaires.
- **2025-10-05** — Durcissement du composant `finance/backtest-report-artifact` (fallback metrics, pagination aria-live/controls, gardes runtime) et extension de la suite de tests `backtest-report-artifact.spec.tsx` pour couvrir les cas dégénérés.
- **2025-10-06** — Factorisation du contrôle d’accès chat via `lib/chat/authorization`, alignement des réponses 401/403 dans `app/(chat)/api/chat/route.ts`, ajout des tests unitaires associés, mise à jour du README (section e2e regular) et rafraîchissement complet de `docs/finance/api.md` pour refléter les payloads actuels.
- **2025-10-07** — Validation stricte des paramètres `limit` sur `finance/history` et `finance/news`, enrichissement des tests de routes (bornes, formats invalides, ordres de dates) et durcissement de la suite backtest pour couvrir timeframes et fenêtres incorrectes.
- **2025-10-08** — Normalisation des métriques du moteur de backtest pour les scénarios sans trade, clamp RSI pour éviter les dépassements, couverture unitaire dédiée (moteur, indicateurs, patterns) garantissant slippage/commissions et détection stable des chandeliers.
- **2025-10-09** — Stabilisation des e2e finance (journalisation des interceptions, vérification des fixtures via fetch en contexte navigateur), ajout des `data-testid` manquants (overlays, retest) et suppression de l’attente réseau dans les helpers Playwright.
- **2025-10-10** — Ajout d’un module `feature-flags` partagé, bridage des composants UI (suggested actions, renderer, settings, page) quand `FEATURE_FINANCE` est désactivé, exposition du flag côté client et couverture unitaire associée.
- **2025-10-11** — Uniformisation des réponses d’erreur finance, renforcement des tests de routes (news, screen, backtest, préférences) et ajout de suites dédiées pour fundamentals/quote afin de valider le format `{ error: { code, message } }`.
- **2025-10-12** — Synchronisation des flags finance côté CI/Playwright, réordonnancement des artefacts de couverture après l’e2e et extension du timeout du dev server pour absorber les builds froids.
- **2025-10-13** — Typage strict des artefacts et métadonnées (remplacement des `any`, wrappers SWR sûrs), stabilisation de `DocumentPreview` avec mocks ciblés et ajout d’une suite dédiée garantissant les scénarios de rendu simulés.
- **2025-10-14** — Ajout d’un module de logging structuré avec masquage des secrets, migration des routes finance/chat et scripts DB vers ce helper, et couverture unitaire dédiée pour documenter la redaction.
- **2025-10-15** — Assouplissement du warmup Playwright pour tolérer les redirections lentes après inscription et correction du logging `chatId` dans `api/chat` pour éviter les exceptions en e2e (les suites e2e complètes restent à stabiliser).
- **2025-10-16** — Corrigé la régression `assertRegularChatUser` manquante dans `api/chat`, ajouté une suite unitaire `chat.delete.spec.ts` (mocks hermétiques + vérif des réponses 200/403) et relancé `pnpm test` (vert).
- **2025-10-17** — Durci le helper Playwright `isGenerationComplete` (détection des toasts d’erreur et délai de 60s) afin de fiabiliser les parcours finance/chaîne et relancé `pnpm test` (vert).
- **2025-10-18** — Ajout d’une attente explicite sur les réponses `/api/chat` côté helper Playwright afin de surface les statuts HTTP avant le streaming, mise à jour des actions qui émettent un message (input libre, suggestions, édition) et relance de `pnpm test` (vert).
- **2025-10-19** — Étendu le helper Playwright pour reconnaître les variantes `/api/chat` avec query/stream, ajouté la suite unitaire `tests/unit/pages/chat-page.spec.ts` pour documenter le comportement (succès et erreurs) et relancé `pnpm test`.
- **2025-10-20** — Harmonisé la détection Playwright de `shouldFetchTokenlensCatalog` via `isPlaywrightLikeEnvironment`, ajouté la suite unitaire `tests/unit/lib/tokenlens.spec.ts` et archivé l’option invité (Option A) comme non retenue.
- **2025-10-21** — Ajouté `resolveRequestGeolocation` pour éviter les accès réseau du chat en environnement Playwright, remplacé l’appel direct à `geolocation` dans l’API et couvert le helper via `tests/unit/lib/geolocation.spec.ts`.
- **2025-10-22** — Propagé `NEXT_PUBLIC_PLAYWRIGHT` au serveur Playwright pour aligner le bundle client sur le mode hermétique et ajouté un test TokenLens couvrant ce flag.
- **2025-10-23** — Résolu l’erreur « @tanstack/react-query introuvable » en ajoutant le package à `transpilePackages`, réinstallé les dépendances Playwright/Chromium et relancé les tests e2e ciblés (toujours instables, investigations en cours).
- **2025-10-24** — Préparé la capture d’instantanés assistant côté helper Playwright (`tests/pages/chat.ts`) pour les envois, suggestions et éditions, ajouté la couverture associée (`tests/unit/pages/chat-page.spec.ts`) et relancé `pnpm test` (vert). Le run ciblé `chat.test.ts` reste bloqué sur `expect.poll` malgré les nouveaux gardes (`fetch failed ENETUNREACH`).
- **2025-10-25** — Externalisé `streamChatResponse` dans `lib/ai/stream-chat-response`, corrigé l’exécuteur `createUIMessageStream` pour rester `async`, hermétisé la suite `chat.post.fallback.spec.ts` avec des mocks légers et relancé `pnpm test` (vert).
- **2025-10-26** — Enveloppé les interactions clavier du test `finance-chart-artifact` dans `React.act` pour supprimer les avertissements persistants, documenté la raison directement dans le test et relancé `pnpm test` (vert).
- **2025-10-27** — Refactorisé `tests/pages/chat.ts` pour attendre les événements réseau plutôt que la fermeture du flux SSE, mis à jour `tests/unit/pages/chat-page.spec.ts` en conséquence, relancé `pnpm test` (vert) et confirmé que `chat.test.ts:12` passe désormais sans timeout.
- **2025-10-28** — Ajusté la navigation `ChatPage.createNewChat` pour n'attendre que `domcontentloaded` (évite les blocages du dev server Turbopack) et ajouté le test unitaire documentant ce comportement, `pnpm test` vert.
- **2025-10-29** — Renforcé `waitForChatApiResponse` pour réutiliser le snapshot assistant pendant le fallback UI, ajouté une attente explicite sur les changements DOM (stop button, artefacts, spinners) et couvert ces scénarios via `tests/unit/pages/chat-page.spec.ts`. `pnpm test` documente les nouvelles protections.
- **2025-10-30** — Complété le flux hermétique en ajoutant un fallback structuré dans `getResponseChunksByPrompt` (évite les timeouts lorsque le prompt est inconnu) et créé la suite `tests/unit/prompts/utils.spec.ts`. `pnpm test` + `pnpm exec playwright test tests/e2e/chat.test.ts:12` verts.
- **2025-10-31** — Allongé le délai de visibilité du bouton d'arrêt dans `MultimodalInput` (750 ms) pour fiabiliser les interactions e2e "stop" et ajouté la couverture unitaire `multimodal-input.spec.tsx` basée sur des timers factices.
- **2025-11-01** — Sérialisé la suite Playwright `chat.test.ts`, renforcé `ChatPage.isVoteComplete`/`waitForVoteRequest` (grâce au suivi `pendingVoteRequest` et au fallback toast optionnel) avec une nouvelle batterie de tests unitaires, et confirmé que `pnpm exec playwright test tests/e2e/chat.test.ts --project=e2e --retries=0 --reporter=list` passe avec 14 scénarios actifs (2 restants marqués skipped).
- **2025-11-02** — Synchronisé le mock de préférences finance avec l’API réelle pour refléter les bascules Playwright côté serveur, attendu la réactivation via l’UI pour garder les timestamps déterministes, et confirmé que `pnpm exec playwright test tests/e2e/finance.spec.ts --project=e2e --retries=0 --reporter=list` et `pnpm test` sont verts.
- **2025-11-03** — Amplifié la série synthétique AAPL pour générer plusieurs pages de trades, ajouté un test de route garantissant un journal paginé et confirmé que `tests/e2e/accessibility.spec.ts` passe avec le bouton « Suivant » focusable.
- **2025-11-04** — Ajout d’un garde Playwright global (`expectNoApplicationErrorOverlay`) pour détecter les overlays Next côté client et mise à jour de la checklist e2e correspondante.
- **2025-11-05** — Enrichi `expectNoApplicationErrorOverlay` avec une capture d’écran automatique et ajouté la suite unitaire `tests/unit/helpers/expect-no-overlay.spec.ts` pour documenter le comportement en cas d’échec.
- **2025-11-06** — Renforcé le warmup Next.js (`tests/utils/server-warmup.ts`) avec un aperçu tronqué des réponses 500, des journaux de retry contextualisés et la nouvelle suite `tests/unit/utils/server-warmup.spec.ts`.
- **2025-11-07** — Durci `components/messages` (auto-scroll conditionnel, bouton ancré avec `data-testid`) avec une suite de tests élargie, réactivé les scénarios Playwright d’auto-scroll/scroll button dans `tests/e2e/chat.test.ts`, et noté que le scénario "Edit user message" échoue encore sur le fallback streaming.
- **2025-11-08** — Rendu le fallback de streaming côté Playwright tolérant à l’absence de bouton « Stop » (édition inline) en ajustant `waitForUiStreamingFallback` et en mettant à jour la suite `chat-page.spec.ts`; `pnpm test` repasse vert.
- **2025-11-09** — Aligné le provider AI sur la Gateway Vercel (activation via `AI_GATEWAY_API_KEY`/`AI_GATEWAY_URL`), enrichi `providers.spec.ts` pour valider ce chemin et propagé les secrets Gateway au serveur Playwright, avec documentation mise à jour dans le README.
- **2025-11-10** — Rebasculé sur l’utilisation directe d’OpenAI (suppression des dépendances Gateway côté provider/tests/UI/Playwright, mise à jour du README et du log d’erreurs) et relancé `pnpm test` (vert).
- **2025-11-11** — Ajout des variables `OPENAI_BASE_URL`/`OPENAI_ORGANIZATION`/`OPENAI_PROJECT` au provider pour refléter la personnalisation de l’AI SDK, couverture unitaire validant la transmission des options et mise à jour du README.
- **2025-11-12** — Transmis explicitement les secrets OpenAI au serveur Next lancé par Playwright via un helper dédié `collectOpenAIEnvVars`, ajouté la batterie de tests `openai-env.spec.ts` et documenté le comportement dans `playwright.config.ts`.
