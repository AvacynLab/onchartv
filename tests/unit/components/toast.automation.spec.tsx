import React from "react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// Ensure the classic `React` global is available for components that still
// reference it during Vitest's CommonJS transformations.
(globalThis as unknown as { React: typeof React }).React = React;

vi.mock("sonner", () => ({
  toast: {
    dismiss: vi.fn(),
    custom: vi.fn(),
  },
}));

import { toast } from "@/components/toast";

const AUTOMATION_BRIDGE_ID = "automation-toast-bridge";
const AUTOMATION_TOAST_LIFETIME_MS = 4_000;

describe("toast automation bridge", () => {
  let originalWebdriver: boolean | undefined;
  let originalUserAgent: string | undefined;

  beforeEach(() => {
    if (typeof navigator !== "undefined") {
      const automationNavigator = navigator as Navigator & { webdriver?: boolean };
      originalWebdriver = automationNavigator.webdriver;
      originalUserAgent = automationNavigator.userAgent;

      Object.defineProperty(navigator, "webdriver", {
        configurable: true,
        value: true,
      });

      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        value: originalUserAgent ?? "Mozilla/5.0",
      });
    }

    document.body.innerHTML = "";
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (typeof navigator !== "undefined") {
      const automationNavigator = navigator as Navigator & { webdriver?: boolean };
      if (originalWebdriver === undefined) {
        // biome-ignore lint/performance/noDelete: clean up the automation stub between specs.
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete automationNavigator.webdriver;
      } else {
        Object.defineProperty(navigator, "webdriver", {
          configurable: true,
          value: originalWebdriver,
        });
      }

      if (originalUserAgent === undefined) {
        // biome-ignore lint/performance/noDelete: clean up the automation stub between specs.
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete (navigator as Navigator & { userAgent?: string }).userAgent;
      } else {
        Object.defineProperty(navigator, "userAgent", {
          configurable: true,
          value: originalUserAgent,
        });
      }
    }

    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("mirrors toast payloads into an automation-visible element", () => {
    toast({ type: "success", description: "Automation ready" });

    const bridge = document.getElementById(AUTOMATION_BRIDGE_ID);

    expect(bridge).not.toBeNull();
    expect(bridge).toHaveAttribute("data-testid", "toast");
    expect(bridge).toHaveTextContent("Automation ready");
    expect(bridge).toHaveAttribute("data-type", "success");
  });

  it("cleans up the automation bridge after the display timeout elapses", () => {
    toast({ type: "error", description: "Transient failure" });

    const bridge = document.getElementById(AUTOMATION_BRIDGE_ID);
    expect(bridge).not.toBeNull();

    vi.advanceTimersByTime(AUTOMATION_TOAST_LIFETIME_MS);

    expect(document.getElementById(AUTOMATION_BRIDGE_ID)).toBeNull();
  });

  it("activates when running under headless automation user agents", () => {
    if (typeof navigator === "undefined") {
      throw new Error("Navigator should be defined in the test environment");
    }

    Object.defineProperty(navigator, "webdriver", {
      configurable: true,
      value: false,
    });

    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36",
    });

    toast({ type: "success", description: "Headless detection" });

    const bridge = document.getElementById(AUTOMATION_BRIDGE_ID);
    expect(bridge).not.toBeNull();
    expect(bridge).toHaveTextContent("Headless detection");
  });
});
