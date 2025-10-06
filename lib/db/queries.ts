import "server-only";

import fs from "node:fs";
import path from "node:path";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  type SQL,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { ArtifactKind } from "@/components/artifact";
import type { VisibilityType } from "@/components/visibility-selector";
import { isTestEnvironment } from "../constants";
import { ChatSDKError } from "../errors";
import { logWarning } from "../logging";
import type { AppUsage } from "../usage";
import { generateUUID } from "../utils";
import {
  type Chat,
  chat,
  type DBMessage,
  document,
  type Asset,
  asset,
  backtestRun,
  message,
  type Suggestion,
  strategy,
  type Strategy,
  strategyVersion,
  type StrategyVersion,
  stream,
  suggestion,
  type User,
  user,
  type BacktestRun,
  type FinancePreference,
  financePreference,
  type IndicatorConfig,
  type NewsItemCache,
  type Watchlist,
  type WatchlistItem,
  vote,
} from "./schema";
import { generateHashedPassword } from "./utils";
import type {
  BacktestMetrics,
  BacktestTrade,
  EquityCurvePoint,
} from "@/lib/finance/types";
import {
  FINANCE_MARKET_IDS,
  type FinancePreferences,
} from "../finance/preferences";

// Optionally, if not using email/pass login, you can
// use the Drizzle adapter for Auth.js / NextAuth
// https://authjs.dev/reference/adapter/drizzle

type InMemoryStore = {
  users: Map<string, User>;
  userPlaintextPasswords: Map<string, string>;
  /** Normalised email -> latest plaintext password for Playwright accounts. */
  userPlaintextByEmail: Map<string, string>;
  chats: Map<string, Chat>;
  messages: Map<string, DBMessage>;
  votes: Map<string, { chatId: string; messageId: string; isUpvoted: boolean }>;
  documents: Map<
    string,
    Array<{
      id: string;
      title: string;
      kind: ArtifactKind;
      content: string;
      userId: string;
      createdAt: Date;
    }>
  >;
  suggestions: Map<string, Suggestion[]>;
  streams: Map<string, Array<{ id: string; chatId: string; createdAt: Date }>>;
  assets: Map<string, Asset>;
  assetsBySymbolExchange: Map<string, string>;
  watchlists: Map<string, Watchlist>;
  watchlistItems: Map<string, WatchlistItem>;
  strategies: Map<string, Strategy>;
  strategyVersions: Map<string, StrategyVersion>;
  backtestRuns: Map<string, BacktestRun>;
  indicatorConfigs: Map<string, IndicatorConfig>;
  newsItems: Map<string, NewsItemCache>;
  financePreferences: Map<string, FinancePreference>;
};

declare global {
  // eslint-disable-next-line no-var -- Explicitly extend the Node.js global scope.
  var __ONCHARTV_IN_MEMORY_STORE__: InMemoryStore | undefined;
}

type ProcessWithInMemoryStore = NodeJS.Process & {
  __ONCHARTV_IN_MEMORY_STORE__?: InMemoryStore;
};

const processWithStore = process as ProcessWithInMemoryStore;

/**
 * Normalise email addresses so lookups in the in-memory test database stay
 * resilient to casing differences. The production Postgres queries remain
 * case-sensitive, matching the schema constraints, while Playwright runs work
 * with whatever variant the fixtures submit through the UI.
 */
function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

function shouldLogPlaywrightAuthInstrumentation(): boolean {
  const flag = process.env.DEBUG_PLAYWRIGHT_AUTH;

  if (typeof flag !== "string") {
    return false;
  }

  const normalised = flag.trim().toLowerCase();
  return normalised === "1" || normalised === "true" || normalised === "yes";
}

type PlaywrightStoreSummary = {
  totalUsers: number;
  totalPlaintextPasswords: number;
  totalEmails: number;
  sampleUserIds: string[];
  sampleEmails: string[];
  target?: {
    email: string;
    presentInUsers: boolean;
    presentInPlaintext: boolean;
    plaintextLength: number | null;
    userId: string | null;
  };
};

/**
 * Build a compact snapshot of the Playwright in-memory store so we can inspect
 * whether the expected user has been persisted across the distinct Next.js
 * runtimes. The summary deliberately limits the number of IDs/emails surfaced
 * to avoid dumping the whole fixture set in logs.
 */
function summarisePlaywrightStore(
  store: InMemoryStore,
  options?: { targetEmail?: string }
): PlaywrightStoreSummary {
  const sampleUserIds = Array.from(store.users.keys()).slice(0, 5);
  const sampleEmails = Array.from(store.userPlaintextByEmail.keys()).slice(0, 5);

  const summary: PlaywrightStoreSummary = {
    totalUsers: store.users.size,
    totalPlaintextPasswords: store.userPlaintextPasswords.size,
    totalEmails: store.userPlaintextByEmail.size,
    sampleUserIds,
    sampleEmails,
  };

  if (options?.targetEmail) {
    const normalisedTarget = normaliseEmail(options.targetEmail);
    let targetUserId: string | null = null;

    for (const [id, record] of store.users.entries()) {
      if (normaliseEmail(record.email ?? "") === normalisedTarget) {
        targetUserId = id;
        break;
      }
    }

    const plaintext = store.userPlaintextByEmail.get(normalisedTarget);

    summary.target = {
      email: normalisedTarget,
      presentInUsers: targetUserId !== null,
      presentInPlaintext: store.userPlaintextByEmail.has(normalisedTarget),
      plaintextLength:
        typeof plaintext === "string" ? plaintext.length : plaintext ? String(plaintext).length : null,
      userId: targetUserId,
    };
  }

  return summary;
}

