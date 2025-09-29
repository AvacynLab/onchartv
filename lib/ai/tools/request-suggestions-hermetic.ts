import type { Suggestion } from "@/lib/db/schema";
import { generateUUID } from "@/lib/utils";
import { isPlaywrightLikeEnvironment } from "../playwright-env";

/**
 * Deterministic suggestion templates that mirror the structure returned by the
 * language model during production runs. Playwright uses these to keep the
 * suite hermetic while still exercising the suggestion UI.
 */
export const HERMETIC_SUGGESTION_TEMPLATES = [
  {
    originalText: "Clarify the opening paragraph to explain the chat goal.",
    suggestedText:
      "Start with a concise sentence that states what the assistant will help the user accomplish.",
    description:
      "Gives testers immediate context about why the conversation exists.",
  },
  {
    originalText: "Include a reminder about offline behaviour.",
    suggestedText:
      "Mention that hermetic runs replay deterministic responses so contributors know live APIs are stubbed.",
    description:
      "Documents why the mocked tool behaves differently during end-to-end tests.",
  },
  {
    originalText: "Tighten the closing call-to-action.",
    suggestedText:
      "Wrap up with a specific next step, such as rerunning the chat scenario once Playwright reports success.",
    description:
      "Keeps follow-up actions explicit for future contributors reading saved chats.",
  },
] as const satisfies ReadonlyArray<
  Pick<Suggestion, "originalText" | "suggestedText" | "description">
>;

export type HermeticSuggestionContext = {
  documentId: string;
  documentCreatedAt: Date;
};

/**
 * Generates suggestion payloads for Playwright runs. The helper intentionally
 * mirrors the database schema so the offline branch reuses the existing
 * persistence layer without special cases.
 */
export function createHermeticSuggestions({
  documentId,
  documentCreatedAt,
}: HermeticSuggestionContext) {
  return HERMETIC_SUGGESTION_TEMPLATES.map((template) => ({
    id: generateUUID(),
    documentId,
    documentCreatedAt,
    isResolved: false,
    ...template,
  }));
}

/**
 * Centralised environment detection so both unit tests and production code can
 * decide whether to replay the hermetic suggestion data.
 */
export function shouldUseHermeticSuggestions(
  env: NodeJS.ProcessEnv = process.env,
) {
  return isPlaywrightLikeEnvironment(env);
}
