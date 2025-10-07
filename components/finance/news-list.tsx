"use client";

import React from "react";
import { ExternalLink, Newspaper, ThumbsDown, ThumbsUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { FinanceNewsArtifact } from "@/lib/finance/types";

type Sentiment = "positive" | "neutral" | "negative";

const normaliseSentiment = (sentiment: unknown): Sentiment => {
  if (sentiment === "positive" || sentiment === "negative") {
    return sentiment;
  }

  return "neutral";
};

const sentimentIcon = (sentiment: unknown) => {
  const normalised = normaliseSentiment(sentiment);

  switch (normalised) {
    case "positive":
      return (
        <ThumbsUp
          aria-label="Sentiment positif"
          className="size-4 text-green-600"
        />
      );
    case "negative":
      return (
        <ThumbsDown
          aria-label="Sentiment négatif"
          className="size-4 text-red-600"
        />
      );
    default:
      return (
        <Newspaper
          aria-label="Sentiment neutre"
          className="size-4 text-muted-foreground"
        />
      );
  }
};

const formatPublishedDate = (value: unknown): string => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return "Date inconnue";
    }

    return value.toISOString().split("T")[0];
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().split("T")[0];
    }
  }

  return "Date inconnue";
};

/**
 * Render a scrollable list of mocked news headlines with sentiment context.
 * Links open in a new tab to avoid losing the chat session and keep the agent
 * workflow uninterrupted.
 */
export function NewsList({ artifact }: { readonly artifact: FinanceNewsArtifact }) {
  const symbol =
    typeof artifact?.symbol === "string" && artifact.symbol.trim().length > 0
      ? artifact.symbol
      : "Instrument inconnu";

  /**
   * Gracefully fall back to an empty array when the artefact omits the items
   * list or contains sparse entries. This keeps the renderer deterministic even
   * when upstream mocks are partially hydrated.
   */
  const items = Array.isArray(artifact.items)
    ? artifact.items.filter((item): item is FinanceNewsArtifact["items"][number] =>
        Boolean(item)
      )
    : [];

  return (
    <div className="space-y-4" data-testid="finance-news-artifact">
      <header className="flex flex-col gap-1">
        <h3 className="font-semibold text-lg">Actualités — {symbol}</h3>
        <p className="text-muted-foreground text-sm">
          Sélection hermétique d'articles résumés avec sentiment estimé.
        </p>
      </header>

      <div className="space-y-3">
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Aucune actualité récente n'est disponible pour ce titre.
          </p>
        ) : (
          items.map((item, index) => {
            const title =
              typeof item.title === "string" && item.title.trim().length > 0
                ? item.title
                : "Titre indisponible";

            const summary =
              typeof item.summary === "string" && item.summary.trim().length > 0
                ? item.summary
                : "Résumé indisponible pour cet article.";

            const source =
              typeof item.source === "string" && item.source.trim().length > 0
                ? item.source
                : "Source inconnue";

            const url =
              typeof item.url === "string" && item.url.trim().length > 0
                ? item.url
                : null;

            const publishedAtLabel = formatPublishedDate(item.publishedAt);
            /**
             * Preserve a machine-readable timestamp whenever the mock provides
             * one. Screen readers benefit from the attribute even if the
             * human-readable fallback stays coarse.
             */
            const publishedAtDateTime = (() => {
              if (item.publishedAt instanceof Date) {
                return Number.isNaN(item.publishedAt.getTime())
                  ? undefined
                  : item.publishedAt.toISOString();
              }

              if (typeof item.publishedAt === "string") {
                return item.publishedAt;
              }

              return undefined;
            })();
            const sentiment = normaliseSentiment(item.sentiment);
            const articleKey = item.id ?? `${title}-${index}`;

            return (
              <article
                className="rounded-lg border p-4 transition hover:border-primary"
                key={articleKey}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    {url ? (
                      <a
                        className="font-medium hover:underline"
                        href={url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {title}
                      </a>
                    ) : (
                      <span className="font-medium text-muted-foreground">{title}</span>
                    )}
                    <p className="text-muted-foreground text-sm">{summary}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{source}</span>
                      <span aria-hidden="true">•</span>
                      <time dateTime={publishedAtDateTime}>{publishedAtLabel}</time>
                      <Badge variant="outline">Sentiment : {sentiment}</Badge>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {sentimentIcon(sentiment)}
                    {url ? (
                      <a
                        aria-label={`Ouvrir l'article ${title}`}
                        className="text-muted-foreground transition hover:text-primary"
                        href={url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground" aria-hidden="true">
                        <ExternalLink className="size-4 opacity-40" />
                      </span>
                    )}
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
