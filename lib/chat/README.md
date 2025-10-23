# Chat utilities

This directory hosts framework-agnostic helpers that keep the chat surface
stable while the AI SDK streams responses.

- **`message-identifiers.ts`** normalises the `id` field emitted by streamed
  messages.  When the SDK omits an identifier we synthesise a deterministic
  fallback so Playwright, votes, and inline edits continue to target the correct
  bubble.
- **`message-status.ts`** derives assistant lifecycle attributes (for example
  `streaming` versus `completed`) without tying the logic to React. The helpers
  are pure functions which keeps the unit tests lightweight.
- **`playwright-stream-debug.ts`** centralises the diagnostics emitted during
  Playwright runs. Components can reuse the exported hook to surface status
  transitions and message summaries without embedding logging concerns in the
  render tree.
- **`use-normalised-chat-messages.ts`** wraps the identifier normalisation into
  a React hook so state updates and diagnostics remain co-located. The helper
  keeps message arrays stable for votes, edits, and Playwright without forcing
  components to reimplement the `useEffect` scaffolding.

All helpers are covered by focused Vitest suites. When adding new utilities,
update this document and favour pure functions so diagnostics remain easy to
exercise outside of React.
