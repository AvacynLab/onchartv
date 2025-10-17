import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Memoisation keeps the dummy password hash consistent while avoiding repeated
 * bcrypt work. These assertions guarantee that the helper only computes the
 * hash once per process, making the Playwright setup efficient without leaking
 * implementation details into the rest of the authentication stack.
 */
describe("getDummyPassword", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("memoises the generated dummy password hash", async () => {
    const utilsModule = await import("@/lib/db/utils");
    const dummyHash = "hashed-dummy-password";
    const generateSpy = vi
      .spyOn(utilsModule, "generateDummyPassword")
      .mockReturnValue(dummyHash);

    const { getDummyPassword } = await import("@/lib/auth/dummy-password");

    const first = getDummyPassword();
    const second = getDummyPassword();

    expect(first).toBe(dummyHash);
    expect(second).toBe(dummyHash);
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });
});