/**
 * Emit a structured log describing the Playwright user store when debugging is
 * explicitly enabled. The helper keeps the side-effect centralised so
 * production builds avoid noisy console output.
 */
function logPlaywrightStoreSnapshot(reason: string, store: InMemoryStore): void {
  if (!shouldLogPlaywrightAuthInstrumentation()) {
    return;
  }

  const targetEmail = process.env.DEBUG_PLAYWRIGHT_USER;
  const summary = summarisePlaywrightStore(store, {
    targetEmail: typeof targetEmail === "string" ? targetEmail : undefined,
  });

  console.info("[auth][debug] Playwright user store snapshot", {
    reason,
    ...summary,
  });
}

function setSharedInMemoryStore(store: InMemoryStore): InMemoryStore {
  /**
   * Older dev servers may have initialised the shared store before this field
   * existed. Hydrate it lazily so Turbopack reloads continue sharing the same
   * instance without losing access to the cached plaintext credentials.
   */
  if (!store.userPlaintextByEmail) {
    store.userPlaintextByEmail = new Map();
  }
  globalThis.__ONCHARTV_IN_MEMORY_STORE__ = store;
  processWithStore.__ONCHARTV_IN_MEMORY_STORE__ = store;
  return store;
}

function getOrCreateInMemoryStore(): InMemoryStore {
  /**
   * Hydrate the store from whichever runtime context initialised it first.
   *
   * Turbopack spins up independent module graphs for server actions and route
   * handlers. When those graphs run in separate VM contexts they may expose
   * distinct `globalThis` objects, but they continue to share the same Node.js
   * `process` instance. We therefore check the process-scoped cache before
   * falling back to the current global so every context converges on a single
   * in-memory database.
   */
  if (processWithStore.__ONCHARTV_IN_MEMORY_STORE__) {
    const store = setSharedInMemoryStore(
      processWithStore.__ONCHARTV_IN_MEMORY_STORE__
    );
    loadPersistedUsers(store);
    logPlaywrightStoreSnapshot("process-cache", store);
    return store;
  }

  if (globalThis.__ONCHARTV_IN_MEMORY_STORE__) {
    const store = setSharedInMemoryStore(globalThis.__ONCHARTV_IN_MEMORY_STORE__);
    loadPersistedUsers(store);
    logPlaywrightStoreSnapshot("global-cache", store);
    return store;
  }

  /**
   * Persist the Playwright-specific data structures on the shared holders so
   * credentials verified inside route handlers can still see the users created
   * by server actions running in a different compilation graph.
   */
  const store: InMemoryStore = {
    users: new Map(),
    userPlaintextPasswords: new Map(),
    userPlaintextByEmail: new Map(),
    chats: new Map(),
    messages: new Map(),
    votes: new Map(),
    documents: new Map(),
    suggestions: new Map(),
    streams: new Map(),
    assets: new Map(),
    assetsBySymbolExchange: new Map(),
    watchlists: new Map(),
    watchlistItems: new Map(),
    strategies: new Map(),
    strategyVersions: new Map(),
    backtestRuns: new Map(),
    indicatorConfigs: new Map(),
    newsItems: new Map(),
    financePreferences: new Map(),
  };

  const shared = setSharedInMemoryStore(store);
  loadPersistedUsers(shared);
  logPlaywrightStoreSnapshot("fresh-store", shared);
  return shared;
}

/**
 * Persist Playwright-created credentials to disk so that independent Next.js
 * compilation graphs (server actions, route handlers, middleware) can converge
 * on the same deterministic user store. Without this fallback the different
 * environments would frequently lose sight of the registration performed in a
 * separate worker, causing `CredentialsSignin` errors mid-suite.
 */
const PLAYWRIGHT_AUTH_DIR = path.resolve(process.cwd(), "tests/.auth");
const PLAYWRIGHT_USERS_PATH = path.join(
  PLAYWRIGHT_AUTH_DIR,
  "playwright-users.json"
);

/**
 * Track the most recent modification timestamp of the persisted Playwright
 * credentials snapshot. When the timestamp changes we reload the cached users
 * so independent Next.js module graphs (server actions vs route handlers)
 * converge on the same credential set without depending on shared memory.
 */
let persistedUsersMtimeMs = 0;

/**
 * Hydrate the shared in-memory store from the persisted credentials file when
 * the Playwright harness spins up a fresh module graph.
 */
type LoadPersistedUsersOptions = {
  /**
   * Force the persisted snapshot to be re-read even when the recorded
   * modification timestamp has not advanced. The flag is used as a
   * last-resort hydration step when a caller observes a cache miss after
   * loading the optimistic in-memory store, which can happen when two module
   * graphs race to read the snapshot within the same millisecond.
   */
  force?: boolean;
};

