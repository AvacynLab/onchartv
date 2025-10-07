import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveCredentialsUser } from "@/lib/auth/credentials-verify";

const ROUTE_PATH = "../../../app/api/tests/auth/reset-password/route";

async function loadRoute() {
  return await import(ROUTE_PATH);
}

describe("POST /api/tests/auth/reset-password", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("PLAYWRIGHT", "true");
    vi.stubEnv("CI_PLAYWRIGHT", "true");
    vi.doMock("server-only", () => ({}));
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("rejects requests outside the Playwright environment", async () => {
    delete process.env.PLAYWRIGHT;
    delete process.env.CI_PLAYWRIGHT;

    const { POST } = await loadRoute();
    const response = await POST(
      new Request("http://localhost/api/tests/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ email: "test@example.com", password: "secret" }),
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "forbidden" },
    });
  });

  it("returns 404 when the requested user does not exist", async () => {
    const { POST } = await loadRoute();

    const response = await POST(
      new Request("http://localhost/api/tests/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ email: "missing@example.com", password: "secret" }),
      })
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found" },
    });
  });

  it("updates the stored hash when the user exists", async () => {
    const { POST } = await loadRoute();
    const queries = await import("@/lib/db/queries");

    await queries.__resetInMemoryDbForTests();

    const email = "playwright-reset@example.com";
    await queries.createUser(email, "initial-password");

    const response = await POST(
      new Request("http://localhost/api/tests/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ email, password: "new-password" }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "updated" });

    const [updatedUser] = await queries.getUser(email);
    expect(updatedUser?.password).not.toBeNull();

    const dependencies = {
      getUser: queries.getUser,
      createUser: queries.createUser,
      getTestUserPlaintextPassword: queries.getTestUserPlaintextPassword,
      getPersistedTestUserByEmail: queries.getPersistedTestUserByEmail,
      updateTestUserPassword: queries.updateTestUserPassword,
    } satisfies Parameters<typeof resolveCredentialsUser>[2];

    const resolved = await resolveCredentialsUser(email, "new-password", dependencies);
    expect(resolved?.email).toBe(email);
  });
});
