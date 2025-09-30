CREATE TABLE "Asset" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "symbol" varchar(32) NOT NULL,
  "type" varchar NOT NULL DEFAULT 'equity',
  "name" text NOT NULL,
  "exchange" varchar(32) NOT NULL,
  "currency" varchar(16) NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "Asset_symbol_exchange_unique" ON "Asset" ("symbol", "exchange");
CREATE INDEX "Asset_exchange_idx" ON "Asset" ("exchange");
CREATE INDEX "Asset_type_idx" ON "Asset" ("type");

CREATE TABLE "Watchlist" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "userId" uuid NOT NULL,
  "name" text NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "Watchlist_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX "Watchlist_user_idx" ON "Watchlist" ("userId");

CREATE TABLE "WatchlistItem" (
  "watchlistId" uuid NOT NULL,
  "assetId" uuid NOT NULL,
  "note" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "WatchlistItem_watchlistId_assetId_pk" PRIMARY KEY ("watchlistId", "assetId"),
  CONSTRAINT "WatchlistItem_watchlistId_Watchlist_id_fk" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist"("id") ON DELETE CASCADE,
  CONSTRAINT "WatchlistItem_assetId_Asset_id_fk" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE
);

CREATE INDEX "WatchlistItem_asset_idx" ON "WatchlistItem" ("assetId");

CREATE TABLE "Strategy" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "userId" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "Strategy_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX "Strategy_user_idx" ON "Strategy" ("userId");

CREATE TABLE "StrategyVersion" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "strategyId" uuid NOT NULL,
  "params" jsonb NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "StrategyVersion_strategyId_Strategy_id_fk" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE
);

CREATE INDEX "StrategyVersion_strategy_idx" ON "StrategyVersion" ("strategyId");

CREATE TABLE "BacktestRun" (
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

CREATE INDEX "BacktestRun_asset_tf_start_idx" ON "BacktestRun" ("assetId", "timeframe", "periodStart");
CREATE INDEX "BacktestRun_strategyVersion_idx" ON "BacktestRun" ("strategyVersionId");

CREATE TABLE "IndicatorConfig" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "userId" uuid NOT NULL,
  "name" text NOT NULL,
  "spec" jsonb NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "IndicatorConfig_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX "IndicatorConfig_user_idx" ON "IndicatorConfig" ("userId");

CREATE TABLE "NewsItemCache" (
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

CREATE INDEX "NewsItemCache_asset_published_idx" ON "NewsItemCache" ("assetId", "publishedAt");
CREATE UNIQUE INDEX "NewsItemCache_asset_url_unique" ON "NewsItemCache" ("assetId", "url");

ALTER TABLE "Message_v2" ADD COLUMN "artifacts" jsonb NOT NULL DEFAULT '[]'::jsonb;