function loadPersistedUsers(
  store: InMemoryStore,
  options: LoadPersistedUsersOptions = {}
): boolean {
  if (!fs.existsSync(PLAYWRIGHT_USERS_PATH)) {
    persistedUsersMtimeMs = 0;
    return false;
  }

  let currentMtimeMs = 0;

  try {
    const stats = fs.statSync(PLAYWRIGHT_USERS_PATH);
    currentMtimeMs = Number(stats.mtimeMs) || 0;
  } catch (error) {
    console.warn(
      "Failed to stat persisted Playwright users",
      error
    );
    return false;
  }

  if (
    !options.force &&
    currentMtimeMs !== 0 &&
    currentMtimeMs <= persistedUsersMtimeMs
  ) {
    return false;
  }

  try {
    const raw = fs.readFileSync(PLAYWRIGHT_USERS_PATH, "utf-8");
    const records = JSON.parse(raw) as Array<{
      id: string;
      email: string;
      password: string | null;
      plaintext?: string | null;
    }>;

    store.userPlaintextPasswords.clear();
    store.userPlaintextByEmail.clear();

    for (const record of records) {
      if (!record?.id || !record?.email) {
        continue;
      }

      store.users.set(record.id, {
        id: record.id,
        email: record.email,
        password: typeof record.password === "string" ? record.password : null,
      });

      const normalised = normaliseEmail(record.email);
      const plaintext =
        typeof record.plaintext === "string" ? record.plaintext : "";

      store.userPlaintextPasswords.set(record.id, plaintext);
      store.userPlaintextByEmail.set(normalised, plaintext);
    }

    persistedUsersMtimeMs = currentMtimeMs;
    return true;
  } catch (error) {
    console.warn(
      "Failed to hydrate Playwright users from persisted store",
      error
    );
    return false;
  }
}

/**
 * Minimal snapshot describing a Playwright persisted credential record.
 * The helper functions below reuse the structure to bridge independent
 * Next.js module graphs that cannot rely on shared in-memory state.
 */
type PersistedUserSnapshot = {
  id: string;
  email: string;
  password: string | null;
  plaintext?: string | null;
};

/**
 * Read the persisted Playwright credential snapshot directly from disk.
 * The loader is intentionally lightweight so fallback paths can reload the
 * credentials even when the optimistic in-memory store has not yet hydrated.
 */
function readPersistedUsersFromDisk(): PersistedUserSnapshot[] | null {
  if (!fs.existsSync(PLAYWRIGHT_USERS_PATH)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(PLAYWRIGHT_USERS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as PersistedUserSnapshot[] | null;

    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed;
  } catch (error) {
    console.warn("Failed to parse persisted Playwright users", error);
    return null;
  }
}

/**
 * Surface the persisted Playwright credential record associated with the
 * provided email address. The helper keeps NextAuth workers deterministic when
 * Turbopack isolates them in module graphs that cannot observe the shared
 * in-memory store directly.
 */
export function getPersistedTestUserByEmail(
  email: string
): PersistedUserSnapshot | undefined {
  if (!isTestEnvironment) {
    return undefined;
  }

  const snapshot = readPersistedUsersFromDisk();
  if (!snapshot) {
    return undefined;
  }

  const targetEmail = normaliseEmail(email);
  return snapshot.find((record) =>
    typeof record?.email === "string" &&
    normaliseEmail(record.email) === targetEmail
  );
}

/**
 * Serialize the current set of Playwright users so other runtimes can import
 * the deterministic credentials without depending on shared memory.
 */
function persistUsers(store: InMemoryStore) {
  try {
    fs.mkdirSync(PLAYWRIGHT_AUTH_DIR, { recursive: true });

    const payload = Array.from(store.users.entries()).map(
      ([id, currentUser]) => {
        const email = currentUser.email ?? "";
        const plaintext = store.userPlaintextPasswords.get(id) ?? "";

        return {
          id,
          email,
          password: currentUser.password ?? null,
          plaintext,
        };
      }
    );

    fs.writeFileSync(
      PLAYWRIGHT_USERS_PATH,
      JSON.stringify(payload, null, 2),
      "utf-8"
    );

    try {
      const stats = fs.statSync(PLAYWRIGHT_USERS_PATH);
      const updatedMtimeMs = Number(stats.mtimeMs) || 0;

      if (updatedMtimeMs > 0) {
        persistedUsersMtimeMs = updatedMtimeMs;
      }
    } catch (error) {
      console.warn(
        "Failed to refresh Playwright users timestamp",
        error
      );
    }
  } catch (error) {
    console.warn("Failed to persist Playwright users", error);
  }
}

const inMemoryStore: InMemoryStore | null = isTestEnvironment
  ? getOrCreateInMemoryStore()
  : null;

/**
 * Helper ensuring we only touch the in-memory store in the Playwright setup.
 * This avoids coupling the production Postgres code-path with the simulated
 * data required by the deterministic tests.
 */
function getInMemoryStore(): InMemoryStore {
  if (!inMemoryStore) {
    throw new Error(
      "Attempted to access the in-memory database outside the test environment"
    );
  }

  loadPersistedUsers(inMemoryStore);
  logPlaywrightStoreSnapshot("lazy-hydration", inMemoryStore);

  return inMemoryStore;
}

/**
 * Utility available to unit tests for resetting the fake persistence layer.
 *
 * Playwright-driven scenarios toggle the `PLAYWRIGHT` environment variable,
 * meaning the in-memory store persists for the duration of the worker. Exposing
 * an explicit reset hook keeps the state deterministic across individual test
 * cases.
 */
export function __resetInMemoryDbForTests(): void {
  if (!isTestEnvironment) {
    throw new Error(
      "Attempted to reset the in-memory database outside the test environment"
    );
  }

  const store = getInMemoryStore();

  store.users.clear();
  store.userPlaintextPasswords.clear();
  store.userPlaintextByEmail.clear();
  store.chats.clear();
  store.messages.clear();
  store.votes.clear();
  store.documents.clear();
  store.suggestions.clear();
  store.streams.clear();
  store.assets.clear();
  store.assetsBySymbolExchange.clear();
  store.watchlists.clear();
  store.watchlistItems.clear();
  store.strategies.clear();
  store.strategyVersions.clear();
  store.backtestRuns.clear();
  store.indicatorConfigs.clear();
  store.newsItems.clear();
  store.financePreferences.clear();

  try {
    persistedUsersMtimeMs = 0;
    if (fs.existsSync(PLAYWRIGHT_USERS_PATH)) {
      fs.rmSync(PLAYWRIGHT_USERS_PATH);
    }
  } catch (error) {
    console.warn("Failed to reset persisted Playwright users", error);
  }
}

const makeVoteKey = (chatId: string, messageId: string) => `${chatId}:${messageId}`;

const normaliseSymbol = (value: string) => value.trim().toUpperCase();
const normaliseExchange = (value: string) => value.trim().toUpperCase();
const normaliseCurrency = (value: string) => value.trim().toUpperCase();

const makeAssetKey = (symbol: string, exchange: string) =>
  `${normaliseSymbol(symbol)}::${normaliseExchange(exchange)}`;

const marketPosition = new Map(
  FINANCE_MARKET_IDS.map((id, index) => [id, index] as const)
);

const normaliseMarkets = (
  markets: FinancePreferences["markets"]
): FinancePreferences["markets"] => {
  const deduped = Array.from(new Set(markets));
  deduped.sort((first, second) => {
    const firstIndex = marketPosition.get(first) ?? Number.MAX_SAFE_INTEGER;
    const secondIndex = marketPosition.get(second) ?? Number.MAX_SAFE_INTEGER;
    return firstIndex - secondIndex;
  });

  return deduped as FinancePreferences["markets"];
};

const cloneFinancePreference = (
  record: FinancePreference
): FinancePreference => {
  return {
    ...record,
    markets: [...record.markets] as FinancePreference["markets"],
    indicators: record.indicators.map((indicator) => ({
      ...indicator,
    })) as FinancePreference["indicators"],
  };
};

// biome-ignore lint: Forbidden non-null assertion.
const client = isTestEnvironment ? null : postgres(process.env.POSTGRES_URL!);
const db = client
  ? drizzle(client)
  : ({} as ReturnType<typeof drizzle>);

export async function getUser(email: string): Promise<User[]> {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const targetEmail = normaliseEmail(email);
    const matches = Array.from(store.users.values()).filter((currentUser) =>
      typeof currentUser.email === "string" &&
      normaliseEmail(currentUser.email) === targetEmail
    );

    if (matches.length > 0) {
      return matches;
    }

    /**
     * When two module graphs access the persisted snapshot within the same
     * millisecond the filesystem timestamp may not advance, causing the eager
     * hydration in `getInMemoryStore` to short-circuit. Force a refresh so the
     * login flow can observe users that were registered in a neighbouring
     * graph moments earlier.
     */
    const reloaded = loadPersistedUsers(store, { force: true });

    if (!reloaded) {
      return matches;
    }

    return Array.from(store.users.values()).filter((currentUser) =>
      typeof currentUser.email === "string" &&
      normaliseEmail(currentUser.email) === targetEmail
    );
  }

  try {
    return await db.select().from(user).where(eq(user.email, email));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get user by email"
    );
  }
}

