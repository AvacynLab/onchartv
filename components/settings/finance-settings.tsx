"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/toast";
import { isFinanceFeatureEnabledClient } from "@/lib/feature-flags";
import {
  FINANCE_EXPLANATION_LEVELS,
  FINANCE_MARKET_OPTIONS,
  financePreferencesSchema,
  type FinancePreferences,
} from "@/lib/finance/preferences";

interface IndicatorPreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly type: FinancePreferences["defaultIndicators"][number]["type"];
  readonly primaryKey: "length" | "period";
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly defaultPrimary: number;
  readonly secondaryKey?: "standardDeviations";
  readonly secondaryMin?: number;
  readonly secondaryMax?: number;
  readonly defaultSecondary?: number;
}

const INDICATOR_PRESETS: ReadonlyArray<IndicatorPreset> = [
  {
    id: "sma-fast",
    label: "SMA (50)",
    description: "Moyenne mobile simple courte pour capter les impulsions.",
    type: "sma",
    primaryKey: "length",
    min: 2,
    max: 500,
    defaultPrimary: 50,
  },
  {
    id: "sma-slow",
    label: "SMA (200)",
    description: "Moyenne mobile longue utilisée pour le biais de fond.",
    type: "sma",
    primaryKey: "length",
    min: 2,
    max: 500,
    defaultPrimary: 200,
  },
  {
    id: "ema-mid",
    label: "EMA (21)",
    description: "Moyenne mobile exponentielle plus réactive sur swing.",
    type: "ema",
    primaryKey: "length",
    min: 2,
    max: 500,
    defaultPrimary: 21,
  },
  {
    id: "rsi",
    label: "RSI (14)",
    description: "Oscillateur standard pour détecter surachat/survente.",
    type: "rsi",
    primaryKey: "period",
    min: 2,
    max: 100,
    defaultPrimary: 14,
  },
  {
    id: "bollinger",
    label: "Bandes de Bollinger (20 / 2σ)",
    description: "Volatilité et débordements de prix.",
    type: "bollinger",
    primaryKey: "length",
    min: 5,
    max: 200,
    defaultPrimary: 20,
    secondaryKey: "standardDeviations",
    secondaryMin: 1,
    secondaryMax: 4,
    defaultSecondary: 2,
    step: 1,
  },
];

interface MutablePreferences {
  readonly markets: Array<FinancePreferences["markets"][number]>;
  readonly indicators: Record<string, FinancePreferences["defaultIndicators"][number]>;
  /**
   * Mutable bag of indicators the presets do not recognise. Using a plain array
   * (instead of the readonly type exposed by the API) makes it easier to append
   * and remove entries while editing the form.
   */
  readonly extraIndicators: Array<FinancePreferences["defaultIndicators"][number]>;
  readonly explanationLevel: FinancePreferences["explanationLevel"];
  readonly showNews: boolean;
}

const toMutablePreferences = (
  preferences: FinancePreferences
): MutablePreferences => {
  const indicators: MutablePreferences["indicators"] = {};
  const leftovers: Array<FinancePreferences["defaultIndicators"][number]> = [];

  for (const indicator of preferences.defaultIndicators) {
    const preset = INDICATOR_PRESETS.find((candidate) => {
      if (candidate.type !== indicator.type) {
        return false;
      }

      if (
        candidate.primaryKey === "length" &&
        typeof indicator.length === "number"
      ) {
        if (candidate.id === "bollinger") {
          return typeof indicator.standardDeviations === "number";
        }

        return true;
      }

      if (
        candidate.primaryKey === "period" &&
        typeof indicator.period === "number"
      ) {
        return true;
      }

      return false;
    });

    if (preset) {
      indicators[preset.id] = { ...indicator };
    } else {
      leftovers.push({ ...indicator });
    }
  }

  return {
    markets: [...preferences.markets],
    indicators,
    extraIndicators: leftovers,
    explanationLevel: preferences.explanationLevel,
    showNews: preferences.showNews,
  };
};

const toFinancePreferences = (
  state: MutablePreferences
): FinancePreferences => ({
  markets: [...state.markets],
  defaultIndicators: [
    ...Object.values(state.indicators).map((indicator) => ({ ...indicator })),
    ...state.extraIndicators.map((indicator) => ({ ...indicator })),
  ],
  explanationLevel: state.explanationLevel,
  showNews: state.showNews,
});

const deepEqualPreferences = (
  left: MutablePreferences,
  right: MutablePreferences
): boolean => {
  return (
    JSON.stringify(toFinancePreferences(left)) ===
    JSON.stringify(toFinancePreferences(right))
  );
};

