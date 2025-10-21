# Agent Brief — reset 2025-12-12

## Context
- 2025-12-12 focused e2e run: baseline chat send is now green but three flows still fail (edit/resubmit, finance chart bubble, post-registration composer).
- 2025-12-13 audit: repository contains extensive Playwright-oriented diagnostics (`logPlaywrightStreamDebug`, identifier synthesis) layered on top of the chat surface. They help debugging but increased complexity and scattered side effects make the baseline harder to reason about.
- Several helpers (`prepareNormalisedMessageUpdate`, `deriveAssistantMessageStatus`, debug effects in `components/chat.tsx` and `components/messages.tsx`) were added quickly; they need structure, documentation, and tests that reflect intended responsibilities without altering existing behaviour.
- Optional runtime dependencies (`@tanstack/react-query`, `lightweight-charts`) are required for local Playwright + Next dev server runs; keep them documented so future agents avoid missing-module failures when triaging locally.

## Objectives
- Ensure assistant messages persist (and render) after finance tool execution so Playwright can observe chart replies.
- Make standard chat edits emit a refreshed assistant response while preserving the existing reasoning success case.
- Guarantee new registrations always land on a chat with a visible composer, even if the session refresh lags.
- Keep recently added diagnostics intact to speed up further Playwright debugging.

## Task Checklist

### 0. Baseline cleanup (no logic change)
- [x] Extract the Playwright stream diagnostics in `components/chat.tsx` into a dedicated utility/hook so the main render path stays readable while preserving current logging behaviour.
- [x] Co-locate identifier normalisation (`prepareNormalisedMessageUpdate`) with its state updates or document why the effect runs on every message array change; ensure the helper surfaces typed results without leaking mutable references.
- [x] Review `components/messages.tsx` finance artefact parsing and warning logic; centralise repeated warning payloads and confirm logs remain behind the existing safeguards.
- [x] Document `lib/chat/message-identifiers.ts` and `lib/chat/message-status.ts` (JSDoc + README blurb) to clarify intent and expected usage; ensure tests mirror that contract.
- [x] Inventory optional runtime dependencies (Playwright browsers, `@tanstack/react-query`, `lightweight-charts`) in developer docs so local debugging does not stall on missing modules.

### 1. Finance assistant bubble regression
- [x] Re-run the focused Playwright spec once browsers/deps are installed: `pnpm exec playwright test tests/e2e/finance.spec.ts -g "streams a BTCUSD chart"`.
- [x] Inspect `ChatPage.waitForUiStreamingFallback` logs and the stream debug snapshots to confirm whether assistant messages remain in state during finance tool runs.
- [x] Audit `lib/ai/providers.ts` and downstream reducers to ensure tool completions append an assistant turn (rather than only tool artifacts).
- [x] Add unit coverage around the finance mock/tool transcript to guarantee an assistant summary is emitted after the chart data resolves.
- [ ] Re-run the focused Playwright test and archive the passing trace.

### 2. Chat edit/resubmit (standard conversations)
- [x] Use the stream debug output to verify the message statuses transition from `streaming` to `complete` after an edit-triggered resend.
- [ ] Confirm `resolveLatestRelevantMessage` (or equivalent helper) selects the edited user turn before invoking the provider.
- [ ] Add Vitest coverage that simulates editing a message followed by a provider response lacking explicit status metadata.
- [ ] Re-run `pnpm exec playwright test tests/e2e/chat.test.ts -g "Edit user message and resubmit"` and capture the passing trace.

### 3. Registration composer visibility
- [ ] Trace the post-registration redirect to ensure a chat id is present in both the URL and client-side state.
- [ ] Update the client onboarding hook/page so the composer renders while session validation is pending.
- [ ] Extend unit or integration tests to assert the composer is visible immediately after a successful registration.
- [ ] Re-run `pnpm exec playwright test tests/e2e/session.test.ts -g "Register new account"` and inspect the trace for composer presence.

### 4. Playwright readiness & diagnostics
- [x] Install Playwright browsers and (if allowed) `playwright install-deps` so local reruns no longer skip due to missing binaries.
- [ ] Keep `PLAYWRIGHT_STREAM_DEBUG=1` available for targeted runs and clean up logging once the regressions are fixed.

## Validation Matrix
Run these once the fixes above are complete:
1. `pnpm exec vitest run tests/unit/ai/providers.spec.ts tests/unit/components/chat.spec.tsx`
2. `pnpm exec playwright test tests/e2e/chat.test.ts -g "Edit user message and resubmit"`
3. `pnpm exec playwright test tests/e2e/finance.spec.ts -g "streams a BTCUSD chart"`
4. `pnpm exec playwright test tests/e2e/session.test.ts -g "Register new account"`
5. `pnpm e2e`

## Handoff Notes
- Keep `DEBUG=playwright` handy; failing traces live in `playwright-results/` with descriptive names.
- Finance traces without assistant bubbles: `playwright-results/e2e-finance-Finance-end-to-2ebe4-xposes-interactive-controls-e2e/`.
- Edit-resubmit traces capturing the stale "green" reply: `playwright-results/e2e-chat-Chat-activity-Edit-user-message-and-resubmit-e2e/`.
- Registration traces where the composer stays hidden: `playwright-results/e2e-session-Login-and-Registration-Register-new-account-e2e/`.
- 2025-12-12 — Baseline send now succeeds; outstanding work is limited to finance assistant rendering, standard edit refreshes, and registration composer visibility. Diagnostics for message ids/status remain in place.
---
- 2025-12-13 — Performed repo-wide audit without code changes; outlined baseline cleanup tasks (diagnostics extraction, identifier helper documentation, optional dependency inventory) and confirmed outstanding Playwright failures remain unchanged pending future implementation.
- 2025-12-14 — Extracted the chat Playwright diagnostics into `lib/chat/playwright-stream-debug.ts`, centralised message warnings, documented the identifier/status helpers (with a new `lib/chat/README.md`), and added focused Vitest coverage. Finance/chat/reg registration e2e fixes remain outstanding along with the identifier effect co-location.
- 2025-12-15 — Wrapped identifier normalisation in `useNormaliseChatMessages`, updated `components/chat.tsx` to consume the hook (keeping diagnostics in the callback), documented the new helper, and added targeted jsdom-based tests under `tests/unit/components/use-normalised-chat-messages.spec.tsx`. Focus now shifts to the remaining Playwright regressions.
- 2025-12-16 — Installed Playwright browsers (`pnpm exec playwright install --with-deps chromium`), re-ran the focused finance spec with `PLAYWRIGHT_STREAM_DEBUG=1`, and confirmed via stream diagnostics that assistant bubbles never materialise while the provider still emits the finance summary when invoked directly. Next step: add unit coverage around the finance tool transcript and diagnose why the UI stops before rendering the assistant reply.
- 2025-12-17 — Added a Vitest case exercising the finance chart tool-result transcript to confirm the inline mock streams the expected assistant summary, and ran `pnpm dlx vitest@2.1.9 run tests/unit/ai/providers.spec.ts --coverage=false` to verify.
- 2025-12-18 — Tightened the `useNormaliseChatMessages` identifier patch guard after TypeScript flagged the readonly union; build now fails only on missing optional runtime dependencies (`lightweight-charts`, `@tanstack/react-query`).
- 2025-12-19 — Emitted per-message status transitions through `useChatPlaywrightStreamDebug`, added targeted Vitest coverage for the new diagnostics, and reran the focused chat debug suite alongside a clean Next.js build to confirm TypeScript compatibility.
