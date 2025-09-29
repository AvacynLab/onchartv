/**
 * Unit coverage validating the deterministic suggestion helpers used when the
 * Playwright hermetic environment is active. These tests keep the offline
 * branch well specified without spinning up the AI streaming stack.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  createHermeticSuggestions,
  HERMETIC_SUGGESTION_TEMPLATES,
  shouldUseHermeticSuggestions,
} from "../../lib/ai/tools/request-suggestions-hermetic";

const DOCUMENT_ID = "3dffb177-ea9b-4a14-a190-7053d1414e25";
const DOCUMENT_CREATED_AT = new Date("2024-10-01T12:00:00Z");

test.describe("Hermetic chat suggestion helpers", () => {
  test("detects the Playwright environment using shared heuristics", () => {
    assert.equal(
      shouldUseHermeticSuggestions({ PLAYWRIGHT: "true" }),
      true,
      "Playwright flag should enable the offline suggestion branch",
    );

    assert.equal(
      shouldUseHermeticSuggestions({ NEXT_PUBLIC_PLAYWRIGHT: "false" }),
      false,
      "Explicitly disabled flags must keep production behaviour",
    );
  });

  test("replays deterministic suggestion payloads", () => {
    const suggestions = createHermeticSuggestions({
      documentId: DOCUMENT_ID,
      documentCreatedAt: DOCUMENT_CREATED_AT,
    });

    assert.equal(
      suggestions.length,
      HERMETIC_SUGGESTION_TEMPLATES.length,
      "The helper should mirror the number of suggestion templates",
    );

    for (const [index, suggestion] of suggestions.entries()) {
      const template = HERMETIC_SUGGESTION_TEMPLATES[index];

      assert.equal(
        suggestion.documentId,
        DOCUMENT_ID,
        "Suggestions must retain the original document id",
      );
      assert.equal(
        suggestion.documentCreatedAt,
        DOCUMENT_CREATED_AT,
        "Suggestions must carry the document timestamp for persistence",
      );
      assert.equal(
        suggestion.isResolved,
        false,
        "Hermetic suggestions are always unresolved to exercise UI toggles",
      );
      assert.ok(
        suggestion.id,
        "Each suggestion should receive a generated identifier",
      );
      assert.equal(
        suggestion.originalText,
        template.originalText,
        "The original text should mirror the template payload",
      );
      assert.equal(
        suggestion.suggestedText,
        template.suggestedText,
        "The helper must forward the suggested rewrite",
      );
      assert.equal(
        suggestion.description,
        template.description,
        "Descriptions should remain stable to keep tests deterministic",
      );
    }
  });
});
