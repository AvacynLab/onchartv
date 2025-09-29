import { streamObject, tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import { getDocumentById, saveSuggestions } from "@/lib/db/queries";
import type { Suggestion } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";
import { myProvider } from "../providers";
import {
  createHermeticSuggestions,
  shouldUseHermeticSuggestions,
} from "./request-suggestions-hermetic";

type RequestSuggestionsProps = {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
};

export const requestSuggestions = ({
  session,
  dataStream,
}: RequestSuggestionsProps) =>
  tool({
    description: "Request suggestions for a document",
    inputSchema: z.object({
      documentId: z
        .string()
        .describe("The ID of the document to request edits"),
    }),
    execute: async ({ documentId }) => {
      const document = await getDocumentById({ id: documentId });

      if (!document || !document.content) {
        return {
          error: "Document not found",
        };
      }

      const suggestions: Omit<
        Suggestion,
        "userId" | "createdAt" | "documentCreatedAt"
      >[] = [];

      if (shouldUseHermeticSuggestions()) {
        /**
         * Hermetic Playwright runs replay static suggestions so the suite stays
         * offline while still exercising the UI state machine. The generated
         * entries mimic the production payload and are also persisted so the
         * history view renders the same metadata on reload.
         */
        for (const suggestion of createHermeticSuggestions({
          documentId,
          documentCreatedAt: document.createdAt,
        })) {
          const suggestionForStream: Suggestion = {
            ...suggestion,
            createdAt: new Date(),
            // Hermetic runs do not authenticate, so provide a descriptive
            // placeholder identifier that keeps the UI payload shape intact.
            userId: session.user?.id ?? "playwright-offline-user",
          };

          dataStream.write({
            type: "data-suggestion",
            data: suggestionForStream,
            transient: true,
          });

          suggestions.push({
            id: suggestion.id,
            documentId: suggestion.documentId,
            originalText: suggestion.originalText,
            suggestedText: suggestion.suggestedText,
            description: suggestion.description,
            isResolved: suggestion.isResolved,
          });
        }

        if (session.user?.id) {
          const userId = session.user.id;

          await saveSuggestions({
            suggestions: suggestions.map((suggestion) => ({
              ...suggestion,
              userId,
              createdAt: new Date(),
              documentCreatedAt: document.createdAt,
            })),
          });
        }

        return {
          id: documentId,
          title: document.title,
          kind: document.kind,
          message: "Suggestions have been added to the document",
        };
      }

      const { elementStream } = streamObject({
        model: myProvider.languageModel("artifact-model"),
        system:
          "You are a help writing assistant. Given a piece of writing, please offer suggestions to improve the piece of writing and describe the change. It is very important for the edits to contain full sentences instead of just words. Max 5 suggestions.",
        prompt: document.content,
        output: "array",
        schema: z.object({
          originalSentence: z.string().describe("The original sentence"),
          suggestedSentence: z.string().describe("The suggested sentence"),
          description: z.string().describe("The description of the suggestion"),
        }),
      });

      for await (const element of elementStream) {
        const baseSuggestion = {
          id: generateUUID(),
          documentId,
          originalText: element.originalSentence,
          suggestedText: element.suggestedSentence,
          description: element.description,
          isResolved: false,
        };

        const suggestionForStream: Suggestion = {
          ...baseSuggestion,
          createdAt: new Date(),
          documentCreatedAt: document.createdAt,
          userId: session.user?.id ?? "ai-suggestion",
        };

        dataStream.write({
          type: "data-suggestion",
          data: suggestionForStream,
          transient: true,
        });

        suggestions.push(baseSuggestion);
      }

      if (session.user?.id) {
        const userId = session.user.id;

        await saveSuggestions({
          suggestions: suggestions.map((suggestion) => ({
            ...suggestion,
            userId,
            createdAt: new Date(),
            documentCreatedAt: document.createdAt,
          })),
        });
      }

      return {
        id: documentId,
        title: document.title,
        kind: document.kind,
        message: "Suggestions have been added to the document",
      };
    },
  });