function getInMemoryPlaintextPassword(email: string): string | undefined {
  if (!isTestEnvironment) {
    return undefined;
  }

  const store = getInMemoryStore();
  const targetEmail = normaliseEmail(email);

  /** Fast-path lookups using the normalised email key. */
  const directLookup = store.userPlaintextByEmail.get(targetEmail);
  if (typeof directLookup === "string" && directLookup.length > 0) {
    return directLookup;
  }

  const resolveFromStore = () => {
    for (const [userId, currentUser] of store.users.entries()) {
      if (
        typeof currentUser.email === "string" &&
        normaliseEmail(currentUser.email) === targetEmail
      ) {
        const plainPassword = store.userPlaintextPasswords.get(userId);
        if (typeof plainPassword === "string" && plainPassword.length > 0) {
          /**
           * Persist the freshly recovered plaintext so the direct map short-
           * circuits future lookups, keeping the hot login path inexpensive.
           */
          store.userPlaintextByEmail.set(targetEmail, plainPassword);
          return plainPassword;
        }

        return undefined;
      }
    }

    return undefined;
  };

  const lookup = resolveFromStore();
  if (lookup) {
    return lookup;
  }

  const reloaded = loadPersistedUsers(store, { force: true });
  if (!reloaded) {
    return undefined;
  }

  return resolveFromStore();
}

export function getTestUserPlaintextPassword(email: string): string | undefined {
  return getInMemoryPlaintextPassword(email);
}

export async function createUser(email: string, password: string) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const hashedPassword = generateHashedPassword(password);
    const targetEmail = normaliseEmail(email);

    const existingEntry = Array.from(store.users.entries()).find(
      ([, currentUser]) =>
        typeof currentUser.email === "string" &&
        normaliseEmail(currentUser.email) === targetEmail
    );

    if (existingEntry) {
      const [userId, currentUser] = existingEntry;
      store.users.set(userId, {
        ...currentUser,
        email: currentUser.email ?? email,
        password: hashedPassword,
      });
      store.userPlaintextPasswords.set(userId, password);
      store.userPlaintextByEmail.set(targetEmail, password);

      persistUsers(store);

      return;
    }

    const id = generateUUID();

    store.users.set(id, { id, email, password: hashedPassword });
    store.userPlaintextPasswords.set(id, password);
    store.userPlaintextByEmail.set(targetEmail, password);

    persistUsers(store);

    return;
  }

  const hashedPassword = generateHashedPassword(password);

  try {
    return await db.insert(user).values({ email, password: hashedPassword });
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to create user");
  }
}

