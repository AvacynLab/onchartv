"use client";

import React from "react";
import type { FinanceScreenArtifact } from "@/lib/finance/types";

/**
 * Simple table summarising the assets returned par le screener hermétique.
 */
export function ScreenResultsCard({
  artifact,
}: {
  readonly artifact: FinanceScreenArtifact;
}) {
  return (
    <div className="space-y-4" data-testid="finance-screen-artifact">
      <header className="flex flex-col gap-1">
        <h3 className="font-semibold text-lg">Résultats du screener</h3>
        <p className="text-muted-foreground text-sm">
          Classement basé sur les filtres fondamentaux demandés.
        </p>
      </header>

      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Symbole</th>
              <th className="px-3 py-2">Market cap</th>
              <th className="px-3 py-2">PE ratio</th>
            </tr>
          </thead>
          <tbody>
            {artifact.results.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-muted-foreground" colSpan={3}>
                  Aucun actif ne correspond aux critères.
                </td>
              </tr>
            ) : (
              artifact.results.map((result) => (
                <tr className="border-t" key={result.symbol}>
                  <td className="px-3 py-2 font-medium">{result.symbol}</td>
                  <td className="px-3 py-2">
                    {result.marketCap.toLocaleString(undefined, {
                      notation: "compact",
                      maximumFractionDigits: 1,
                    })}
                  </td>
                  <td className="px-3 py-2">{result.peRatio.toFixed(1)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
