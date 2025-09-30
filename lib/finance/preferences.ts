import { z } from "zod";

/**
 * Enumerates the supported market universes. Using stable identifiers keeps the
 * persisted preferences resilient to localisation changes in the UI while still
 * allowing human-friendly labels when rendering the settings form.
 */
export const FINANCE_MARKET_IDS = [
  "US_EQUITIES",
  "CRYPTO",
  "FOREX",
] as const;

/** Mapping between the identifier and the label presented in the UI. */
export const FINANCE_MARKET_OPTIONS: ReadonlyArray<{
  readonly id: (typeof FINANCE_MARKET_IDS)[number];
  readonly label: string;
}> = [
  { id: "US_EQUITIES", label: "Actions américaines" },
  { id: "CRYPTO", label: "Crypto-actifs" },
  { id: "FOREX", label: "Forex majeur" },
];

/** Supported indicator presets exposed in the settings view. */
export const FINANCE_INDICATOR_TYPES = [
  "sma",
  "ema",
  "rsi",
  "bollinger",
] as const;

/** Explanation depth options consumed by the assistant when generating reports. */
export const FINANCE_EXPLANATION_LEVELS = [
  "concise",
  "standard",
  "detailed",
] as const;

/**
 * Settings persisted for each indicator preset. Length/period fields depend on
 * the indicator type but remain optional in the schema to keep the JSON column
 * flexible. Validation guards enforce the required fields downstream.
 */
export interface FinanceIndicatorPreference {
  readonly type: (typeof FINANCE_INDICATOR_TYPES)[number];
  readonly length?: number;
  readonly period?: number;
  readonly standardDeviations?: number;
}

/** JSON payload persisted per user in the finance preferences table. */
export interface FinancePreferences {
  readonly markets: ReadonlyArray<(typeof FINANCE_MARKET_IDS)[number]>;
  readonly defaultIndicators: ReadonlyArray<FinanceIndicatorPreference>;
  readonly explanationLevel: (typeof FINANCE_EXPLANATION_LEVELS)[number];
  readonly showNews: boolean;
}

/**
 * Zod schema shared by the API route and the settings component. The schema
 * ensures the payload matches what the downstream artefact pipeline expects and
 * keeps validation errors user friendly.
 */
export const financePreferencesSchema = z
  .object({
    markets: z
      .array(z.enum(FINANCE_MARKET_IDS))
      .min(1, "Sélectionne au moins un univers de marché."),
    defaultIndicators: z
      .array(
        z
          .object({
            type: z.enum(FINANCE_INDICATOR_TYPES),
            length: z.number().int().min(1).max(500).optional(),
            period: z.number().int().min(1).max(500).optional(),
            standardDeviations: z.number().min(0.5).max(6).optional(),
          })
          .superRefine((value, ctx) => {
            if (value.type === "rsi" && typeof value.period !== "number") {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "RSI requiert une période.",
              });
            }

            if (
              (value.type === "sma" || value.type === "ema") &&
              typeof value.length !== "number"
            ) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "SMA et EMA requièrent une longueur.",
              });
            }

            if (
              value.type === "bollinger" &&
              (typeof value.length !== "number" ||
                typeof value.standardDeviations !== "number")
            ) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Bollinger requiert longueur et écart-type.",
              });
            }
          })
      )
      .max(8, "Limite 8 indicateurs par défaut."),
    explanationLevel: z.enum(FINANCE_EXPLANATION_LEVELS),
    showNews: z.boolean(),
  })
  .transform((value) => {
    const uniqueMarkets = Array.from(new Set(value.markets));
    return {
      ...value,
      markets: uniqueMarkets,
    } satisfies FinancePreferences;
  });

/**
 * Deterministic defaults used for new accounts and for tests. Keeping the
 * structure immutable prevents accidental mutations leaking between renders.
 */
export const DEFAULT_FINANCE_PREFERENCES: FinancePreferences = Object.freeze({
  markets: Object.freeze(["US_EQUITIES", "CRYPTO"] as const),
  defaultIndicators: Object.freeze([
    Object.freeze({ type: "sma" as const, length: 50 }),
    Object.freeze({ type: "sma" as const, length: 200 }),
    Object.freeze({ type: "rsi" as const, period: 14 }),
    Object.freeze({ type: "bollinger" as const, length: 20, standardDeviations: 2 }),
  ]),
  explanationLevel: "standard",
  showNews: true,
});

export type FinancePreferencesInput = z.input<typeof financePreferencesSchema>;
export type FinancePreferencesOutput = z.output<typeof financePreferencesSchema>;