export async function createGuestUser() {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const id = generateUUID();
    const email = `guest-${Date.now()}`;
    const password = generateHashedPassword(generateUUID());

    store.users.set(id, { id, email, password });
    store.userPlaintextPasswords.set(id, "");
    store.userPlaintextByEmail.set(normaliseEmail(email), "");

    persistUsers(store);

    return [{ id, email }];
  }

  const email = `guest-${Date.now()}`;
  const password = generateHashedPassword(generateUUID());

  try {
    return await db.insert(user).values({ email, password }).returning({
      id: user.id,
      email: user.email,
    });
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to create guest user"
    );
  }
}

export async function saveChat({
  id,
  userId,
  title,
  visibility,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: VisibilityType;
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const chatRecord: Chat = {
      id,
      createdAt: new Date(),
      userId,
      title,
      visibility,
      lastContext: null,
    };

    store.chats.set(id, chatRecord);

    return;
  }

  try {
    return await db.insert(chat).values({
      id,
      createdAt: new Date(),
      userId,
      title,
      visibility,
    });
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to save chat");
  }
}

export async function deleteChatById({ id }: { id: string }) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const chatToDelete = store.chats.get(id) ?? null;

    for (const [messageId, messageRecord] of Array.from(store.messages)) {
      if (messageRecord.chatId === id) {
        store.messages.delete(messageId);
      }
    }

    for (const [voteKey, voteRecord] of Array.from(store.votes)) {
      if (voteRecord.chatId === id) {
        store.votes.delete(voteKey);
      }
    }

    store.streams.delete(id);
    store.chats.delete(id);

    return chatToDelete;
  }

  try {
    await db.delete(vote).where(eq(vote.chatId, id));
    await db.delete(message).where(eq(message.chatId, id));
    await db.delete(stream).where(eq(stream.chatId, id));

    const [chatsDeleted] = await db
      .delete(chat)
      .where(eq(chat.id, id))
      .returning();
    return chatsDeleted;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to delete chat by id"
    );
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const allChats = Array.from(store.chats.values()).filter(
      (currentChat) => currentChat.userId === id
    );

    const sortedChats = allChats.sort(
      (first, second) => second.createdAt.getTime() - first.createdAt.getTime()
    );

    let filteredChats = sortedChats;

    if (startingAfter) {
      const pivotChat = store.chats.get(startingAfter);

      if (!pivotChat) {
        throw new ChatSDKError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`
        );
      }

      filteredChats = sortedChats.filter(
        (currentChat) => currentChat.createdAt > pivotChat.createdAt
      );
    } else if (endingBefore) {
      const pivotChat = store.chats.get(endingBefore);

      if (!pivotChat) {
        throw new ChatSDKError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`
        );
      }

      filteredChats = sortedChats.filter(
        (currentChat) => currentChat.createdAt < pivotChat.createdAt
      );
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  }

  try {
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<any>) =>
      db
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(whereCondition, eq(chat.userId, id))
            : eq(chat.userId, id)
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);

    let filteredChats: Chat[] = [];

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new ChatSDKError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`
        );
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new ChatSDKError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`
        );
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get chats by user id"
    );
  }
}

export async function getChatById({ id }: { id: string }) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    return store.chats.get(id) ?? null;
  }

  try {
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id));
    if (!selectedChat) {
      return null;
    }

    return selectedChat;
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to get chat by id");
  }
}

export async function saveMessages({ messages }: { messages: DBMessage[] }) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();

    for (const messageRecord of messages) {
      store.messages.set(messageRecord.id, {
        ...messageRecord,
        createdAt: new Date(messageRecord.createdAt),
      });
    }

    return;
  }

  try {
    return await db.insert(message).values(messages);
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to save messages");
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    return Array.from(store.messages.values())
      .filter((messageRecord) => messageRecord.chatId === id)
      .sort(
        (first, second) =>
          new Date(first.createdAt).getTime() -
          new Date(second.createdAt).getTime()
      );
  }

  try {
    return await db
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get messages by chat id"
    );
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: "up" | "down";
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const voteKey = makeVoteKey(chatId, messageId);
    store.votes.set(voteKey, {
      chatId,
      messageId,
      isUpvoted: type === "up",
    });

    return;
  }

  try {
    const [existingVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.messageId, messageId)));

    if (existingVote) {
      return await db
        .update(vote)
        .set({ isUpvoted: type === "up" })
        .where(and(eq(vote.messageId, messageId), eq(vote.chatId, chatId)));
    }
    return await db.insert(vote).values({
      chatId,
      messageId,
      isUpvoted: type === "up",
    });
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to vote message");
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    return Array.from(store.votes.values()).filter(
      (voteRecord) => voteRecord.chatId === id
    );
  }

  try {
    return await db.select().from(vote).where(eq(vote.chatId, id));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get votes by chat id"
    );
  }
}

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const documentRecord = {
      id,
      title,
      kind,
      content,
      userId,
      createdAt: new Date(),
    };

    const documents = store.documents.get(id) ?? [];
    documents.push(documentRecord);
    documents.sort(
      (first, second) => first.createdAt.getTime() - second.createdAt.getTime()
    );
    store.documents.set(id, documents);

    return [documentRecord];
  }

  try {
    return await db
      .insert(document)
      .values({
        id,
        title,
        kind,
        content,
        userId,
        createdAt: new Date(),
      })
      .returning();
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to save document");
  }
}

