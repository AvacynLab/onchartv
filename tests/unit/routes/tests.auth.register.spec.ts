import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const createUserMock = vi.fn();

vi.mock("@/lib/db/queries", () => ({
  getUser: getUserMock,
  createUser: createUserMock,
}));

const envBackup = { ...process.env };

describe("POST /api/tests/auth/register", () => {
  beforeEach(() => {
    vi.resetModules();
    getUserMock.mockReset();
    createUserMock.mockReset();
    process.env = { ...envBackup };
  });

  afterEach(() => {
    process.env = envBackup;
  });

  it("rejects requests when Playwright flags are not enabled", async () => {
    process.env.PLAYWRIGHT = "false";
    process.env.CI_PLAYWRIGHT = "false";

    const { POST } = await import("@/app/api/tests/auth/register/route");

    const response = await POST(
      new Request("https://example.com/api/tests/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: "user@example.com", password: "secret" }),
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "forbidden" },
    });
    expect(getUserMock).not.toHaveBeenCalled();
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it("creates a new user when none exists", async () => {
    process.env.PLAYWRIGHT = "true";
    getUserMock.mockResolvedValue([]);
    createUserMock.mockResolvedValue(undefined);

    const { POST } = await import("@/app/api/tests/auth/register/route");

    const response = await POST(
      new Request("https://example.com/api/tests/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: "fresh@example.com", password: "hunter2" }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "created" });
    expect(getUserMock).toHaveBeenCalledWith("fresh@example.com");
    expect(createUserMock).toHaveBeenCalledWith("fresh@example.com", "hunter2");
  });

  it("returns an exists status when the account is already present", async () => {
    process.env.CI_PLAYWRIGHT = "true";
    getUserMock.mockResolvedValue([{ id: "user-1" }]);

    const { POST } = await import("@/app/api/tests/auth/register/route");

    const response = await POST(
      new Request("https://example.com/api/tests/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: "known@example.com", password: "secret" }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "exists" });
    expect(getUserMock).toHaveBeenCalledWith("known@example.com");
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it("rejects invalid payloads with a structured error", async () => {
    process.env.PLAYWRIGHT = "true";

    const { POST } = await import("@/app/api/tests/auth/register/route");

    const response = await POST(
      new Request("https://example.com/api/tests/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: "not-an-email", password: "123" }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_request" },
    });
    expect(getUserMock).not.toHaveBeenCalled();
    expect(createUserMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/tests/auth/register", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...envBackup };
  });

  afterEach(() => {
    process.env = envBackup;
  });

  it("returns a readiness payload when Playwright flags are present", async () => {
    process.env.PLAYWRIGHT = "true";

    const { GET } = await import("@/app/api/tests/auth/register/route");

    const response = await GET(
      new Request("https://example.com/api/tests/auth/register")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      allowedMethods: ["POST"],
      message: "Use POST to provision test accounts during Playwright runs.",
    });
  });

  it("rejects readiness probes outside automation runs", async () => {
    process.env.PLAYWRIGHT = "false";
    process.env.CI_PLAYWRIGHT = "false";

    const { GET } = await import("@/app/api/tests/auth/register/route");

    const response = await GET(
      new Request("https://example.com/api/tests/auth/register")
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "forbidden" },
    });
  });
});
