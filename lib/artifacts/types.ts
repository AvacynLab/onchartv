import { z } from "zod";

import {
  financeBacktestArtifactSchema,
  financeChartAnnotationsArtifactSchema,
  financeChartArtifactSchema,
  financeFundamentalsArtifactSchema,
  financeNewsArtifactSchema,
  financeScreenArtifactSchema,
  type FinanceArtifact,
} from "@/lib/finance/types";

/**
 * Wraps a finance artefact schema into the persisted message structure. Each
 * artefact stored in the database carries a top-level discriminator so the UI
 * can load the appropriate renderer without guessing the payload type.
 */
function wrapFinanceArtifactSchema<
  Schema extends z.ZodObject<{ type: z.ZodLiteral<string> }>
>(schema: Schema) {
  return z.object({
    type: schema.shape.type,
    /**
     * Serialized finance artefact payload. The nested schema enforces the
     * documented structure (e.g. backtest metrics, OHLC candles).
     */
    payload: schema,
  });
}

const financeMessageArtifactSchemas = [
  wrapFinanceArtifactSchema(financeChartArtifactSchema),
  wrapFinanceArtifactSchema(financeChartAnnotationsArtifactSchema),
  wrapFinanceArtifactSchema(financeFundamentalsArtifactSchema),
  wrapFinanceArtifactSchema(financeNewsArtifactSchema),
  wrapFinanceArtifactSchema(financeBacktestArtifactSchema),
  wrapFinanceArtifactSchema(financeScreenArtifactSchema),
] as const;

/**
 * Discriminated union describing every finance artefact persisted alongside
 * assistant messages. Using the `type` discriminator keeps runtime guards
 * straightforward while allowing TypeScript to infer precise payload shapes via
 * `z.infer`.
 */
export const financeMessageArtifactSchema = z.discriminatedUnion(
  "type",
  financeMessageArtifactSchemas
);

/** All finance artefacts saved in `Message_v2.artifacts`. */
export type FinanceMessageArtifact = z.infer<typeof financeMessageArtifactSchema>;

/**
 * Union of every artefact supported by the messaging pipeline. At the moment we
 * only persist finance artefacts but keeping a separate export makes it easier
 * to extend the union once new kinds (e.g. design previews) ship.
 */
export const messageArtifactSchema = financeMessageArtifactSchema;

export type MessageArtifact = z.infer<typeof messageArtifactSchema>;

/**
 * Runtime helper that extracts the nested finance payload from a persisted
 * artefact. Returning `null` keeps callers in control of the fallback UI when
 * the stored payload no longer matches the documented schema.
 */
export function unwrapFinanceArtifact(
  artifact: MessageArtifact
): FinanceArtifact | null {
  const parsed = financeMessageArtifactSchema.safeParse(artifact);

  if (!parsed.success) {
    return null;
  }

  return parsed.data.payload;
}
