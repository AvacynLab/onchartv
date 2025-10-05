import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(auth)/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db/queries", () => ({
  getMessagesByChatId: vi.fn(),
}));

vi.mock("@/lib/artifacts/server", () => ({
  createDocumentHandler: vi.fn(() => ({
    handle: vi.fn(),
  })),
}));

process.env.OPENAI_MODEL_ID ??= "test-model";
process.env.OPENAI_API_KEY ??= "test-key";

const streamModule = await import(
  "@/app/(chat)/api/chat/[id]/stream/route"
);
const { buildFallbackStreamResponse, createEmptyStream } = streamModule;

const { getMessagesByChatId } = await import("@/lib/db/queries");
const mockedGetMessagesByChatId = vi.mocked(getMessagesByChatId);

describe("chat stream fallback", () => {
  const chatId = "chat-test-id";
  const resumeRequestedAt = new Date("2024-01-01T00:00:30Z");

  beforeEach(() => {
    mockedGetMessagesByChatId.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an empty stream when the chat has no assistant replies", async () => {
    mockedGetMessagesByChatId.mockResolvedValue([]);

    const response = await buildFallbackStreamResponse(chatId, resumeRequestedAt);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("returns an empty stream when the most recent assistant reply is stale", async () => {
    mockedGetMessagesByChatId.mockResolvedValue([
      {
        id: "msg-1",
        chatId,
        role: "assistant",
        content: "Old answer",
        createdAt: new Date(resumeRequestedAt.getTime() - 20_000).toISOString(),
        updatedAt: new Date(resumeRequestedAt.getTime() - 20_000).toISOString(),
      } as any,
    ]);

    const response = await buildFallbackStreamResponse(chatId, resumeRequestedAt);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("streams the latest assistant reply when it is still fresh", async () => {
    const assistantMessage = {
      id: "msg-2",
      chatId,
      role: "assistant",
      content: "Here is the latest insight",
      parts: [
        {
          type: "text",
          text: "Here is the latest insight",
        },
      ],
      createdAt: new Date(resumeRequestedAt.getTime() - 5_000).toISOString(),
      updatedAt: new Date(resumeRequestedAt.getTime() - 5_000).toISOString(),
    } as any;

    mockedGetMessagesByChatId.mockResolvedValue([assistantMessage]);

    const response = await buildFallbackStreamResponse(chatId, resumeRequestedAt);

    expect(response.status).toBe(200);

    const payload = await readStream(response.body);
    expect(payload).toContain("data-appendMessage");
    expect(payload).toContain(assistantMessage.id);
    expect(payload).toContain("Here is the latest insight");
  });

  it("exposes the empty stream helper for defensive use", () => {
    const emptyStream = createEmptyStream();
    expect(emptyStream).toBeInstanceOf(ReadableStream);
  });
});
const readStream = async (stream: ReadableStream<unknown> | null) => {
  if (!stream) return "";

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    if (typeof value === "string") {
      buffer += value;
    } else if (value instanceof Uint8Array) {
      buffer += decoder.decode(value, { stream: true });
    } else if (Array.isArray(value)) {
      buffer += value
        .map((chunk) =>
          typeof chunk === "string"
            ? chunk
            : chunk instanceof Uint8Array
              ? decoder.decode(chunk, { stream: true })
              : ""
        )
        .join("");
    }
  }

  return buffer;
};

