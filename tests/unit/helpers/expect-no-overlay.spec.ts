import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Locator, Page } from "@playwright/test";

const mocks = vi.hoisted(() => {
  const toHaveCountMock = vi.fn();
  const expectMock = vi.fn();

  return { expectMock, toHaveCountMock };
});

vi.mock("@playwright/test", () => ({
  expect: mocks.expectMock,
}));

/**
 * Mirror the helper's artifact directory so the tests can assert on the
 * generated screenshot paths without reaching into implementation details.
 */
const overlayArtifactsDir = path.join(
  process.cwd(),
  "playwright-results",
  "overlays"
);

const { expectNoApplicationErrorOverlay } = await import("../../helpers");

describe("expectNoApplicationErrorOverlay", () => {
  beforeEach(() => {
    mocks.expectMock.mockClear();
    mocks.expectMock.mockReturnValue({
      toHaveCount: mocks.toHaveCountMock,
    });
    mocks.toHaveCountMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    mocks.expectMock.mockReset();
    mocks.toHaveCountMock.mockReset();

    const resultsDir = path.join(process.cwd(), "playwright-results");
    if (fs.existsSync(resultsDir)) {
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  it("confirms no overlay is present when the locator count stays at zero", async () => {
    mocks.toHaveCountMock.mockResolvedValue(undefined);

    const locator = {} as Locator;
    const screenshot = vi.fn();
    const page = {
      getByText: vi.fn().mockReturnValue(locator),
      screenshot,
    } as unknown as Page;

    await expect(expectNoApplicationErrorOverlay(page)).resolves.toBeUndefined();

    expect(page.getByText).toHaveBeenCalledWith(
      expect.stringContaining("client-side exception"),
      {
        exact: false,
      }
    );
    expect(mocks.expectMock).toHaveBeenCalledWith(locator);
    expect(mocks.toHaveCountMock).toHaveBeenCalledWith(0);
    expect(screenshot).not.toHaveBeenCalled();
  });

  it("captures a screenshot and rethrows when the overlay appears", async () => {
    const overlayError = new Error("expected 0 to equal 1");
    mocks.toHaveCountMock.mockRejectedValueOnce(overlayError);

    const locator = {} as Locator;
    const screenshot = vi.fn().mockResolvedValue(undefined);
    const page = {
      getByText: vi.fn().mockReturnValue(locator),
      screenshot,
    } as unknown as Page;

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-02T03:04:05.678Z"));

    await expect(expectNoApplicationErrorOverlay(page)).rejects.toBe(
      overlayError
    );

    const expectedScreenshotPath = path.join(
      overlayArtifactsDir,
      "overlay-2025-01-02T03-04-05.678Z.png"
    );
    const expectedRelativePath = path
      .relative(process.cwd(), expectedScreenshotPath)
      .split(path.sep)
      .join("/");

    expect(screenshot).toHaveBeenCalledWith({
      fullPage: true,
      path: expectedScreenshotPath,
    });

    expect(fs.existsSync(overlayArtifactsDir)).toBe(true);
    expect(overlayError.message).toContain(
      `Next.js overlay screenshot saved to: ${expectedRelativePath}`
    );
    expect(fs.existsSync(expectedScreenshotPath)).toBe(false);
  });
});
