import assert from "node:assert/strict";
import test, { describe } from "node:test";

const originalPlaywright = process.env.PLAYWRIGHT;
const originalCiPlaywright = process.env.CI_PLAYWRIGHT;
process.env.PLAYWRIGHT = process.env.PLAYWRIGHT ?? "true";

async function loadRoute() {
  return await import("../../../app/api/tests/auth/reset-password/route");
}

describe("POST /api/tests/auth/reset-password", () => {
  test("rejects requests outside the Playwright environment", async () => {
    delete process.env.PLAYWRIGHT;
    delete process.env.CI_PLAYWRIGHT;

    const { POST } = await loadRoute();
    const response = await POST(
      new Request("http://localhost/api/tests/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ email: "test@example.com", password: "secret" }),
      })
    );

    assert.equal(response.status, 403);
    const payload = (await response.json()) as { error?: { code?: string } };
    assert.equal(payload.error?.code, "forbidden");

    process.env.PLAYWRIGHT = originalPlaywright ?? "true";
    if (originalCiPlaywright) {
      process.env.CI_PLAYWRIGHT = originalCiPlaywright;
    } else {
      delete process.env.CI_PLAYWRIGHT;
    }
  });

  test("returns 404 when the requested user does not exist", async () => {
    const { POST } = await loadRoute();
    const response = await POST(
      new Request("http://localhost/api/tests/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ email: "missing@example.com", password: "secret" }),
      })
    );

    assert.equal(response.status, 404);
    const payload = (await response.json()) as { error?: { code?: string } };
    assert.equal(payload.error?.code, "not_found");
  });

  test("updates the stored hash when the user exists", async () => {
    const { POST } = await loadRoute();
    const queries = await import("../../../lib/db/queries");

    const email = "playwright-reset@example.com";
    await queries.createUser(email, "initial-password");

    const response = await POST(
      new Request("http://localhost/api/tests/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ email, password: "new-password" }),
      })
    );

    assert.equal(response.status, 200);
    const payload = (await response.json()) as { status?: string };
    assert.equal(payload.status, "updated");

    const users = await queries.getUser(email);
    assert.equal(users.length, 1);
    const updatedUser = users[0]!;
    assert.notEqual(updatedUser.password, null);
  });
});

