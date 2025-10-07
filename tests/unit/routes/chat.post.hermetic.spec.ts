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

    expect(authMock).toHaveBeenCalled();
    expect(generateTitleFromUserMessageMock).toHaveBeenCalled();

    expect(logErrorSpy?.mock.calls.length ?? 0).toBe(0);
  });
});
