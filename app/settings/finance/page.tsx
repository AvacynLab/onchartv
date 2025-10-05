import { redirect } from "next/navigation";

import { auth } from "@/app/(auth)/auth";
import { FinanceSettings } from "@/components/settings/finance-settings";
import { isFinanceFeatureEnabled } from "@/lib/feature-flags";

/**
 * Server-rendered entry point for the finance preferences form. The page reuses
 * the existing settings component so Playwright and manual users can toggle
 * artefact behaviour without navigating obscure URLs.
 */
export default async function FinanceSettingsPage() {
  if (!isFinanceFeatureEnabled()) {
    /**
     * Keep finance-specific settings hidden when the feature flag is off to
     * avoid exposing incomplete UI shells. The generic settings dashboard
     * remains available so users can continue configuring other options.
     */
    redirect("/settings");
  }

  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="space-y-2">
        <h1 className="font-semibold text-2xl">Préférences finance</h1>
        <p className="text-muted-foreground text-sm">
          Configure les marchés suivis, les indicateurs par défaut et la
          visibilité des actualités avant d'interroger l'agent.
        </p>
      </header>
      <section className="mt-6">
        <FinanceSettings />
      </section>
    </main>
  );
}
