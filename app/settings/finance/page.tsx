import { redirect } from "next/navigation";

import { FinanceSettings } from "@/components/settings/finance-settings";
import { auth } from "@/app/(auth)/auth";

/**
 * Server-rendered entry point for the finance preferences form. The page reuses
 * the existing settings component so Playwright and manual users can toggle
 * artefact behaviour without navigating obscure URLs.
 */
export default async function FinanceSettingsPage() {
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
