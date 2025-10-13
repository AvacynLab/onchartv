import type { Locator, Page } from "@playwright/test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const toContainText = vi.fn();
const expectMock = vi.fn(() => ({ toContainText }));

vi.mock("../../fixtures", () => ({
  expect: expectMock,
}));

type AuthModule = typeof import("../../pages/auth");
let AuthPage: AuthModule["AuthPage"];

beforeAll(async () => {
  ({ AuthPage } = await import("../../pages/auth"));
});

/**
 * Build a lightweight locator pair that mimics the Sonner toast handle exposed
 * to Playwright so the unit tests can drive the AuthPage helper without
 * booting a browser environment.
 */
const createToastLocator = () => {
  const waitFor = vi.fn();
  const innerText = vi.fn().mockResolvedValue("Account created successfully!");

  const toastHandle = {
    waitFor,
    innerText,
  } as unknown as Locator;

  const locatorHandle = {
    first: vi.fn(() => toastHandle),
  };

  return { toastHandle, locatorHandle, waitFor, innerText };
};

describe("AuthPage.expectToastToContain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("waits for a visible toast before asserting its contents", async () => {
    const { toastHandle, locatorHandle, waitFor } = createToastLocator();
    waitFor.mockResolvedValue(undefined);

    const page = {
      locator: vi.fn(() => locatorHandle),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } satisfies Partial<Page> as Page;

    const authPage = new AuthPage(page);

    await authPage.expectToastToContain("Account created successfully!");

    expect(waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 60_000 });
    expect(expectMock).toHaveBeenCalledWith(toastHandle);
    expect(toContainText).toHaveBeenCalledWith("Account created successfully!");
  });

  it("falls back to an attached toast when visibility timing is flaky", async () => {
    const { toastHandle, locatorHandle, waitFor } = createToastLocator();
    waitFor.mockImplementation(async ({ state }) => {
      if (state === "visible") {
        throw new Error("not yet visible");
      }
      return undefined;
    });

    const page = {
      locator: vi.fn(() => locatorHandle),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } satisfies Partial<Page> as Page;

    const authPage = new AuthPage(page);

    await authPage.expectToastToContain("Account created successfully!");

    expect(waitFor).toHaveBeenCalledWith({ state: "attached", timeout: 5_000 });
    expect(page.waitForTimeout).toHaveBeenCalledWith(100);
    expect(expectMock).toHaveBeenCalledWith(toastHandle);
    expect(toContainText).toHaveBeenCalledWith("Account created successfully!");
  });

  it("throws a descriptive error when no toast ever renders", async () => {
    const { locatorHandle, waitFor } = createToastLocator();
    waitFor.mockImplementation(async () => {
      throw new Error("toast missing");
    });

    const page = {
      locator: vi.fn(() => locatorHandle),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } satisfies Partial<Page> as Page;

    const authPage = new AuthPage(page);

    await expect(
      authPage.expectToastToContain("Account created successfully!")
    ).rejects.toThrowError(
      'Timed out waiting for toast containing: "Account created successfully!"'
    );

    expect(waitFor).toHaveBeenCalledWith({ state: "attached", timeout: 5_000 });
    expect(expectMock).not.toHaveBeenCalled();
  });
});
