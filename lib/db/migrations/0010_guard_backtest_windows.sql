-- Ensure backtest runs stay unique per strategy/timeframe window without breaking
-- replays of the migration on already-updated databases.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'BacktestRun_asset_timeframe_period_idx'
  ) THEN
    EXECUTE 'DROP INDEX "BacktestRun_asset_timeframe_period_idx"';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "BacktestRun_asset_timeframe_period_unique"
  ON "BacktestRun" (
    "assetId",
    "timeframe",
    "periodStart",
    "strategyVersionId",
    "periodEnd"
  );
