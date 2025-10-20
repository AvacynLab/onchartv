# Agent Brief — reset 2025-12-08

## Context
The latest `pnpm e2e` run (2025-12-08) failed on three flows:
- **Chat activity › Edit user message and resubmit** — Playwright timed out while waiting for the chat UI to resume streaming after an edit.
- **chat activity with reasoning › Curie can edit message and resubmit** — The polling assertion still captured the original assistant reply instead of the post-edit response.
- **Login and Registration › Register new account** — After successful registration, the dashboard never presented a visible chat composer.

All other suites (unit, integration, finance accessibility) now pass with the current code base.

## Objectives
- Restore deterministic streaming behaviour after editing chat messages for both standard and reasoning conversations.
- Ensure the reasoning transcript helpers observe the refreshed assistant output after an edit.
- Guarantee that a newly registered account lands on an interactive chat (composer visible, chat id present).
- Keep the Playwright auth warm-up and storage state reuse intact while iterating on the fixes above.

## Task Checklist

### 1. Chat edit/resubmit streaming
- [ ] Audit `tests/pages/chat.ts` (`waitForUiStreamingFallback`, `pollForStreamingChange`) to identify why edited prompts never transition back to `streaming`.
- [ ] Inspect the client components (`components/chat.tsx`, `components/message.tsx`) for race conditions around `data-message-status` updates when the same message id is reused.
- [ ] Update the streaming detection logic so edited messages reliably trigger a new `streaming` status, even when tool responses precede them.
- [ ] Cover the fix with Vitest (jsdom) tests that simulate edit→resubmit and assert the DOM status transitions.
- [ ] Re-run `pnpm exec playwright test tests/e2e/chat.test.ts -g "Edit user message and resubmit"` and archive the trace on success.

### 2. Reasoning edit/resubmit expectations
- [ ] Confirm how `ChatPage.getRecentAssistantMessage` filters reasoning turns and adjust it to fetch the latest assistant content after edits.
- [ ] Align the reasoning mock provider (if applicable) so that re-issued prompts return updated reasoning steps plus the final answer.
- [ ] Extend `tests/e2e/reasoning.test.ts` with stronger polling (or helper assertions) that validate the message actually changes.
- [ ] Re-run `pnpm exec playwright test tests/e2e/reasoning.test.ts -g "Curie can edit message and resubmit"` to validate.

### 3. Registration composer visibility
- [ ] Instrument the registration action/page to log the redirect target and the created chat id when running under `PLAYWRIGHT=true`.
- [ ] Ensure the server-side registration flow creates or fetches a chat and returns a redirect to `/chat/:id`.
- [ ] Update the client-side onboarding hook so the composer mounts even if the session refresh is still in flight.
- [ ] Add coverage (unit or integration) proving a freshly registered user sees an enabled composer.
- [ ] Re-run `pnpm exec playwright test tests/e2e/session.test.ts -g "Register new account"` and inspect the trace for the composer state.

## Validation Matrix
Run the following once all fixes are applied:
1. `pnpm exec vitest run tests/unit/ai/providers.spec.ts tests/unit/pages/chat-page.spec.ts`
2. `pnpm exec playwright test tests/e2e/chat.test.ts -g "Edit user message and resubmit"`
3. `pnpm exec playwright test tests/e2e/reasoning.test.ts -g "Curie can edit message and resubmit"`
4. `pnpm exec playwright test tests/e2e/session.test.ts -g "Register new account"`
5. `pnpm e2e`

## Handoff Notes
- Keep `DEBUG=playwright` handy for additional instrumentation; traces from the failing runs live under `playwright-results/` with matching names.
- Avoid modifying the Playwright storage state schema unless necessary; current runs regenerate credentials when missing.
- Document any new instrumentation directly in the relevant module comments so future agents can disable it cleanly.
