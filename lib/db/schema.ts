import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
  boolean,
  index,
  foreignKey,
  json,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { AppUsage } from "../usage";
import type {
  FinanceIndicatorPreference,
  FinancePreferences,
} from "../finance/preferences";

export const user = pgTable("User", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  email: varchar("email", { length: 64 }).notNull(),
  password: varchar("password", { length: 64 }),
});

export type User = InferSelectModel<typeof user>;

export const chat = pgTable("Chat", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  createdAt: timestamp("createdAt").notNull(),
  title: text("title").notNull(),
  userId: uuid("userId")
    .notNull()
    .references(() => user.id),
  visibility: varchar("visibility", { enum: ["public", "private"] })
    .notNull()
    .default("private"),
  lastContext: jsonb("lastContext").$type<AppUsage | null>(),
});

export type Chat = InferSelectModel<typeof chat>;

// DEPRECATED: The following schema is deprecated and will be removed in the future.
// Read the migration guide at https://chat-sdk.dev/docs/migration-guides/message-parts
export const messageDeprecated = pgTable("Message", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  chatId: uuid("chatId")
    .notNull()
    .references(() => chat.id),
  role: varchar("role").notNull(),
  content: json("content").notNull(),
  createdAt: timestamp("createdAt").notNull(),
});

export type MessageDeprecated = InferSelectModel<typeof messageDeprecated>;

/**
 * Structured payload describing artefacts persisted alongside assistant
 * messages. Artefacts cover finance charts, backtests, fundamentals, and other
 * rich visualisations streamed through the agent pipeline.
 */
export interface MessageArtifact {
  /** Identifier consumed by the UI renderer (e.g. `finance.chart`). */
  readonly type: string;
  /** JSON-serialisable payload containing the artefact data. */
  readonly payload: unknown;
}

export const message = pgTable("Message_v2", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  chatId: uuid("chatId")
    .notNull()
    .references(() => chat.id),
  role: varchar("role").notNull(),
  parts: json("parts").notNull(),
  attachments: json("attachments").notNull(),
  artifacts: jsonb("artifacts")
    .$type<MessageArtifact[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  createdAt: timestamp("createdAt").notNull(),
});

export type DBMessage = InferSelectModel<typeof message>;

// DEPRECATED: The following schema is deprecated and will be removed in the future.
// Read the migration guide at https://chat-sdk.dev/docs/migration-guides/message-parts
export const voteDeprecated = pgTable(
  "Vote",
  {
    chatId: uuid("chatId")
      .notNull()
      .references(() => chat.id),
    messageId: uuid("messageId")
      .notNull()
      .references(() => messageDeprecated.id),
    isUpvoted: boolean("isUpvoted").notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.chatId, table.messageId] }),
    };
  }
);

export type VoteDeprecated = InferSelectModel<typeof voteDeprecated>;

export const vote = pgTable(
  "Vote_v2",
  {
    chatId: uuid("chatId")
      .notNull()
      .references(() => chat.id),
    messageId: uuid("messageId")
      .notNull()
      .references(() => message.id),
    isUpvoted: boolean("isUpvoted").notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.chatId, table.messageId] }),
    };
  }
);

export type Vote = InferSelectModel<typeof vote>;

export const document = pgTable(
  "Document",
  {
    id: uuid("id").notNull().defaultRandom(),
    createdAt: timestamp("createdAt").notNull(),
    title: text("title").notNull(),
    content: text("content"),
    kind: varchar("text", { enum: ["text", "code", "image", "sheet"] })
      .notNull()
      .default("text"),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.id, table.createdAt] }),
    };
  }
);

export type Document = InferSelectModel<typeof document>;

export const suggestion = pgTable(
  "Suggestion",
  {
    id: uuid("id").notNull().defaultRandom(),
    documentId: uuid("documentId").notNull(),
    documentCreatedAt: timestamp("documentCreatedAt").notNull(),
    originalText: text("originalText").notNull(),
    suggestedText: text("suggestedText").notNull(),
    description: text("description"),
    isResolved: boolean("isResolved").notNull().default(false),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id] }),
    documentRef: foreignKey({
      columns: [table.documentId, table.documentCreatedAt],
      foreignColumns: [document.id, document.createdAt],
    }),
  })
);

export type Suggestion = InferSelectModel<typeof suggestion>;

export const stream = pgTable(
  "Stream",
  {
    id: uuid("id").notNull().defaultRandom(),
    chatId: uuid("chatId").notNull(),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id] }),
    chatRef: foreignKey({
      columns: [table.chatId],
      foreignColumns: [chat.id],
    }),
  })
);

export type Stream = InferSelectModel<typeof stream>;

