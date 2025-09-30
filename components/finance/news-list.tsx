"use client";

import React from "react";
import { ExternalLink, Newspaper, ThumbsDown, ThumbsUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { FinanceNewsArtifact } from "@/lib/finance/types";

const sentimentIcon = (sentiment: "positive" | "neutral" | "negative") => {
  switch (sentiment) {
    case "positive":
      return <ThumbsUp className="size-4 text-green-600" aria-label="Sentiment positif" />;
    case "negative":
      return <ThumbsDown className="size-4 text-red-600" aria-label="Sentiment négatif" />;
    default:
      return <Newspaper className="size-4 text-muted-foreground" aria-label="Sentiment neutre" />;
  }
};

/**
 * Render a scrollable list of mocked news headlines with sentiment context.
 * Links open in a new tab to avoid losing the chat session and keep the agent
 * workflow uninterrupted.
 */
export function NewsList({ artifact }: { readonly artifact: FinanceNewsArtifact }) {
  return (
    <div className="space-y-4" data-testid="finance-news-artifact">
      <header className="flex flex-col gap-1">
        <h3 className="font-semibold text-lg">Actualités — {artifact.symbol}</h3>
        <p className="text-muted-foreground text-sm">
          Sélection hermétique d'articles résumés avec sentiment estimé.
        </p>
      </header>

      <div className="space-y-3">
        {artifact.items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Aucune actualité récente n'est disponible pour ce titre.
          </p>
        ) : (
          artifact.items.map((item) => (
            <article
              className="rounded-lg border p-4 transition hover:border-primary"
              key={item.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <a
                    className="font-medium hover:underline"
                    href={item.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {item.title}
                  </a>
                  <p className="text-muted-foreground text-sm">{item.summary}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{item.source}</span>
                    <span aria-hidden="true">•</span>
                    <time dateTime={item.publishedAt}>
                      {new Date(item.publishedAt).toISOString().split("T")[0]}
                    </time>
                    <Badge variant="outline">Sentiment : {item.sentiment}</Badge>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {sentimentIcon(item.sentiment)}
                  <a
                    aria-label={`Ouvrir l'article ${item.title}`}
                    className="text-muted-foreground transition hover:text-primary"
                    href={item.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
