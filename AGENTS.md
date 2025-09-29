# Tasks
- [x] Finish authentication implementation (NextAuth credentials + guest access)
- [x] Ensure registration and login flows create/return proper sessions
- [x] Ensure middleware protects authenticated routes while allowing guest share access
- [ ] Add chat UI affordances (edit button with `data-testid`) for user messages *(edit control wired; full chat suite still pending to confirm selectors behave under Playwright)*
- [ ] Run end-to-end tests (`pnpm exec playwright test`) *(targeted Access Control checks keep passing; the serial login suite still takes several minutes even with the hermetic mocks—manual runs confirmed the flows exercise registration/login repeatedly but we still need a full green run to mark this complete.)*
- [x] Install Playwright browsers and system dependencies *(`pnpm exec playwright install chromium` + `pnpm exec playwright install-deps chromium` ensure `@ai-sdk/openai` can load during Next.js boot)*
- [x] Guard TokenLens catalog fetches when Playwright disables network access *(unit coverage added in `tests/unit/tokenlens-offline.test.ts`)*
- [x] Verify sidebar avatar placeholder renders under Playwright *(see `tests/e2e/sidebar-avatar.test.ts`)*
- [ ] Capture authenticated UI screenshot showing avatar placeholder *(blocked: NextAuth credential flow rejects requests from browser_container; see history)*
- [x] Update/add documentation and comments for auth changes

# Notes
- Auth uses NextAuth.js v5 credentials provider with bcrypt-ts password hashing.
- Database helpers live in `lib/db/queries.ts` using Drizzle ORM and Postgres.
- `DUMMY_PASSWORD` is generated to mitigate timing attacks when credentials fail.
- Middleware handles redirect logic between `/login`, `/register`, `/share/*`, and authenticated routes.

# History
- Added in-memory database fallback for Playwright runs, tightened auth action validation, and documented changes. Attempted Playwright suite but runs are blocked by repeated font download network errors (see chunks a8384d, 7e0484, 4d204e).
- Implemented guest share access end-to-end coverage validating middleware behaviour. Playwright execution still blocked—browsers are not installed in this environment (see chunk c67173).
- Wired the user-message edit button with deterministic test id and comments. Tried targeted `chat.test.ts` and the scoped edit scenario, but both attempts stalled while the Next.js dev server handled requests (`ENETUNREACH` surfacing in logs). Manual server juggling ensured selectors exist but verification still pending due to dev-server instability.
- Added Playwright offline guards for fonts, avatars, and TokenLens catalog. Created unit + e2e coverage for the new toggles and confirmed the avatar placeholder via targeted Playwright run (`d11c1a`). Unable to grab an authenticated screenshot through `browser_container` because NextAuth rejects the cross-origin login attempts (see server log chunk `9f5482`).
- Switched Playwright's test server to port 3100 with explicit env wiring, updated the helper to respect `PLAYWRIGHT_TEST_BASE_URL`, and confirmed `auth.setup` + `artifacts` flows succeed against the manual server (`9c28a1`, `8e359a`).
- Installed Chromium browsers/system deps for Playwright, refreshed `pnpm-lock.yaml` so `@ai-sdk/openai` resolves, tightened the chat URL assertion to accept any base URL, and ran targeted e2e flows (artifacts, access-control, chat redirect) against the manual dev server while noting the full chat suite still requires significant runtime.
- Persisted the Playwright in-memory database on `globalThis` so registration + login share state across server actions, installed the updated Chromium runtime/deps, and reran the Access Control suite plus serial login block (long-running; see chunks 4fc460, 715f5f) to confirm the flows execute even though a complete green run still takes several minutes.
