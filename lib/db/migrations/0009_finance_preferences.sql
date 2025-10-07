-- Idempotent guard so the preference table can be provisioned multiple times
-- without failing when pipelines rerun the migration.
CREATE TABLE IF NOT EXISTS "FinancePreference" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "userId" uuid NOT NULL,
  "markets" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "indicators" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "explanationLevel" varchar(16) NOT NULL DEFAULT 'standard',
  "showNews" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "FinancePreference_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "FinancePreference_user_unique" ON "FinancePreference" ("userId");
