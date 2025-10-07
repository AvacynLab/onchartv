// Force the route into its hermetic branch so uploads are mocked rather than
// calling Vercel Blob during unit tests.
const originalPlaywright = process.env.PLAYWRIGHT;
// Mirror the real Playwright environment marker so the upload route selects
// its hermetic branch without relying on legacy truthy values.
process.env.PLAYWRIGHT = "true";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/(chat)/api/files/upload/route";

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async () => ({
    url: "https://example.com/mock.csv",
    pathname: "mock.csv",
    contentType: "text/csv",
  })),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/constants", async () => ({
  ...(await vi.importActual<typeof import("@/lib/constants")>("@/lib/constants")),
  isTestEnvironment: () => true,
}));

const { authMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
}));

vi.mock("@/app/(auth)/auth", () => ({
  auth: authMock,
}));

/**
 * Vitest currently lacks a built-in helper to serialize multipart payloads. We
 * therefore stub the `formData()` method so the route receives the prepared
 * fields without needing to parse a real stream.
 */
const createMultipartRequest = (formData: FormData) =>
  ({
    body: {},
    async formData() {
      return formData;
    },
  }) as unknown as Request;

describe("/api/files/upload", () => {
  beforeEach(() => {
    authMock.mockResolvedValue({
      user: {
        id: "user-123",
        type: "regular",
        email: "user@example.com",
      },
    });
  });

  afterEach(() => {
    authMock.mockReset();
  });

  afterAll(() => {
    if (originalPlaywright) {
      process.env.PLAYWRIGHT = originalPlaywright;
    } else {
      delete process.env.PLAYWRIGHT;
    }
  });

  it("accepts CSV uploads for backtest scenarios", async () => {
    const formData = new FormData();
    formData.set(
      "file",
      new File(["symbol,price\nAAPL,150"], "backtest.csv", {
        type: "text/csv",
      })
    );

    const response = await POST(createMultipartRequest(formData));

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.pathname).toBe("backtest.csv");
    expect(payload.contentType).toBe("text/csv");
  });

  it("rejects unsupported mime types", async () => {
    const formData = new FormData();
    formData.set(
      "file",
      new File(["%PDF"], "document.pdf", { type: "application/pdf" })
    );

    const response = await POST(createMultipartRequest(formData));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("File type should be JPEG, PNG, or CSV");
  });
});