export async function getDocumentsById({ id }: { id: string }) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const documents = store.documents.get(id) ?? [];
    return [...documents].sort(
      (first, second) => first.createdAt.getTime() - second.createdAt.getTime()
    );
  }

  try {
    const documents = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(asc(document.createdAt));

    return documents;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get documents by id"
    );
  }
}

export async function getDocumentById({ id }: { id: string }) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const documents = store.documents.get(id) ?? [];
    return documents.at(-1);
  }

  try {
    const [selectedDocument] = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt));

    return selectedDocument;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get document by id"
    );
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const documents = store.documents.get(id) ?? [];
    const remainingDocuments = documents.filter(
      (currentDocument) => currentDocument.createdAt <= timestamp
    );
    const deletedDocuments = documents.filter(
      (currentDocument) => currentDocument.createdAt > timestamp
    );

    store.documents.set(id, remainingDocuments);

    const existingSuggestions = store.suggestions.get(id) ?? [];
    const keptSuggestions = existingSuggestions.filter(
      (suggestionRecord) => suggestionRecord.documentCreatedAt <= timestamp
    );
    store.suggestions.set(id, keptSuggestions);

    return deletedDocuments;
  }

  try {
    await db
      .delete(suggestion)
      .where(
        and(
          eq(suggestion.documentId, id),
          gt(suggestion.documentCreatedAt, timestamp)
        )
      );

    return await db
      .delete(document)
      .where(and(eq(document.id, id), gt(document.createdAt, timestamp)))
      .returning();
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to delete documents by id after timestamp"
    );
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Suggestion[];
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    for (const suggestionRecord of suggestions) {
      const records = store.suggestions.get(suggestionRecord.documentId) ?? [];
      records.push(suggestionRecord);
      store.suggestions.set(suggestionRecord.documentId, records);
    }

    return;
  }

  try {
    return await db.insert(suggestion).values(suggestions);
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to save suggestions"
    );
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    return [...(store.suggestions.get(documentId) ?? [])];
  }

  try {
    return await db
      .select()
      .from(suggestion)
      .where(and(eq(suggestion.documentId, documentId)));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get suggestions by document id"
    );
  }
}

export async function getMessageById({ id }: { id: string }) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const messageRecord = store.messages.get(id);
    return messageRecord ? [messageRecord] : [];
  }

  try {
    return await db.select().from(message).where(eq(message.id, id));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get message by id"
    );
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const messagesToDelete = Array.from(store.messages.values()).filter(
      (messageRecord) =>
        messageRecord.chatId === chatId &&
        new Date(messageRecord.createdAt) >= timestamp
    );

    for (const messageRecord of messagesToDelete) {
      store.messages.delete(messageRecord.id);
      store.votes.delete(makeVoteKey(chatId, messageRecord.id));
    }

    return;
  }

  try {
    const messagesToDelete = await db
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp))
      );

    const messageIds = messagesToDelete.map(
      (currentMessage) => currentMessage.id
    );

    if (messageIds.length > 0) {
      await db
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds))
        );

      return await db
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds))
        );
    }
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to delete messages by chat id after timestamp"
    );
  }
}

export async function updateChatVisiblityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: "private" | "public";
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const chatRecord = store.chats.get(chatId);
    if (chatRecord) {
      store.chats.set(chatId, { ...chatRecord, visibility });
    }

    return;
  }

  try {
    return await db.update(chat).set({ visibility }).where(eq(chat.id, chatId));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to update chat visibility by id"
    );
  }
}

export async function updateChatLastContextById({
  chatId,
  context,
}: {
  chatId: string;
  // Store merged server-enriched usage object
  context: AppUsage;
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const chatRecord = store.chats.get(chatId);
    if (chatRecord) {
      store.chats.set(chatId, { ...chatRecord, lastContext: context });
    }

    return;
  }

  try {
    return await db
      .update(chat)
      .set({ lastContext: context })
      .where(eq(chat.id, chatId));
  } catch (error) {
    logWarning("db:queries", "Failed to update lastContext for chat", {
      chatId,
      error,
    });
    return;
  }
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: {
  id: string;
  differenceInHours: number;
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const threshold = Date.now() - differenceInHours * 60 * 60 * 1000;

    let total = 0;

    for (const messageRecord of store.messages.values()) {
      if (messageRecord.role !== "user") {
        continue;
      }

      if (new Date(messageRecord.createdAt).getTime() < threshold) {
        continue;
      }

      const chatRecord = store.chats.get(messageRecord.chatId);
      if (chatRecord?.userId === id) {
        total += 1;
      }
    }

    return total;
  }

  try {
    const twentyFourHoursAgo = new Date(
      Date.now() - differenceInHours * 60 * 60 * 1000
    );

    const [stats] = await db
      .select({ count: count(message.id) })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(
        and(
          eq(chat.userId, id),
          gte(message.createdAt, twentyFourHoursAgo),
          eq(message.role, "user")
        )
      )
      .execute();

    return stats?.count ?? 0;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get message count by user id"
    );
  }
}

