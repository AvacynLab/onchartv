import { describe, expect, it } from "vitest";

import { resolveHealthProbeBaseURL } from "../../utils/ci-wait-for-health";

describe("resolveHealthProbeBaseURL", () => {
  it("returns the explicit Playwright base URL when provided", () => {
    const baseURL = resolveHealthProbeBaseURL({
      PLAYWRIGHT_TEST_BASE_URL: "http://192.0.2.10:4100",
    } as NodeJS.ProcessEnv);

    expect(baseURL).toBe("http://192.0.2.10:4100");
  });

  it("prefers an explicit PORT override before heuristics", () => {
    const baseURL = resolveHealthProbeBaseURL({
      PORT: "5555",
    } as NodeJS.ProcessEnv);

    expect(baseURL).toBe("http://127.0.0.1:5555");
  });

  it("targets the hermetic Playwright port when flags are enabled", () => {
    const baseURL = resolveHealthProbeBaseURL({
      PLAYWRIGHT: "true",
    } as NodeJS.ProcessEnv);

    expect(baseURL).toBe("http://127.0.0.1:3100");
  });

  it("defaults to the local developer port when no flags are set", () => {
    const baseURL = resolveHealthProbeBaseURL({} as NodeJS.ProcessEnv);

    expect(baseURL).toBe("http://127.0.0.1:3000");
  });
});
