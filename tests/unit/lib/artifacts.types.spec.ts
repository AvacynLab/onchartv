import { describe, expect, it } from "vitest";

/**
 * Tests covering the discriminated union that shapes persisted finance
 * artefacts. Keeping the schema well defined is critical for deterministic
 * hydration in the chat UI and for guaranteeing that migrations remain
 * backwards compatible.
 */

import {
  financeMessageArtifactSchema,
  unwrapFinanceArtifact,
} from "@/lib/artifacts/types";
import { financeChartArtifactSchema } from "@/lib/finance/types";

describe("financeMessageArtifactSchema", () => {
  it("valide un artefact finance persistant complet", () => {
    const payload = financeChartArtifactSchema.parse({
      type: "finance.chart",
      symbol: "AAPL",
      timeframe: "1D",
      range: { from: "2024-01-01", to: "2024-02-01" },
      ohlcv: [
        {
          t: 1_704_889_600,
          o: 180,
          h: 184,
          l: 178,
          c: 182,
          v: 1_200_000,
        },
      ],
      overlays: [],
    });

    const parsed = financeMessageArtifactSchema.parse({
      type: payload.type,
      payload,
    });

    expect(parsed.payload.symbol).toBe("AAPL");
  });

  it("rejette un artefact dont le type ne correspond pas au payload", () => {
    const result = financeMessageArtifactSchema.safeParse({
      type: "finance.news",
      payload: {
        type: "finance.chart",
        symbol: "AAPL",
        timeframe: "1D",
        range: { from: "2024-01-01", to: "2024-02-01" },
        ohlcv: [],
        overlays: [],
      },
    });

    expect(result.success).toBe(false);
  });

  it("retourne null lorsque le wrapper ne correspond pas au schéma", () => {
    const payload = financeChartArtifactSchema.parse({
      type: "finance.chart",
      symbol: "NVDA",
      timeframe: "1H",
      range: { from: "2024-03-01", to: "2024-03-15" },
      ohlcv: [],
      overlays: [],
    });

    expect(
      unwrapFinanceArtifact({
        type: "finance.chart",
        payload,
      })
    ).toEqual(payload);

    expect(
      unwrapFinanceArtifact({
        type: "finance.chart",
        payload: { ...payload, symbol: undefined },
      } as unknown as Parameters<typeof unwrapFinanceArtifact>[0])
    ).toBeNull();
  });
});
