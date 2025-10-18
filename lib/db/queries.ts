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
  ne,
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
import type { Attachment, ChatMessage } from "../types";
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
  var __ONCHARTV_IN_MEMORY_STORE__:
    | InMemoryStore
    | null
    | undefined;
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
    return store;
  }

  if (globalThis.__ONCHARTV_IN_MEMORY_STORE__) {
    const store = setSharedInMemoryStore(globalThis.__ONCHARTV_IN_MEMORY_STORE__);
    loadPersistedUsers(store);
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
 * Hydrate the shared in-memory store from the persisted credentials file when
 * the Playwright harness spins up a fresh module graph.
 */
function loadPersistedUsers(store: InMemoryStore) {
  if (!fs.existsSync(PLAYWRIGHT_USERS_PATH)) {
    return;
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

      const normalisedEmail = normaliseEmail(record.email);
      const plaintext = record.plaintext ?? "";

      store.users.set(record.id, {
        id: record.id,
        email: record.email,
        password: record.password ?? null,
      });

      store.userPlaintextPasswords.set(record.id, plaintext);
      store.userPlaintextByEmail.set(normalisedEmail, plaintext);
    }
  } catch (error) {
    // Surface the failure without leaking raw stack traces or secrets to shared logs.
    logWarning(
      "db:queries",
      "Failed to hydrate Playwright users from persisted store",
      { error }
    );
  }
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
  } catch (error) {
    // Persisting the hermetic credentials is best-effort; warn while redacting sensitive payloads.
    logWarning("db:queries", "Failed to persist Playwright users", { error });
  }
}

let inMemoryStore: InMemoryStore | null = null;

/**
 * Helper ensuring we only touch the in-memory store in the Playwright setup.
 * This avoids coupling the production Postgres code-path with the simulated
 * data required by the deterministic tests.
 */
