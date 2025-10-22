import { describe, expect, it } from "vitest";

import {
  createCanonicalTextPart,
  extractTextFromMessagePart,
  normaliseUserMessageParts,
} from "@/lib/ai/messages/normalise-user-message-parts";
import type { ChatMessage } from "@/lib/types";

describe("normaliseUserMessageParts", () => {
  it("keeps a single canonical text fragment when multiple strings are provided", () => {
    const parts: ChatMessage["parts"] = [
      "Why is grass green?",
      "Why is the sky blue?",
    ];

    const result = normaliseUserMessageParts(parts);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "text", text: "Why is the sky blue?" });
  });

  it("preserves non-text fragments while replacing only the latest textual entry", () => {
    const parts: ChatMessage["parts"] = [
      { type: "text", text: "First" },
      { type: "data-financeChart", data: { symbol: "BTCUSD" } },
      { type: "text", text: "Second" },
    ];

    const result = normaliseUserMessageParts(parts);

    expect(result).toEqual([
      { type: "text", text: "Second" },
      { type: "data-financeChart", data: { symbol: "BTCUSD" } },
    ]);
  });

  it("returns an empty array when the source parts are empty", () => {
    expect(normaliseUserMessageParts([])).toEqual([]);
  });
});

describe("extractTextFromMessagePart", () => {
  it("returns trimmed text for legacy string fragments", () => {
    expect(extractTextFromMessagePart("  trimmed  ")).toBe("trimmed");
  });

  it("falls back to null for non textual fragments", () => {
    expect(
      extractTextFromMessagePart({ type: "data-financeChart", data: {} } as any)
    ).toBeNull();
  });
});

describe("createCanonicalTextPart", () => {
  it("retains ancillary metadata when cloning a text fragment", () => {
    const canonical = createCanonicalTextPart(
      { type: "text", text: "old", extra: "meta" } as any,
      "updated"
    );

    expect(canonical).toEqual({ type: "text", text: "updated", extra: "meta" });
  });
});