/** Canonical catalogue of supported financial instruments. */
export const asset = pgTable(
  "Asset",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    symbol: varchar("symbol", { length: 32 }).notNull(),
    type: varchar("type", {
      enum: ["equity", "crypto", "fx", "etf", "index", "commodity"],
    })
      .notNull()
      .default("equity"),
    name: text("name").notNull(),
    exchange: varchar("exchange", { length: 32 }).notNull(),
    currency: varchar("currency", { length: 16 }).notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    symbolExchangeUnique: uniqueIndex("Asset_symbol_exchange_unique").on(
      table.symbol,
      table.exchange,
    ),
    exchangeIdx: index("Asset_exchange_idx").on(table.exchange),
    typeIdx: index("Asset_type_idx").on(table.type),
  })
);

export type Asset = InferSelectModel<typeof asset>;

/** User-defined collections of assets surfaced inside the UI. */
export const watchlist = pgTable(
  "Watchlist",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("Watchlist_user_idx").on(table.userId),
  })
);

export type Watchlist = InferSelectModel<typeof watchlist>;

/** Join table linking assets to watchlists with optional user notes. */
export const watchlistItem = pgTable(
  "WatchlistItem",
  {
    watchlistId: uuid("watchlistId")
      .notNull()
      .references(() => watchlist.id, { onDelete: "cascade" }),
    assetId: uuid("assetId")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    note: text("note"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.watchlistId, table.assetId] }),
    assetIdx: index("WatchlistItem_asset_idx").on(table.assetId),
  })
);

export type WatchlistItem = InferSelectModel<typeof watchlistItem>;

/** High level strategy metadata authored by each user. */
export const strategy = pgTable(
  "Strategy",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("Strategy_user_idx").on(table.userId),
  })
);

export type Strategy = InferSelectModel<typeof strategy>;

/** Immutable snapshot of a strategy configuration used by backtests. */
export const strategyVersion = pgTable(
  "StrategyVersion",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    strategyId: uuid("strategyId")
      .notNull()
      .references(() => strategy.id, { onDelete: "cascade" }),
    params: jsonb("params").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    strategyIdx: index("StrategyVersion_strategy_idx").on(table.strategyId),
  })
);

export type StrategyVersion = InferSelectModel<typeof strategyVersion>;

/** Persisted outcome of a backtest execution. */
export const backtestRun = pgTable(
  "BacktestRun",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    strategyVersionId: uuid("strategyVersionId")
      .notNull()
      .references(() => strategyVersion.id, { onDelete: "cascade" }),
    assetId: uuid("assetId")
      .notNull()
      .references(() => asset.id, { onDelete: "restrict" }),
    timeframe: varchar("timeframe", { length: 16 }).notNull(),
    periodStart: timestamp("periodStart").notNull(),
    periodEnd: timestamp("periodEnd").notNull(),
    metrics: jsonb("metrics").notNull(),
    trades: jsonb("trades").notNull(),
    equityCurve: jsonb("equityCurve").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    assetTimeframePeriodIdx: index("BacktestRun_asset_tf_start_idx").on(
      table.assetId,
      table.timeframe,
      table.periodStart,
    ),
    strategyVersionIdx: index("BacktestRun_strategyVersion_idx").on(
      table.strategyVersionId,
    ),
  })
);

export type BacktestRun = InferSelectModel<typeof backtestRun>;

/** User-specific indicator presets mirrored in the UI. */
export const indicatorConfig = pgTable(
  "IndicatorConfig",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    spec: jsonb("spec").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("IndicatorConfig_user_idx").on(table.userId),
  })
);

export type IndicatorConfig = InferSelectModel<typeof indicatorConfig>;

/**
 * Cache storing deterministic news snippets to keep the application offline
 * friendly during automated tests.
 */
export const newsItemCache = pgTable(
  "NewsItemCache",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    assetId: uuid("assetId")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 64 }).notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    publishedAt: timestamp("publishedAt").notNull(),
    summary: text("summary"),
    sentiment: varchar("sentiment", { enum: ["positive", "neutral", "negative"] })
      .notNull()
      .default("neutral"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    assetPublishedIdx: index("NewsItemCache_asset_published_idx").on(
      table.assetId,
      table.publishedAt,
    ),
    assetUrlUnique: uniqueIndex("NewsItemCache_asset_url_unique").on(
      table.assetId,
      table.url,
    ),
  })
);

export type NewsItemCache = InferSelectModel<typeof newsItemCache>;

/**
 * User-level finance preferences controlling default markets, indicators, and
 * disclosure depth used by the assistant when generating artefacts.
 */
export const financePreference = pgTable(
  "FinancePreference",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    markets: jsonb("markets")
      .$type<FinancePreferences["markets"]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    indicators: jsonb("indicators")
      .$type<ReadonlyArray<FinanceIndicatorPreference>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    explanationLevel: varchar("explanationLevel", { length: 16 })
      .$type<FinancePreferences["explanationLevel"]>()
      .notNull()
      .default("standard"),
    showNews: boolean("showNews").notNull().default(true),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (table) => ({
    userUnique: uniqueIndex("FinancePreference_user_unique").on(table.userId),
  })
);

export type FinancePreference = InferSelectModel<typeof financePreference>;