function getInMemoryStore(): InMemoryStore {
  if (!isTestEnvironment()) {
    throw new Error(
      "Attempted to access the in-memory database outside the test environment"
    );
  }

  if (globalThis.__ONCHARTV_IN_MEMORY_STORE__) {
    inMemoryStore = globalThis.__ONCHARTV_IN_MEMORY_STORE__ ?? null;
  }

  if (!inMemoryStore) {
    inMemoryStore = getOrCreateInMemoryStore();
    globalThis.__ONCHARTV_IN_MEMORY_STORE__ = inMemoryStore;
  }

  loadPersistedUsers(inMemoryStore);
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
  if (!isTestEnvironment()) {
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

  globalThis.__ONCHARTV_IN_MEMORY_STORE__ = store;

  try {
    if (fs.existsSync(PLAYWRIGHT_USERS_PATH)) {
      fs.rmSync(PLAYWRIGHT_USERS_PATH);
    }
  } catch (error) {
    // Cleaning up the cached credentials is non-fatal; log the sanitised failure for debugging.
    logWarning("db:queries", "Failed to reset persisted Playwright users", { error });
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

type DrizzleClient = ReturnType<typeof drizzle>;

let postgresClient: ReturnType<typeof postgres> | null = null;
let drizzleClient: DrizzleClient | null = null;

/**
 * Lazily resolve the Postgres client so unit tests that toggle the hermetic
 * flag after importing this module do not eagerly connect to production
 * infrastructure. When the Playwright markers are active the helper returns
 * `null`, signalling that callers should fall back to the in-memory store.
 */
function getDatabase(): DrizzleClient | null {
  if (isTestEnvironment()) {
    return null;
  }

  if (!postgresClient) {
    // biome-ignore lint/style/noNonNullAssertion: POSTGRES_URL is validated at runtime.
    postgresClient = postgres(process.env.POSTGRES_URL!);
  }

  if (!drizzleClient) {
    drizzleClient = drizzle(postgresClient);
  }

  return drizzleClient;
}

/**
 * Helper ensuring callers never receive a falsy database handle in production
 * code-paths. When the hermetic environment is active we rely on the in-memory
 * store instead of Postgres, so invoking this helper signals a programming
 * error that warrants an explicit failure.
 */
function getRequiredDatabase(): DrizzleClient {
  const database = getDatabase();
  if (!database) {
    throw new ChatSDKError(
      "bad_request:database",
      "Attempted to access the Postgres client while the hermetic test database is active"
    );
  }

  return database;
}

export async function getUser(email: string): Promise<User[]> {
  if (isTestEnvironment()) {
    const store = getInMemoryStore();
    const targetEmail = normaliseEmail(email);
    return Array.from(store.users.values()).filter((currentUser) =>
      typeof currentUser.email === "string" &&
      normaliseEmail(currentUser.email) === targetEmail
    );
  }

  try {
    const database = getRequiredDatabase();
    return await database.select().from(user).where(eq(user.email, email));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get user by email"
    );
  }
}

function getInMemoryPlaintextPassword(email: string): string | undefined {
  if (!isTestEnvironment()) {
    return undefined;
  }

  const store = getInMemoryStore();
  const targetEmail = normaliseEmail(email);

  /** Fast-path lookups using the normalised email key. */
  const directLookup = store.userPlaintextByEmail.get(targetEmail);
  if (typeof directLookup === "string" && directLookup.length > 0) {
    return directLookup;
  }

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
}

export function getTestUserPlaintextPassword(email: string): string | undefined {
  return getInMemoryPlaintextPassword(email);
}

export async function createUser(email: string, password: string) {
  if (isTestEnvironment()) {
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
    const database = getRequiredDatabase();
    return await database.insert(user).values({
      email,
      password: hashedPassword,
    });
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to create user");
  }
}

export async function createGuestUser() {
  if (isTestEnvironment()) {
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
    const database = getRequiredDatabase();
    return await database.insert(user).values({ email, password }).returning({
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
  if (isTestEnvironment()) {
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
    const database = getRequiredDatabase();
    return await database.insert(chat).values({
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
  if (isTestEnvironment()) {
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
    const database = getRequiredDatabase();
    await database.delete(vote).where(eq(vote.chatId, id));
    await database.delete(message).where(eq(message.chatId, id));
    await database.delete(stream).where(eq(stream.chatId, id));

    const [chatsDeleted] = await database
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
  if (isTestEnvironment()) {
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

    const database = getRequiredDatabase();

    const query = (whereCondition?: SQL<any>) =>
      database
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
      const [selectedChat] = await database
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
      const [selectedChat] = await database
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
  if (isTestEnvironment()) {
    const store = getInMemoryStore();
    return store.chats.get(id) ?? null;
  }

  try {
    const database = getRequiredDatabase();
    const [selectedChat] = await database
      .select()
      .from(chat)
      .where(eq(chat.id, id));
    if (!selectedChat) {
      return null;
    }

    return selectedChat;
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to get chat by id");
  }
}

export async function saveMessages({ messages }: { messages: DBMessage[] }) {
  if (isTestEnvironment()) {
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
    const database = getRequiredDatabase();
    return await database.insert(message).values(messages);
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to save messages");
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  if (isTestEnvironment()) {
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
    const database = getRequiredDatabase();
    return await database
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
  if (isTestEnvironment()) {
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
    const database = getRequiredDatabase();
    const [existingVote] = await database
      .select()
      .from(vote)
      .where(and(eq(vote.messageId, messageId)));

    if (existingVote) {
      return await database
        .update(vote)
        .set({ isUpvoted: type === "up" })
        .where(and(eq(vote.messageId, messageId), eq(vote.chatId, chatId)));
    }
    return await database.insert(vote).values({
      chatId,
      messageId,
      isUpvoted: type === "up",
    });
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to vote message");
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  if (isTestEnvironment()) {
    const store = getInMemoryStore();
    return Array.from(store.votes.values()).filter(
      (voteRecord) => voteRecord.chatId === id
    );
  }

  try {
    const database = getRequiredDatabase();
    return await database.select().from(vote).where(eq(vote.chatId, id));
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
  if (isTestEnvironment()) {
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
    const database = getRequiredDatabase();
    return await database
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
  if (isTestEnvironment()) {
    const store = getInMemoryStore();
    const documents = store.documents.get(id) ?? [];
    return [...documents].sort(
      (first, second) => first.createdAt.getTime() - second.createdAt.getTime()
    );
  }

  try {
    const database = getRequiredDatabase();
    const documents = await database
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
  if (isTestEnvironment()) {
    const store = getInMemoryStore();
    const documents = store.documents.get(id) ?? [];
    return documents.at(-1);
  }

  try {
    const database = getRequiredDatabase();
    const [selectedDocument] = await database
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
  if (isTestEnvironment()) {
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
    const database = getRequiredDatabase();

    await database
      .delete(suggestion)
      .where(
        and(
          eq(suggestion.documentId, id),
          gt(suggestion.documentCreatedAt, timestamp)
        )
      );

    return await database
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
  if (isTestEnvironment()) {
    const store = getInMemoryStore();
    for (const suggestionRecord of suggestions) {
      const records = store.suggestions.get(suggestionRecord.documentId) ?? [];
      records.push(suggestionRecord);
      store.suggestions.set(suggestionRecord.documentId, records);
    }

    return;
  }

  try {
    const database = getRequiredDatabase();
    return await database.insert(suggestion).values(suggestions);
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
  if (isTestEnvironment()) {
    const store = getInMemoryStore();
    return [...(store.suggestions.get(documentId) ?? [])];
  }

  try {
    const database = getRequiredDatabase();
    return await database
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
  if (isTestEnvironment()) {
    const store = getInMemoryStore();
    const messageRecord = store.messages.get(id);
    return messageRecord ? [messageRecord] : [];
  }

  try {
    const database = getRequiredDatabase();
    return await database.select().from(message).where(eq(message.id, id));
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
  excludeMessageId,
}: {
  chatId: string;
  timestamp: Date;
  excludeMessageId?: string;
}) {
  if (isTestEnvironment()) {
    const store = getInMemoryStore();
    const cutoff = timestamp.getTime();
    const messagesToDelete = Array.from(store.messages.values()).filter(
      (messageRecord) => {
        const createdAt = new Date(messageRecord.createdAt).getTime();

        return (
          messageRecord.chatId === chatId &&
          createdAt >= cutoff &&
          messageRecord.id !== excludeMessageId
        );
      }
    );

    for (const messageRecord of messagesToDelete) {
      store.messages.delete(messageRecord.id);
      store.votes.delete(makeVoteKey(chatId, messageRecord.id));
    }

    return;
  }

  try {
    const database = getRequiredDatabase();
    const conditions = [
      eq(message.chatId, chatId),
      gte(message.createdAt, timestamp),
    ];

    if (excludeMessageId) {
      conditions.push(ne(message.id, excludeMessageId));
    }

    const messagesToDelete = await database
      .select({ id: message.id })
      .from(message)
      .where(and(...conditions));

    const messageIds = messagesToDelete.map(
      (currentMessage) => currentMessage.id
    );

    if (messageIds.length > 0) {
      await database
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds))
        );

      return await database
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

export async function updateMessagePartsById({
  id,
  parts,
  attachments,
}: {
  id: string;
  parts: ChatMessage["parts"];
  attachments?: Attachment[];
}) {
  const resolvedAttachments = Array.isArray(attachments) ? attachments : [];

  if (isTestEnvironment()) {
    const store = getInMemoryStore();
    const existingMessage = store.messages.get(id);

    if (!existingMessage) {
      return;
    }

    const updatedRecord: DBMessage = {
      ...existingMessage,
      parts,
      attachments: resolvedAttachments,
    };

    store.messages.set(id, updatedRecord);

    return;
  }

  try {
    const database = getRequiredDatabase();
    const updatePayload: Partial<typeof message.$inferInsert> = {
      parts,
      attachments: resolvedAttachments,
    };

    await database
      .update(message)
      .set(updatePayload)
      .where(eq(message.id, id));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to update message parts"
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
  if (isTestEnvironment()) {
    const store = getInMemoryStore();
    const chatRecord = store.chats.get(chatId);
    if (chatRecord) {
      store.chats.set(chatId, { ...chatRecord, visibility });
    }

    return;
  }

  try {
    const database = getRequiredDatabase();
    return await database
      .update(chat)
      .set({ visibility })
      .where(eq(chat.id, chatId));
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
  if (isTestEnvironment()) {
    const store = getInMemoryStore();
    const chatRecord = store.chats.get(chatId);
    if (chatRecord) {
      store.chats.set(chatId, { ...chatRecord, lastContext: context });
    }

    return;
  }

  try {
    const database = getRequiredDatabase();

    return await database
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
  if (isTestEnvironment()) {
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

    const database = getRequiredDatabase();
    const [stats] = await database
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
  if (isTestEnvironment()) {
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
    const database = getRequiredDatabase();

    await database
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
  if (isTestEnvironment()) {
    const store = getInMemoryStore();
    const streams = store.streams.get(chatId) ?? [];
    return streams.map(({ id }) => id);
  }

  try {
    const database = getRequiredDatabase();
    const streamIds = await database
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

  if (isTestEnvironment()) {
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
    const database = getRequiredDatabase();
    const [record] = await database
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

  if (isTestEnvironment()) {
    const store = getInMemoryStore();
    const key = makeAssetKey(normalisedSymbol, normalisedExchange);
    const assetId = store.assetsBySymbolExchange.get(key);
    return assetId ? store.assets.get(assetId) ?? null : null;
  }

  try {
    const database = getRequiredDatabase();
    const [record] = await database
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
  if (isTestEnvironment()) {
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
    const database = getRequiredDatabase();
    const [record] = await database
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
  if (isTestEnvironment()) {
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
    const database = getRequiredDatabase();
    const [record] = await database
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
  if (isTestEnvironment()) {
    const store = getInMemoryStore();

    // Mirror the production unique index so the in-memory Playwright database
    // behaves consistently during unit tests and local dev runs.
    const hasDuplicateWindow = Array.from(store.backtestRuns.values()).some(
      (existingRun) =>
        existingRun.assetId === input.assetId &&
        existingRun.timeframe === input.timeframe &&
        existingRun.periodStart.getTime() === input.periodStart.getTime() &&
        existingRun.periodEnd.getTime() === input.periodEnd.getTime() &&
        existingRun.strategyVersionId === input.strategyVersionId,
    );

    if (hasDuplicateWindow) {
      throw new ChatSDKError(
        "bad_request:database",
        "Backtest run already exists for this strategy window",
      );
    }

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
    const database = getRequiredDatabase();
    const [record] = await database
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
  if (isTestEnvironment()) {
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
    const database = getRequiredDatabase();
    const rows = await database
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
  if (isTestEnvironment()) {
    const store = getInMemoryStore();
    const record = store.financePreferences.get(userId) ?? null;
    return record ? cloneFinancePreference(record) : null;
  }

  try {
    const database = getRequiredDatabase();
    const [record] = await database
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

  if (isTestEnvironment()) {
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
    const database = getRequiredDatabase();
    const [record] = await database
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
