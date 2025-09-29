# Tasks
- [x] Finish authentication implementation (NextAuth credentials + guest access)
- [x] Ensure registration and login flows create/return proper sessions
- [x] Ensure middleware protects authenticated routes while allowing guest share access
- [ ] Add chat UI affordances (edit button with `data-testid`) for user messages *(edit control wired; full chat suite still pending to confirm selectors behave under Playwright)*
- [ ] Run end-to-end tests (`pnpm exec playwright test`) *(artifacts + auth setup run cleanly with the manual server; broader suites still long-running—start `PORT=3100 PLAYWRIGHT=true pnpm dev` before invoking Playwright)*
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
