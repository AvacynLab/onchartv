# Agent Brief — reset 2025-12-12

## Context
The most recent `pnpm e2e` run (2025-12-12) now passes the baseline chat send but still reports three blocking flows:
- **Chat activity › Edit user message and resubmit** – the assistant reply never updates after editing; the DOM continues to show the pre-edit "green" answer.
- **Finance end-to-end journeys › streams a BTCUSD chart and exposes interactive controls** – the finance conversation never surfaces an assistant bubble (`data-testid="message-assistant"` count stays at 0).
- **Login and Registration › Register new account** – after registration the dashboard loads without a visible composer, so the poll for `.prompt-composer` times out.

Other finance and reasoning paths are currently green, so effort should focus on restoring assistant rendering in tool-heavy chats and keeping the composer visible for fresh accounts.

## Objectives
- Ensure assistant messages persist (and render) after finance tool execution so Playwright can observe chart replies.
- Make standard chat edits emit a refreshed assistant response while preserving the existing reasoning success case.
- Guarantee new registrations always land on a chat with a visible composer, even if the session refresh lags.
- Keep recently added diagnostics intact to speed up further Playwright debugging.

## Task Checklist

### 1. Finance assistant bubble regression
- [ ] Re-run the focused Playwright spec once browsers/deps are installed: `pnpm exec playwright test tests/e2e/finance.spec.ts -g "streams a BTCUSD chart"`.
- [ ] Inspect `ChatPage.waitForUiStreamingFallback` logs and the stream debug snapshots to confirm whether assistant messages remain in state during finance tool runs.
- [ ] Audit `lib/ai/providers.ts` and downstream reducers to ensure tool completions append an assistant turn (rather than only tool artifacts).
- [ ] Add unit coverage around the finance mock/tool transcript to guarantee an assistant summary is emitted after the chart data resolves.
- [ ] Re-run the focused Playwright test and archive the passing trace.

### 2. Chat edit/resubmit (standard conversations)
- [ ] Use the stream debug output to verify the message statuses transition from `streaming` to `complete` after an edit-triggered resend.
- [ ] Confirm `resolveLatestRelevantMessage` (or equivalent helper) selects the edited user turn before invoking the provider.
- [ ] Add Vitest coverage that simulates editing a message followed by a provider response lacking explicit status metadata.
- [ ] Re-run `pnpm exec playwright test tests/e2e/chat.test.ts -g "Edit user message and resubmit"` and capture the passing trace.

### 3. Registration composer visibility
- [ ] Trace the post-registration redirect to ensure a chat id is present in both the URL and client-side state.
- [ ] Update the client onboarding hook/page so the composer renders while session validation is pending.
- [ ] Extend unit or integration tests to assert the composer is visible immediately after a successful registration.
- [ ] Re-run `pnpm exec playwright test tests/e2e/session.test.ts -g "Register new account"` and inspect the trace for composer presence.

### 4. Playwright readiness & diagnostics
- [ ] Install Playwright browsers and (if allowed) `playwright install-deps` so local reruns no longer skip due to missing binaries.
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
