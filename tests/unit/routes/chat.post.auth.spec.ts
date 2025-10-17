import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock minimal dependencies so the chat route module loads without triggering
// the actual streaming providers or database layer. Each mock mirrors the
// approach taken in the delete route tests to keep the suite lightweight.
vi.mock("@vercel/functions", () => ({
  geolocation: vi.fn(() => ({
    city: { name: "Paris" },
    region: { name: "Île-de-France" },
    country: { code: "FR" },
  })),
}));

vi.mock("@/artifacts/code/server", () => ({
  codeDocumentHandler: {
    kind: "code",
    onCreateDocument: vi.fn(),
    onUpdateDocument: vi.fn(),
  },
}));

vi.mock("@/artifacts/text/server", () => ({
  textDocumentHandler: {
    kind: "text",
    onCreateDocument: vi.fn(),
    onUpdateDocument: vi.fn(),
  },
}));

vi.mock("@/artifacts/sheet/server", () => ({
  sheetDocumentHandler: {
    kind: "sheet",
    onCreateDocument: vi.fn(),
    onUpdateDocument: vi.fn(),
  },
}));

vi.mock("@/lib/ai/providers", () => ({
  myProvider: {
    languageModel: vi.fn(() => ({ modelId: "test-model" })),
  },
  createHermeticMockProvider: vi.fn(() => ({
    languageModel: vi.fn(() => ({ modelId: "fallback" })),
  })),
}));

const authMock = vi.fn();
vi.mock("@/app/(auth)/auth", () => ({
  auth: authMock,
}));

const getMessageCountByUserIdMock = vi.fn();
const getChatByIdMock = vi.fn();
const saveChatMock = vi.fn();
const saveMessagesMock = vi.fn();
const updateChatLastContextByIdMock = vi.fn();
const getFinancePreferencesByUserIdMock = vi.fn();
const createStreamIdMock = vi.fn();

vi.mock("@/lib/db/queries", () => ({
  createStreamId: createStreamIdMock,
  deleteChatById: vi.fn(),
  getFinancePreferencesByUserId: getFinancePreferencesByUserIdMock,
  getChatById: getChatByIdMock,
  getMessageCountByUserId: getMessageCountByUserIdMock,
  getMessagesByChatId: vi.fn(),
  saveChat: saveChatMock,
  saveMessages: saveMessagesMock,
  updateChatLastContextById: updateChatLastContextByIdMock,
}));

vi.mock("@/lib/logging", () => ({
  logError: vi.fn(),
  logWarning: vi.fn(),
}));

const envBackup = { ...process.env };

describe("POST /api/chat auth guards", () => {
  beforeEach(() => {
    authMock.mockReset();
    getMessageCountByUserIdMock.mockReset();
    getChatByIdMock.mockReset();
    saveChatMock.mockReset();
    saveMessagesMock.mockReset();
    updateChatLastContextByIdMock.mockReset();
    getFinancePreferencesByUserIdMock.mockReset();
    createStreamIdMock.mockReset();

    process.env = { ...envBackup };
    process.env.OPENAI_MODEL_ID ??= "test-openai-model";
    process.env.OPENAI_API_KEY ??= "test-openai-key";
    process.env.ANTHROPIC_MODEL_ID ??= "test-anthropic-model";
    process.env.ANTHROPIC_API_KEY ??= "test-anthropic-key";

    vi.resetModules();
  });

  afterAll(() => {
    process.env = envBackup;
  });

  it("returns a 403 response when the caller is unauthenticated", async () => {
    authMock.mockResolvedValue(null);

    const { POST } = await import("@/app/(chat)/api/chat/route");

    const request = buildRequest();
    const response = await POST(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "forbidden:chat",
        message: "Regular session required",
      },
    });
    expect(getMessageCountByUserIdMock).not.toHaveBeenCalled();
    expect(getChatByIdMock).not.toHaveBeenCalled();
  });

  it("returns a 403 response when the caller is a guest", async () => {
    authMock.mockResolvedValue({ user: { id: "guest-123", type: "guest" } });

    const { POST } = await import("@/app/(chat)/api/chat/route");

    const request = buildRequest();
    const response = await POST(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "forbidden:chat",
        message: "Regular session required",
      },
    });
    expect(getMessageCountByUserIdMock).not.toHaveBeenCalled();
    expect(getChatByIdMock).not.toHaveBeenCalled();
  });
});

function buildRequest() {
  const payload = {
    id: "11111111-1111-4111-8111-111111111111",
    message: {
      id: "22222222-2222-4222-8222-222222222222",
      role: "user" as const,
      parts: [
        {
          type: "text" as const,
          text: "Hello from the auth spec",
        },
      ],
    },
    selectedChatModel: "chat-model" as const,
    selectedVisibilityType: "private" as const,
  };

  return new Request("https://example.com/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