export async function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const streams = store.streams.get(chatId) ?? [];
    streams.push({ id: streamId, chatId, createdAt: new Date() });
    streams.sort(
      (first, second) => first.createdAt.getTime() - second.createdAt.getTime()
    );
    store.streams.set(chatId, streams);

    return;
  }

  try {
    await db
      .insert(stream)
      .values({ id: streamId, chatId, createdAt: new Date() });
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to create stream id"
    );
  }
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const streams = store.streams.get(chatId) ?? [];
    return streams.map(({ id }) => id);
  }

  try {
    const streamIds = await db
      .select({ id: stream.id })
      .from(stream)
      .where(eq(stream.chatId, chatId))
      .orderBy(asc(stream.createdAt))
      .execute();

    return streamIds.map(({ id }) => id);
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get stream ids by chat id"
    );
  }
}

/** Input accepted by the {@link upsertAsset} helper. */
export interface UpsertAssetInput {
  readonly symbol: string;
  readonly exchange: string;
  readonly type: Asset["type"];
  readonly name: string;
  readonly currency: string;
}

/**
 * Inserts or updates an asset entry ensuring unique symbol/exchange pairs.
 */
export async function upsertAsset(input: UpsertAssetInput): Promise<Asset> {
  const normalisedSymbol = normaliseSymbol(input.symbol);
  const normalisedExchange = normaliseExchange(input.exchange);
  const normalisedCurrency = normaliseCurrency(input.currency);

  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const key = makeAssetKey(normalisedSymbol, normalisedExchange);
    const existingId = store.assetsBySymbolExchange.get(key);
    const createdAt = existingId
      ? store.assets.get(existingId)?.createdAt ?? new Date()
      : new Date();
    const id = existingId ?? generateUUID();
    const record: Asset = {
      id,
      symbol: normalisedSymbol,
      exchange: normalisedExchange,
      type: input.type,
      name: input.name,
      currency: normalisedCurrency,
      createdAt,
    };

    store.assets.set(id, record);
    store.assetsBySymbolExchange.set(key, id);

    return record;
  }

  try {
    const [record] = await db
      .insert(asset)
      .values({
        symbol: normalisedSymbol,
        exchange: normalisedExchange,
        type: input.type,
        name: input.name,
        currency: normalisedCurrency,
      })
      .onConflictDoUpdate({
        target: [asset.symbol, asset.exchange],
        set: {
          type: input.type,
          name: input.name,
          currency: normalisedCurrency,
        },
      })
      .returning();

    if (!record) {
      throw new ChatSDKError(
        "bad_request:database",
        "Asset upsert did not return a record"
      );
    }

    return record;
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to upsert asset");
  }
}

/** Fetches an asset by its symbol/exchange pair. */
export async function getAssetBySymbol({
  symbol,
  exchange,
}: {
  symbol: string;
  exchange: string;
}): Promise<Asset | null> {
  const normalisedSymbol = normaliseSymbol(symbol);
  const normalisedExchange = normaliseExchange(exchange);

  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const key = makeAssetKey(normalisedSymbol, normalisedExchange);
    const assetId = store.assetsBySymbolExchange.get(key);
    return assetId ? store.assets.get(assetId) ?? null : null;
  }

  try {
    const [record] = await db
      .select()
      .from(asset)
      .where(
        and(
          eq(asset.symbol, normalisedSymbol),
          eq(asset.exchange, normalisedExchange)
        )
      )
      .limit(1)
      .execute();

    return record ?? null;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to retrieve asset by symbol"
    );
  }
}

/** Input accepted by {@link createStrategy}. */
export interface CreateStrategyInput {
  readonly userId: string;
  readonly name: string;
  readonly description?: string;
}

/** Persists a strategy shell for future parameter revisions. */
export async function createStrategy(
  input: CreateStrategyInput
): Promise<Strategy> {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const id = generateUUID();
    const record: Strategy = {
      id,
      userId: input.userId,
      name: input.name,
      description: input.description ?? null,
      createdAt: new Date(),
    };

    store.strategies.set(id, record);

    return record;
  }

  try {
    const [record] = await db
      .insert(strategy)
      .values({
        userId: input.userId,
        name: input.name,
        description: input.description ?? null,
      })
      .returning();

    if (!record) {
      throw new ChatSDKError(
        "bad_request:database",
        "Strategy creation did not return a record"
      );
    }

    return record;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to create strategy"
    );
  }
}

/** Input accepted by {@link createStrategyVersion}. */
export interface CreateStrategyVersionInput {
  readonly strategyId: string;
  readonly params: unknown;
}

/**
 * Captures a snapshot of strategy parameters. Backtests reference the
 * immutable version to guarantee reproducible results.
 */
export async function createStrategyVersion(
  input: CreateStrategyVersionInput
): Promise<StrategyVersion> {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const id = generateUUID();
    const record: StrategyVersion = {
      id,
      strategyId: input.strategyId,
      params: input.params,
      createdAt: new Date(),
    };

    store.strategyVersions.set(id, record);

    return record;
  }

  try {
    const [record] = await db
      .insert(strategyVersion)
      .values({
        strategyId: input.strategyId,
        params: input.params,
      })
      .returning();

    if (!record) {
      throw new ChatSDKError(
        "bad_request:database",
        "Strategy version creation did not return a record"
      );
    }

    return record;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to create strategy version"
    );
  }
}

