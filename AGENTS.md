# Agent Brief — reset 2025-12-09

## Context
The latest `pnpm e2e` run (2025-12-09) exposed two blocking regressions in addition to the previously failing edit flows:
- **Chat activity › Send a user message and receive response** — No assistant messages ever appear (`data-testid="message-assistant"` count remains 0), so even the first chat send stalls.
- **chat activity with reasoning › Curie can edit message and resubmit** — The polling assertion still captures the pre-edit assistant reply instead of the refreshed answer.

Accessibility, finance, registration, and other chat scenarios now pass, so the remaining scope is focused on restoring assistant message rendering and edit resiliency.

## Objectives
- Restore deterministic streaming behaviour after editing chat messages for both standard and reasoning conversations.
- Ensure the reasoning transcript helpers observe the refreshed assistant output after an edit.
- Guarantee that a newly registered account lands on an interactive chat (composer visible, chat id present).
- Keep the Playwright auth warm-up and storage state reuse intact while iterating on the fixes above.

## Task Checklist

### 1. Assistant message regression (baseline send fails)
- [ ] Reproduce the missing assistant bubble locally (focus the "Send a user message and receive response" test) and inspect the DOM to confirm whether the assistant block fails to mount or is immediately removed.
- [ ] Trace the message rendering pipeline (`components/messages.tsx`, `lib/chat/message-status.ts`, `lib/ai/providers.ts`) to ensure assistant messages remain in the array after edits and that status derivation does not filter them out.
- [ ] Add unit coverage (ideally in `tests/unit/components/message*.spec.tsx`) that asserts assistant messages render when the provider returns a response without a `status` field.
- [ ] Run `pnpm exec playwright test tests/e2e/chat.test.ts -g "Send a user message and receive response"` and keep the passing trace for reference.

### 2. Chat edit/resubmit streaming
- [ ] Verify that whatever fix restores baseline assistant rendering also re-enables the edit flow; if not, instrument `ChatPage.waitForUiStreamingFallback` to log the message ids and statuses it observes.
- [ ] Ensure the updated message state triggers a `streaming → complete` transition on edits, updating both helper logic and component props as needed.
- [ ] Extend the existing Vitest coverage to include an edit scenario where the assistant response arrives without explicit status flags.
- [ ] Re-run `pnpm exec playwright test tests/e2e/chat.test.ts -g "Edit user message and resubmit"` and archive the trace on success.

### 3. Reasoning edit/resubmit expectations
- [ ] Confirm how `ChatPage.getRecentAssistantMessage` filters reasoning turns and adjust it to fetch the latest assistant content after edits.
- [x] Align the reasoning mock provider (if applicable) so that re-issued prompts return updated reasoning steps plus the final answer.
- [ ] Extend `tests/e2e/reasoning.test.ts` with stronger polling (or helper assertions) that validate the message actually changes.
- [ ] Re-run `pnpm exec playwright test tests/e2e/reasoning.test.ts -g "Curie can edit message and resubmit"` to validate.

### 4. Registration composer visibility
- [x] Instrument the registration action/page to log the redirect target and the created chat id when running under `PLAYWRIGHT=true`.
- [x] Ensure the server-side registration flow creates or fetches a chat and returns a redirect to `/chat/:id`.
- [ ] Update the client-side onboarding hook so the composer mounts even if the session refresh is still in flight.
- [x] Add coverage (unit or integration) proving a freshly registered user sees an enabled composer.
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
- 2025-12-08 — Introduced `lib/ai/prompt-helpers.ts` so both the inline mocks and the production provider select the freshest user/tool prompt, and updated `tests/prompts/utils.spec.ts`/`tests/unit/ai/providers.spec.ts` accordingly. Registration flow now logs seeded chat ids under Playwright and prefers the seeded redirect over the generic `/chat` fallback; added unit coverage for both success branches. Targeted Vitest suites pass (`ai/providers`, prompts, auth actions) but `tests/unit/pages/chat-page.spec.ts` repeatedly exhausted the container (SIGKILL) and the focused Playwright edit test still stalls with zero assistant messages; traces saved under `playwright-results/e2e-chat-Chat-activity-Edit-user-message-and-resubmit-e2e/` for investigation.
- 2025-12-09 — Added `lib/chat/message-status.ts` to derive deterministic assistant statuses and rewired `components/messages.tsx` to consume it so inline edits always surface a `streaming` flag. Introduced `tests/unit/components/messages.status.spec.ts` to cover the fallback logic. Targeted edit Playwright run still times out because no assistant bubble ever reattaches (`message-assistant` count stays at 0); inspect the latest trace under `playwright-results/e2e-chat-Chat-activity-Edit-user-message-and-resubmit-e2e/` for DOM + network clues.
- 2025-12-10 — Latest full `pnpm e2e` run shows baseline chat send now fails (no assistant messages rendered) while the reasoning edit resubmit still returns the pre-edit answer. Accessibility and registration flows pass. Focus next steps on restoring assistant message rendering and updating reasoning polling once baseline chat behaviour is recovered. Relevant traces: `playwright-results/e2e-chat-Chat-activity-Sen-83c51-essage-and-receive-response-e2e/` and `playwright-results/e2e-reasoning-chat-activit-c5759-n-edit-message-and-resubmit-e2e/`.