export function FinanceSettings(): JSX.Element {
  const financeFeatureEnabled = isFinanceFeatureEnabledClient();

  if (!financeFeatureEnabled) {
    /**
     * Avoid mounting the React Query stack when the finance feature flag is
     * disabled. Returning early keeps the component tree light and prevents
     * accidental requests to `/api/finance/preferences` in restricted
     * environments.
     */
    return (
      <Card data-testid="finance-settings-disabled-flag" role="status">
        <CardHeader>
          <CardTitle>Préférences indisponibles</CardTitle>
          <CardDescription>
            La fonctionnalité finance est désactivée pour cet environnement.
            Activez la variable d’environnement <code>FEATURE_FINANCE</code> pour
            configurer les marchés suivis et les indicateurs par défaut.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const [state, setState] = useState<MutablePreferences | null>(null);
  const [initialState, setInitialState] = useState<MutablePreferences | null>(
    null
  );
  const queryClient = useQueryClient();

  const preferencesQuery = useQuery<FinancePreferences, Error>({
    queryKey: ["finance", "preferences"],
    /**
     * Fetches the persisted finance preferences using the same validation
     * schema as the API handler to guarantee symmetry across client and server.
     */
    queryFn: async () => {
      const response = await fetch("/api/finance/preferences", {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Requête échouée (${response.status})`);
      }

      const payload = (await response.json()) as {
        preferences: FinancePreferences;
      };

      const validation = financePreferencesSchema.safeParse(payload.preferences);

      if (!validation.success) {
        throw new Error("Réponse invalide reçue depuis l'API finance.");
      }

      return validation.data;
    },
  });

  useEffect(() => {
    if (!preferencesQuery.data) {
      return;
    }

    const next = toMutablePreferences(preferencesQuery.data);

    setState((current) => {
      if (current && deepEqualPreferences(current, next)) {
        return current;
      }

      return next;
    });

    setInitialState((current) => {
      if (current && deepEqualPreferences(current, next)) {
        return current;
      }

      return next;
    });
  }, [preferencesQuery.data]);

  useEffect(() => {
    if (preferencesQuery.isError) {
      console.error("[FinanceSettings] fetch failed", preferencesQuery.error);
    }
  }, [preferencesQuery.isError, preferencesQuery.error]);

  const fetchErrorMessage =
    preferencesQuery.isError
      ? preferencesQuery.error?.message && preferencesQuery.error.message.length > 0
        ? preferencesQuery.error.message
        : "Impossible de charger les préférences."
      : null;

  const saveMutation = useMutation<FinancePreferences, Error, FinancePreferences>({
    /**
     * Persists the updated preferences and reuses the validation schema to
     * guarantee we only cache structurally sound payloads in the query client.
     */
    mutationFn: async (preferences) => {
      const response = await fetch("/api/finance/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });

      if (!response.ok) {
        throw new Error(`Sauvegarde impossible (${response.status})`);
      }

      const payload = (await response.json()) as { preferences: FinancePreferences };
      const validation = financePreferencesSchema.safeParse(payload.preferences);

      if (!validation.success) {
        throw new Error("Réponse invalide reçue depuis l'API finance.");
      }

      return validation.data;
    },
    onSuccess: (preferences) => {
      const mutable = toMutablePreferences(preferences);
      setState(mutable);
      setInitialState(mutable);
      queryClient.setQueryData(["finance", "preferences"], preferences);
      toast({
        type: "success",
        description: "Préférences enregistrées.",
      });
    },
    onError: (err) => {
      console.error("[FinanceSettings] save failed", err);
      toast({
        type: "error",
        description:
          err.message && err.message.length > 0
            ? err.message
            : "Une erreur est survenue lors de la sauvegarde.",
      });
    },
  });

  const saving = saveMutation.isPending;
  const initialLoading = preferencesQuery.isLoading && !state;

  const isDirty = useMemo(() => {
    if (!state || !initialState) {
      return false;
    }

    return !deepEqualPreferences(state, initialState);
  }, [state, initialState]);

  const updateState = (updater: (current: MutablePreferences) => MutablePreferences) => {
    setState((current) => {
      if (!current) {
        return current;
      }

      return updater(current);
    });
  };

  const toggleMarket = (market: FinancePreferences["markets"][number]) => {
    updateState((current) => {
      const hasMarket = current.markets.includes(market);
      const nextMarkets = hasMarket
        ? current.markets.filter((item) => item !== market)
        : [...current.markets, market];

      return {
        ...current,
        markets: nextMarkets,
      };
    });
  };

  const toggleIndicator = (preset: IndicatorPreset) => {
    updateState((current) => {
      const nextIndicators = { ...current.indicators };

      if (nextIndicators[preset.id]) {
        delete nextIndicators[preset.id];
      } else {
        const base = nextIndicators[preset.id] ?? {};
        nextIndicators[preset.id] = {
          type: preset.type,
          length:
            preset.primaryKey === "length"
              ? (base.length ?? preset.defaultPrimary)
              : base.length,
          period:
            preset.primaryKey === "period"
              ? (base.period ?? preset.defaultPrimary)
              : base.period,
          standardDeviations:
            preset.secondaryKey === "standardDeviations"
              ? base.standardDeviations ?? preset.defaultSecondary
              : base.standardDeviations,
        };
      }

      return {
        ...current,
        indicators: nextIndicators,
      };
    });
  };

  const updateIndicatorValue = (
    preset: IndicatorPreset,
    key: "primary" | "secondary",
    rawValue: string
  ) => {
    updateState((current) => {
      const existing = current.indicators[preset.id];

      if (!existing) {
        return current;
      }

      const parsed = Number.parseFloat(rawValue);

      if (Number.isNaN(parsed)) {
        return current;
      }

      const clamped = key === "primary"
        ? Math.min(Math.max(parsed, preset.min), preset.max)
        : Math.min(
            Math.max(
              parsed,
              preset.secondaryMin ?? parsed
            ),
            preset.secondaryMax ?? parsed
          );

      const nextIndicators = { ...current.indicators };
      const nextIndicator = { ...existing };

      if (key === "primary") {
        if (preset.primaryKey === "length") {
          nextIndicator.length = clamped;
        } else {
          nextIndicator.period = clamped;
        }
      } else if (preset.secondaryKey === "standardDeviations") {
        nextIndicator.standardDeviations = clamped;
      }

      nextIndicators[preset.id] = nextIndicator;

      return {
        ...current,
        indicators: nextIndicators,
      };
    });
  };

  const handleExplanationLevelChange = (value: FinancePreferences["explanationLevel"]) => {
    updateState((current) => ({
      ...current,
      explanationLevel: value,
    }));
  };

  const handleShowNewsToggle = () => {
    updateState((current) => ({
      ...current,
      showNews: !current.showNews,
    }));
  };

  const handleSubmit = () => {
    if (!state) {
      return;
    }

    const payload = toFinancePreferences(state);
    const validation = financePreferencesSchema.safeParse(payload);

    if (!validation.success) {
      const detail = validation.error.issues.map((issue) => issue.message).join("; ");
      toast({
        type: "error",
        description: detail,
      });
      return;
    }

    saveMutation.mutate(validation.data);
  };

  if (initialLoading) {
    return (
      <Card data-testid="finance-settings-loading" className="space-y-4">
        <CardHeader>
          <CardTitle>Préférences finance</CardTitle>
          <CardDescription>
            Chargement des préférences personnalisées…
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-12 animate-pulse rounded-md bg-muted" />
        </CardContent>
      </Card>
    );
  }

  if (fetchErrorMessage) {
    return (
      <Card data-testid="finance-settings-error" className="space-y-4">
        <CardHeader>
          <CardTitle>Préférences finance</CardTitle>
          <CardDescription>{fetchErrorMessage}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void preferencesQuery.refetch()} variant="outline">
            Réessayer
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!state) {
    return (
      <Card data-testid="finance-settings-empty">
        <CardHeader>
          <CardTitle>Préférences finance</CardTitle>
          <CardDescription>
            Impossible de charger les préférences utilisateur.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const unknownIndicatorCount = state.extraIndicators.length;

  return (
    <Card data-testid="finance-settings">
      <CardHeader>
        <CardTitle>Préférences finance</CardTitle>
        <CardDescription>
          Choisis les marchés, indicateurs et le niveau de détail utilisés par
          l’agent lorsque tu demandes des analyses.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <section aria-labelledby="finance-markets" data-testid="finance-settings-markets" className="space-y-3">
          <div>
            <h3 id="finance-markets" className="font-semibold">
              Univers de marché suivis
            </h3>
            <p className="text-sm text-muted-foreground">
              Ces univers guident les propositions par défaut lors des requêtes.
            </p>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            {FINANCE_MARKET_OPTIONS.map(({ id, label }) => {
              const checked = state.markets.includes(id);

              return (
                <label
                  key={id}
                  className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm transition-colors hover:bg-muted"
                >
                  <input
                    aria-checked={checked}
                    checked={checked}
                    className="size-4"
                    onChange={() => toggleMarket(id)}
                    type="checkbox"
                  />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="finance-indicators" data-testid="finance-settings-indicators" className="space-y-3">
          <div>
            <h3 id="finance-indicators" className="font-semibold">
              Indicateurs affichés par défaut
            </h3>
            <p className="text-sm text-muted-foreground">
              Active les indicateurs qui doivent apparaître automatiquement sur les graphiques et backtests.
            </p>
          </div>
          <div className="space-y-4">
            {INDICATOR_PRESETS.map((preset) => {
              const active = Boolean(state.indicators[preset.id]);
              const indicator = state.indicators[preset.id];

              return (
                <div
                  key={preset.id}
                  className="rounded-md border p-4"
                  data-testid={`finance-indicator-${preset.id}`}
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <Label className="flex items-center gap-3 text-base">
                        <input
                          aria-checked={active}
                          checked={active}
                          className="size-4"
                          onChange={() => toggleIndicator(preset)}
                          type="checkbox"
                        />
                        {preset.label}
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        {preset.description}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex flex-col gap-1">
                        <Label htmlFor={`${preset.id}-primary`}>
                          {preset.primaryKey === "length" ? "Longueur" : "Période"}
                        </Label>
                        <Input
                          disabled={!active}
                          id={`${preset.id}-primary`}
                          inputMode="numeric"
                          min={preset.min}
                          max={preset.max}
                          step={preset.step ?? 1}
                          value={
                            active
                              ? preset.primaryKey === "length"
                                ? indicator?.length ?? preset.defaultPrimary
                                : indicator?.period ?? preset.defaultPrimary
                              : ""
                          }
                          onChange={(event) =>
                            updateIndicatorValue(
                              preset,
                              "primary",
                              event.currentTarget.value
                            )
                          }
                        />
                      </div>
                      {preset.secondaryKey === "standardDeviations" && (
                        <div className="flex flex-col gap-1">
                          <Label htmlFor={`${preset.id}-secondary`}>σ</Label>
                          <Input
                            disabled={!active}
                            id={`${preset.id}-secondary`}
                            inputMode="numeric"
                            min={preset.secondaryMin}
                            max={preset.secondaryMax}
                            step={0.1}
                            value={
                              active
                                ? indicator?.standardDeviations ??
                                  preset.defaultSecondary ?? 2
                                : ""
                            }
                            onChange={(event) =>
                              updateIndicatorValue(
                                preset,
                                "secondary",
                                event.currentTarget.value
                              )
                            }
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {unknownIndicatorCount > 0 && (
            <p className="text-sm text-muted-foreground" data-testid="finance-settings-extra-indicators">
              {unknownIndicatorCount} indicateur(s) personnalisé(s) seront conservés même s’ils ne sont pas listés ici.
            </p>
          )}
        </section>

        <section aria-labelledby="finance-explanations" className="space-y-3">
          <div>
            <h3 id="finance-explanations" className="font-semibold">
              Niveau de détail des explications
            </h3>
            <p className="text-sm text-muted-foreground">
              Ajuste la profondeur des rapports générés (résumé rapide ou analyse détaillée).
            </p>
          </div>
          <Select
            value={state.explanationLevel}
            onValueChange={(value) =>
              handleExplanationLevelChange(
                value as FinancePreferences["explanationLevel"]
              )
            }
          >
            <SelectTrigger className="w-full md:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FINANCE_EXPLANATION_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {level === "concise"
                    ? "Concise"
                    : level === "standard"
                      ? "Standard"
                      : "Détaillé"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </section>

        <section aria-labelledby="finance-news" className="space-y-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 id="finance-news" className="font-semibold">
                News dans les réponses
              </h3>
              <p className="text-sm text-muted-foreground">
                Active ou désactive l’inclusion automatique des actualités.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                aria-checked={state.showNews}
                checked={state.showNews}
                className="size-4"
                onChange={handleShowNewsToggle}
                type="checkbox"
              />
              <span>Afficher les news par défaut</span>
            </label>
          </div>
          {!state.showNews ? (
            <p
              aria-live="polite"
              className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100"
              data-testid="finance-settings-news-disabled"
              role="status"
            >
              Les actualités seront masquées dans les prochains échanges. L’agent
              proposera un lien ou un rappel lorsque des news pertinentes sont
              disponibles.
            </p>
          ) : null}
        </section>

        <div className="flex items-center justify-end gap-2">
          <Button
            disabled={!isDirty || saving}
            onClick={handleSubmit}
            type="button"
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