/** Input accepted by {@link createBacktestRun}. */
export interface CreateBacktestRunInput {
  readonly strategyVersionId: string;
  readonly assetId: string;
  readonly timeframe: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly metrics: BacktestMetrics;
  readonly trades: BacktestTrade[];
  readonly equityCurve: EquityCurvePoint[];
}

/** Persists the outcome of a backtest and returns the stored record. */
export async function createBacktestRun(
  input: CreateBacktestRunInput
): Promise<BacktestRun> {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const id = generateUUID();
    const record: BacktestRun = {
      id,
      strategyVersionId: input.strategyVersionId,
      assetId: input.assetId,
      timeframe: input.timeframe,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      metrics: input.metrics,
      trades: input.trades,
      equityCurve: input.equityCurve,
      createdAt: new Date(),
    };

    store.backtestRuns.set(id, record);

    return record;
  }

  try {
    const [record] = await db
      .insert(backtestRun)
      .values({
        strategyVersionId: input.strategyVersionId,
        assetId: input.assetId,
        timeframe: input.timeframe,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        metrics: input.metrics,
        trades: input.trades,
        equityCurve: input.equityCurve,
      })
      .returning();

    if (!record) {
      throw new ChatSDKError(
        "bad_request:database",
        "Backtest run creation did not return a record"
      );
    }

    return record;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to create backtest run"
    );
  }
}

/** Lists backtests associated with a given strategy ordered by recency. */
export async function listBacktestsByStrategy({
  strategyId,
  limit = 20,
}: {
  strategyId: string;
  limit?: number;
}): Promise<BacktestRun[]> {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const relevantVersionIds = new Set(
      Array.from(store.strategyVersions.values())
        .filter((version) => version.strategyId === strategyId)
        .map((version) => version.id)
    );

    const runs = Array.from(store.backtestRuns.values()).filter((run) =>
      relevantVersionIds.has(run.strategyVersionId)
    );

    runs.sort(
      (first, second) =>
        second.createdAt.getTime() - first.createdAt.getTime()
    );

    return runs.slice(0, limit);
  }

  try {
    const rows = await db
      .select({ run: backtestRun })
      .from(backtestRun)
      .innerJoin(
        strategyVersion,
        eq(backtestRun.strategyVersionId, strategyVersion.id)
      )
      .where(eq(strategyVersion.strategyId, strategyId))
      .orderBy(desc(backtestRun.createdAt))
      .limit(limit)
      .execute();

    return rows.map(({ run }) => run);
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to list backtests by strategy"
    );
  }
}

/** Loads the finance preferences associated with a user if present. */
export async function getFinancePreferencesByUserId({
  userId,
}: {
  userId: string;
}): Promise<FinancePreference | null> {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const record = store.financePreferences.get(userId) ?? null;
    return record ? cloneFinancePreference(record) : null;
  }

  try {
    const [record] = await db
      .select()
      .from(financePreference)
      .where(eq(financePreference.userId, userId))
      .limit(1);

    return record ? cloneFinancePreference(record) : null;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to load finance preferences"
    );
  }
}

/** Input shape accepted by {@link upsertFinancePreferences}. */
export interface UpsertFinancePreferencesInput extends FinancePreferences {
  readonly userId: string;
}

/**
 * Persists the finance preferences for a user, inserting or updating as
 * required. Markets are deduplicated and ordered to keep the payload stable.
 */
export async function upsertFinancePreferences(
  input: UpsertFinancePreferencesInput
): Promise<FinancePreference> {
  const markets = normaliseMarkets(input.markets);
  const indicators = input.defaultIndicators.map((indicator) => ({
    ...indicator,
  })) as FinancePreference["indicators"];
  const now = new Date();

  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const existing = store.financePreferences.get(input.userId);

    if (existing) {
      const updated: FinancePreference = {
        ...existing,
        markets,
        indicators,
        explanationLevel: input.explanationLevel,
        showNews: input.showNews,
        updatedAt: now,
      };

      store.financePreferences.set(input.userId, updated);
      return cloneFinancePreference(updated);
    }

    const record: FinancePreference = {
      id: generateUUID(),
      userId: input.userId,
      markets,
      indicators,
      explanationLevel: input.explanationLevel,
      showNews: input.showNews,
      createdAt: now,
      updatedAt: now,
    };

    store.financePreferences.set(input.userId, record);
    return cloneFinancePreference(record);
  }

  try {
    const [record] = await db
      .insert(financePreference)
      .values({
        userId: input.userId,
        markets,
        indicators,
        explanationLevel: input.explanationLevel,
        showNews: input.showNews,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: financePreference.userId,
        set: {
          markets,
          indicators,
          explanationLevel: input.explanationLevel,
          showNews: input.showNews,
          updatedAt: now,
        },
      })
      .returning();

    if (!record) {
      throw new ChatSDKError(
        "bad_request:database",
        "Finance preference upsert did not return a record"
      );
    }

    return cloneFinancePreference(record);
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to upsert finance preferences"
    );
  }
}

/**
 * Test-only exports so unit tests can validate the debugging helpers without
 * relying on private module internals.
 */
export const __summarisePlaywrightStoreForTests = summarisePlaywrightStore;
export const __loadPersistedUsersForTests = loadPersistedUsers;
export function __getInMemoryStoreForTests(): InMemoryStore {
  return getInMemoryStore();
}
export type __InMemoryStoreForTests = InMemoryStore;
