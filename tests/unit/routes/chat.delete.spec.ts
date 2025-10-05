import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock minimal dependencies so the chat route module can be evaluated in isolation
// without triggering database calls or AI streaming side effects.
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

const authMock = vi.fn();
vi.mock("@/app/(auth)/auth", () => ({
  auth: authMock,
}));

const assertRegularChatUserMock = vi.fn();
vi.mock("@/lib/chat/authorization", () => ({
  assertRegularChatUser: assertRegularChatUserMock,
}));

const deleteChatByIdMock = vi.fn();
const getChatByIdMock = vi.fn();

vi.mock("@/lib/db/queries", () => ({
  createStreamId: vi.fn(),
  getFinancePreferencesByUserId: vi.fn(),
  deleteChatById: deleteChatByIdMock,
  getChatById: getChatByIdMock,
  getMessageCountByUserId: vi.fn(),
  getMessagesByChatId: vi.fn(),
  saveChat: vi.fn(),
  saveMessages: vi.fn(),
  updateChatLastContextById: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  logError: vi.fn(),
  logWarning: vi.fn(),
}));

const envBackup = { ...process.env };

describe("DELETE /api/chat", () => {
  beforeEach(() => {
    authMock.mockReset();
    assertRegularChatUserMock.mockReset();
    deleteChatByIdMock.mockReset();
    getChatByIdMock.mockReset();

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

  it("authorises the caller before deleting the chat", async () => {
    const session = { user: { id: "user-123", type: "regular" } };

    authMock.mockResolvedValue(session);
    assertRegularChatUserMock.mockReturnValue({ id: "user-123" });
    getChatByIdMock.mockResolvedValue({ id: "chat-123", userId: "user-123" });
    deleteChatByIdMock.mockResolvedValue({ id: "chat-123" });

    const { DELETE } = await import("@/app/(chat)/api/chat/route");

    const response = await DELETE(
      new Request("https://example.com/api/chat?id=chat-123")
    );

    expect(assertRegularChatUserMock).toHaveBeenCalledWith(session);
    expect(deleteChatByIdMock).toHaveBeenCalledWith({ id: "chat-123" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "chat-123" });
  });

  it("returns a formatted error response when authorisation fails", async () => {
    const session = { user: { id: "user-guest", type: "guest" } };

    authMock.mockResolvedValue(session);
    const { ChatSDKError } = await import("@/lib/errors");
    assertRegularChatUserMock.mockImplementation(() => {
      throw new ChatSDKError("forbidden:chat");
    });

    const { DELETE } = await import("@/app/(chat)/api/chat/route");

    const response = await DELETE(
      new Request("https://example.com/api/chat?id=chat-999")
    );

    expect(assertRegularChatUserMock).toHaveBeenCalledWith(session);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "forbidden:chat" },
    });
    expect(deleteChatByIdMock).not.toHaveBeenCalled();
    expect(getChatByIdMock).not.toHaveBeenCalled();
  });
});
