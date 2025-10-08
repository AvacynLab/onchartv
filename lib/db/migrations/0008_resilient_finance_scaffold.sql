-- Adding IF NOT EXISTS to every DDL statement keeps the migration idempotent
-- so rerunning `db:migrate` in CI or during local bootstrap never errors even
-- when the finance schema is already provisioned.
CREATE TABLE IF NOT EXISTS "Asset" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "symbol" varchar(32) NOT NULL,
  "type" varchar NOT NULL DEFAULT 'equity',
  "name" text NOT NULL,
  "exchange" varchar(32) NOT NULL,
  "currency" varchar(16) NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "Asset_symbol_exchange_unique" ON "Asset" ("symbol", "exchange");
CREATE INDEX IF NOT EXISTS "Asset_exchange_idx" ON "Asset" ("exchange");
CREATE INDEX IF NOT EXISTS "Asset_type_idx" ON "Asset" ("type");

CREATE TABLE IF NOT EXISTS "Watchlist" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "userId" uuid NOT NULL,
  "name" text NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "Watchlist_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "Watchlist_user_idx" ON "Watchlist" ("userId");

CREATE TABLE IF NOT EXISTS "WatchlistItem" (
  "watchlistId" uuid NOT NULL,
  "assetId" uuid NOT NULL,
  "note" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "WatchlistItem_watchlistId_assetId_pk" PRIMARY KEY ("watchlistId", "assetId"),
  CONSTRAINT "WatchlistItem_watchlistId_Watchlist_id_fk" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist"("id") ON DELETE CASCADE,
  CONSTRAINT "WatchlistItem_assetId_Asset_id_fk" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "WatchlistItem_asset_idx" ON "WatchlistItem" ("assetId");

CREATE TABLE IF NOT EXISTS "Strategy" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "userId" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "Strategy_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "Strategy_user_idx" ON "Strategy" ("userId");

CREATE TABLE IF NOT EXISTS "StrategyVersion" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "strategyId" uuid NOT NULL,
  "params" jsonb NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "StrategyVersion_strategyId_Strategy_id_fk" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "StrategyVersion_strategy_idx" ON "StrategyVersion" ("strategyId");

CREATE TABLE IF NOT EXISTS "BacktestRun" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "strategyVersionId" uuid NOT NULL,
  "assetId" uuid NOT NULL,
  "timeframe" varchar(16) NOT NULL,
  "periodStart" timestamp NOT NULL,
  "periodEnd" timestamp NOT NULL,
  "metrics" jsonb NOT NULL,
  "trades" jsonb NOT NULL,
  "equityCurve" jsonb NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "BacktestRun_strategyVersionId_StrategyVersion_id_fk" FOREIGN KEY ("strategyVersionId") REFERENCES "StrategyVersion"("id") ON DELETE CASCADE,
  CONSTRAINT "BacktestRun_assetId_Asset_id_fk" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS "BacktestRun_asset_timeframe_period_idx" ON "BacktestRun" ("assetId", "timeframe", "periodStart");
CREATE INDEX IF NOT EXISTS "BacktestRun_strategyVersion_idx" ON "BacktestRun" ("strategyVersionId");

CREATE TABLE IF NOT EXISTS "IndicatorConfig" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "userId" uuid NOT NULL,
  "name" text NOT NULL,
  "spec" jsonb NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "IndicatorConfig_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "IndicatorConfig_user_idx" ON "IndicatorConfig" ("userId");

CREATE TABLE IF NOT EXISTS "NewsItemCache" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "assetId" uuid NOT NULL,
  "source" varchar(64) NOT NULL,
  "title" text NOT NULL,
  "url" text NOT NULL,
  "publishedAt" timestamp NOT NULL,
  "summary" text,
  "sentiment" varchar NOT NULL DEFAULT 'neutral',
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "NewsItemCache_assetId_Asset_id_fk" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "NewsItemCache_asset_published_idx" ON "NewsItemCache" ("assetId", "publishedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "NewsItemCache_asset_url_unique" ON "NewsItemCache" ("assetId", "url");

ALTER TABLE "Message_v2" ADD COLUMN IF NOT EXISTS "artifacts" jsonb NOT NULL DEFAULT '[]'::jsonb;
