import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/artifacts/code/server", () => ({
  codeDocumentHandler: {
    kind: "code" as const,
    onCreateDocument: vi.fn(),
    onUpdateDocument: vi.fn(),
  },
}));
vi.mock("@/artifacts/text/server", () => ({
  textDocumentHandler: {
    kind: "text" as const,
    onCreateDocument: vi.fn(),
    onUpdateDocument: vi.fn(),
  },
}));
vi.mock("@/artifacts/sheet/server", () => ({
  sheetDocumentHandler: {
    kind: "sheet" as const,
    onCreateDocument: vi.fn(),
    onUpdateDocument: vi.fn(),
  },
}));

const authMock = vi.fn(async () => ({
  user: {
    id: "regular-user-1",
    type: "regular",
    email: "regular@example.com",
  },
}));

vi.mock("@/app/(auth)/auth", () => ({
  auth: authMock,
}));

const generateTitleFromUserMessageMock = vi.fn(async () => "Hermetic finance chat");

vi.mock("@/app/(chat)/actions", () => ({
  generateTitleFromUserMessage: generateTitleFromUserMessageMock,
}));

describe("POST /api/chat hermetic finance flow", () => {
  const envBackup = { ...process.env };
  let logErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("server-only", () => ({}));
    authMock.mockClear();
    generateTitleFromUserMessageMock.mockClear();

    process.env = {
      ...envBackup,
      PLAYWRIGHT: "true",
      NEXT_PUBLIC_PLAYWRIGHT: "true",
      HERMETIC_CHAT_PROVIDER: "true",
      PLAYWRIGHT_TEST_BASE_URL: envBackup.PLAYWRIGHT_TEST_BASE_URL ?? "http://localhost:3100",
      OPENAI_MODEL_ID: envBackup.OPENAI_MODEL_ID ?? "mock-openai", 
      OPENAI_TITLE_MODEL_ID: envBackup.OPENAI_TITLE_MODEL_ID ?? "mock-openai-title",
      OPENAI_REASONING_MODEL_ID:
        envBackup.OPENAI_REASONING_MODEL_ID ?? envBackup.OPENAI_MODEL_ID ?? "mock-openai-reasoning",
      OPENAI_ARTIFACT_MODEL_ID: envBackup.OPENAI_ARTIFACT_MODEL_ID ?? "mock-openai-artifact",
    };

    const logging = await import("@/lib/logging");
    logErrorSpy = vi.spyOn(logging, "logError").mockImplementation(() => undefined);

    const { isTestEnvironment } = await import("@/lib/constants");
    if (!isTestEnvironment()) {
      throw new Error("Hermetic test environment was not activated before importing modules");
    }

    const queries = await import("@/lib/db/queries");
    if (typeof queries.__resetInMemoryDbForTests === "function") {
      queries.__resetInMemoryDbForTests();
    }
  });

  afterEach(() => {
    logErrorSpy?.mockRestore();
    logErrorSpy = null;
    process.env = envBackup;
  });

  it("streams finance artefacts without requiring network access", async () => {
    const convertModule = await import(
      "@/lib/ai/messages/convert-to-model-messages"
    );
    const convertSpy = vi.spyOn(convertModule, "convertToModelMessages");

    const { POST } = await import("@/app/(chat)/api/chat/route");
    const { myProvider } = await import("@/lib/ai/providers");
    const modelPreview = myProvider.languageModel("chat-model");
    expect(modelPreview.modelId).toMatch(/inline/);

    const payload = {
      id: "aaaaaaaa-aaaa-4aaa-baaa-aaaaaaaaaaaa",
      message: {
        id: "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb",
        role: "user" as const,
        parts: [
          {
            type: "text" as const,
            text: "Montre BTCUSD 1D avec SMA(50/200)",
          },
        ],
      },
      selectedChatModel: "chat-model" as const,
      selectedVisibilityType: "private" as const,
    };

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const response = await POST(request);

    try {
      if (response.status !== 200) {
        const diagnosticPayload = await response
          .clone()
          .json()
          .catch(async () => response.clone().text().catch(() => null));
        const lastLogErrorCall = logErrorSpy?.mock.calls.at(-1) ?? null;
        const serializedError = (() => {
          if (!lastLogErrorCall) {
            return null;
          }

          const [, error, extra] = lastLogErrorCall;
          if (error instanceof AggregateError) {
            return {
              name: error.name,
              message: error.message,
              code: (error as { code?: unknown }).code ?? null,
              errors: Array.isArray(error.errors)
                ? error.errors.map((inner) => ({
                    name: (inner as { name?: unknown }).name ?? null,
                    code: (inner as { code?: unknown }).code ?? null,
                    message: (inner as { message?: unknown }).message ?? null,
                    stack: (inner as { stack?: unknown }).stack ?? null,
                    raw: String(inner),
                  }))
                : null,
              extra,
            };
          }

          return { error, extra };
        })();
        // eslint-disable-next-line no-console -- surfaced only during failing diagnostics.
        console.error("hermetic chat diagnostics", {
          status: response.status,
          payload: diagnosticPayload,
        });
        if (serializedError) {
          // eslint-disable-next-line no-console -- surfaced only during failing diagnostics.
          console.dir(serializedError, { depth: 6 });
        }
      }

      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();

      const decoder = new TextDecoder();
      let buffer = "";

      if (reader) {
        // Drain the stream to capture the finance artefacts emitted by the hermetic provider.
        // eslint-disable-next-line no-constant-condition -- loop exits via explicit break when the stream ends.
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            break;
          }

          if (typeof value === "string") {
            buffer += value;
          } else if (value) {
            buffer += decoder.decode(value, { stream: true });
          }
        }
      }

      expect(buffer).toContain("financeChart");
      expect(buffer).toContain("BTCUSD");

      const convertArgs = convertSpy.mock.calls.at(-1);
      const streamedMessages = Array.isArray(convertArgs?.[0])
        ? (convertArgs?.[0] as Array<{ metadata?: { createdAt?: string } }>)
        : [];
      const latestMessage = streamedMessages.at(-1);

      expect(latestMessage?.metadata?.createdAt).toMatch(/\d{4}-\d{2}-\d{2}T/);

      expect(authMock).toHaveBeenCalled();
      expect(generateTitleFromUserMessageMock).toHaveBeenCalled();

      expect(logErrorSpy?.mock.calls.length ?? 0).toBe(0);
    } finally {
      convertSpy.mockRestore();
    }
  });

  it("propagates client text signatures when streaming a new user message", async () => {
    const convertModule = await import(
      "@/lib/ai/messages/convert-to-model-messages"
    );
    const convertSpy = vi.spyOn(convertModule, "convertToModelMessages");

    const { POST } = await import("@/app/(chat)/api/chat/route");

    const payload = {
      id: "11111111-2222-4333-8444-555555555555",
      message: {
        id: "11111111-aaaa-4bbb-9ccc-222222222222",
        role: "user" as const,
        parts: [
          {
            type: "text" as const,
            text: "Peux-tu expliquer pourquoi le ciel est bleu ?",
          },
        ],
        metadata: { clientTextSignature: "  Peux-tu expliquer pourquoi le ciel est bleu ?  " },
      },
      selectedChatModel: "chat-model" as const,
      selectedVisibilityType: "private" as const,
    };

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const response = await POST(request);

    try {
      expect(response.status).toBe(200);

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Streamed response did not expose a readable body");
      }

      // Drain the stream to completion so all route side effects (title
      // generation, finance mocks, etc.) settle before we inspect the
      // provider-facing messages.
      // eslint-disable-next-line no-constant-condition -- exits when `done` is true.
      while (true) {
        const { done } = await reader.read();
        if (done) {
          break;
        }
      }

      const convertArgs = convertSpy.mock.calls.at(-1);
      const streamedMessages = Array.isArray(convertArgs?.[0])
        ? (convertArgs?.[0] as Array<{ metadata?: { createdAt?: string; clientTextSignature?: string } }>)
        : [];
      const latestMessage = streamedMessages.at(-1);

      expect(latestMessage?.metadata?.createdAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(latestMessage?.metadata?.clientTextSignature).toBe(
        "Peux-tu expliquer pourquoi le ciel est bleu ?"
      );
    } finally {
      convertSpy.mockRestore();
    }
  });

  it("reuses persisted user message content when regenerating", async () => {
    const convertModule = await import(
      "@/lib/ai/messages/convert-to-model-messages"
    );
    const convertSpy = vi.spyOn(convertModule, "convertToModelMessages");

    const { POST } = await import("@/app/(chat)/api/chat/route");
    const { saveChat, saveMessages, getMessageById } = await import(
      "@/lib/db/queries"
    );

    const chatId = "cccccccc-cccc-4ccc-bccc-cccccccccccc";
    const messageId = "dddddddd-dddd-4ddd-addd-dddddddddddd";
    const editedPrompt = "Why is grass green?";

    await saveChat({
      id: chatId,
      userId: "regular-user-1",
      title: "Edited chat",
      visibility: "private",
    });

    await saveMessages({
      messages: [
        {
          chatId,
          id: messageId,
          role: "user",
          parts: [{ type: "text", text: editedPrompt }],
          attachments: [],
          artifacts: [],
          createdAt: new Date("2024-01-01T00:00:00.000Z"),
        },
      ],
    });

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: chatId,
        message: {
          id: messageId,
          role: "user" as const,
          parts: [{ type: "text" as const, text: "Why is the sky blue?" }],
          metadata: { clientTextSignature: editedPrompt },
        },
        selectedChatModel: "chat-model" as const,
        selectedVisibilityType: "private" as const,
      }),
    });

    try {
      const response = await POST(request);
      expect(response.status).toBe(200);

      const [persisted] = await getMessageById({ id: messageId });
      const persistedParts = Array.isArray(persisted?.parts)
        ? (persisted?.parts as Array<{ type: string; text?: string }>)
        : [];
      const persistedText = persistedParts.find((part) => part.type === "text")?.text;

      expect(persistedText).toBe(editedPrompt);

      const lastCall = convertSpy.mock.calls.at(-1);
      const streamedTexts = Array.isArray(lastCall?.[0])
        ? lastCall![0].flatMap((chatMessage) =>
            Array.isArray(chatMessage.parts)
              ? chatMessage.parts
                  .filter(
                    (part): part is { type: "text"; text: string } => part?.type === "text"
                  )
                  .map((part) => part.text)
              : []
          )
        : [];

      expect(streamedTexts).toContain(editedPrompt);
      expect(streamedTexts).not.toContain("Why is the sky blue?");
    } finally {
      convertSpy.mockRestore();
    }
  });

  it("utilise les fragments envoyés par le client lorsque la base contient encore l'ancienne version", async () => {
    const convertModule = await import(
      "@/lib/ai/messages/convert-to-model-messages"
    );
    const convertSpy = vi.spyOn(convertModule, "convertToModelMessages");

    const { POST } = await import("@/app/(chat)/api/chat/route");
    const { saveChat, saveMessages } = await import("@/lib/db/queries");

    const chatId = "eeeeeeee-eeee-4eee-beee-eeeeeeeeeeee";
    const messageId = "ffffffff-ffff-4fff-afff-ffffffffffff";
    const stalePrompt = "Why is grass green?";
    const freshPrompt = "Why is the sky blue?";

    await saveChat({
      id: chatId,
      userId: "regular-user-1",
      title: "Edited chat with race",
      visibility: "private",
    });

    await saveMessages({
      messages: [
        {
          chatId,
          id: messageId,
          role: "user",
          parts: [{ type: "text", text: stalePrompt }],
          attachments: [],
          artifacts: [],
          createdAt: new Date("2024-01-01T00:00:00.000Z"),
        },
      ],
    });

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: chatId,
        message: {
          id: messageId,
          role: "user" as const,
          parts: [{ type: "text" as const, text: freshPrompt }],
          metadata: { clientTextSignature: freshPrompt },
        },
        selectedChatModel: "chat-model" as const,
        selectedVisibilityType: "private" as const,
      }),
    });

    try {
      const response = await POST(request);
      expect(response.status).toBe(200);

      const lastCall = convertSpy.mock.calls.at(-1);
      const streamedTexts = Array.isArray(lastCall?.[0])
        ? lastCall![0].flatMap((chatMessage) =>
            Array.isArray(chatMessage.parts)
              ? chatMessage.parts
                  .filter(
                    (part): part is { type: "text"; text: string } =>
                      part?.type === "text"
                  )
                  .map((part) => part.text)
              : []
          )
        : [];

      expect(streamedTexts).toContain(freshPrompt);
      expect(streamedTexts).not.toContain(stalePrompt);
    } finally {
      convertSpy.mockRestore();
    }
  });

  it("accepte les fragments entrants quand la signature client est absente mais le texte diverge", async () => {
    const convertModule = await import(
      "@/lib/ai/messages/convert-to-model-messages"
    );
    const convertSpy = vi.spyOn(convertModule, "convertToModelMessages");

    const loggingModule = await import("@/lib/logging");
    const warnSpy = vi.spyOn(loggingModule, "logWarning");

    const { POST } = await import("@/app/(chat)/api/chat/route");
    const { saveChat, saveMessages } = await import("@/lib/db/queries");

    const chatId = "cccccccc-cccc-4ccc-accc-cccccccccccc";
    const messageId = "dddddddd-dddd-4ddd-addd-dddddddddddd";
    const stalePrompt = "Why is grass green?";
    const freshPrompt = "Why is the sky blue?";

    await saveChat({
      id: chatId,
      userId: "regular-user-1",
      title: "Edited chat without signature",
      visibility: "private",
    });

    await saveMessages({
      messages: [
        {
          chatId,
          id: messageId,
          role: "user",
          parts: [{ type: "text", text: stalePrompt }],
          attachments: [],
          artifacts: [],
          createdAt: new Date("2024-01-01T00:00:00.000Z"),
        },
      ],
    });

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: chatId,
        message: {
          id: messageId,
          role: "user" as const,
          parts: [{ type: "text" as const, text: freshPrompt }],
          metadata: {},
        },
        selectedChatModel: "chat-model" as const,
        selectedVisibilityType: "private" as const,
      }),
    });

    try {
      const response = await POST(request);
      expect(response.status).toBe(200);

      const lastCall = convertSpy.mock.calls.at(-1);
      const streamedTexts = Array.isArray(lastCall?.[0])
        ? lastCall![0].flatMap((chatMessage) =>
            Array.isArray(chatMessage.parts)
              ? chatMessage.parts
                  .filter(
                    (part): part is { type: "text"; text: string } =>
                      part?.type === "text"
                  )
                  .map((part) => part.text)
              : []
          )
        : [];

      expect(streamedTexts).toContain(freshPrompt);
      expect(streamedTexts).not.toContain(stalePrompt);

      expect(warnSpy).toHaveBeenCalledWith(
        "chat:message",
        expect.stringContaining("No client signature provided"),
        expect.objectContaining({
          incomingSignature: freshPrompt,
          persistedSignature: stalePrompt,
        })
      );
    } finally {
      convertSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
