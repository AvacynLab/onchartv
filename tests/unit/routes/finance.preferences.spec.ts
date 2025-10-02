const originalPlaywright = process.env.PLAYWRIGHT;
// Use the canonical "true" marker so the finance preferences route thinks it
// runs under Playwright, matching the CI and e2e environment contract.
process.env.PLAYWRIGHT = "true";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { __resetRateLimitStateForTests } from "@/lib/ratelimit";

vi.mock("server-only", () => ({}));
vi.mock("@/app/(auth)/auth", () => ({ auth: vi.fn() }));

describe("/api/finance/preferences", () => {
  beforeEach(async () => {
    __resetRateLimitStateForTests();
    vi.resetModules();
    vi.doMock("server-only", () => ({}));
    vi.doMock("@/app/(auth)/auth", () => ({ auth: vi.fn() }));
    const queries = await import("@/lib/db/queries");
    queries.__resetInMemoryDbForTests();
    const { auth } = await import("@/app/(auth)/auth");
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "user-1",
        type: "regular",
        email: "demo@example.com",
        name: "Demo",
        image: null,
      },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as any);
  });

  afterEach(() => {
    __resetRateLimitStateForTests();
    vi.clearAllMocks();
  });

  afterAll(() => {
    if (originalPlaywright) {
      process.env.PLAYWRIGHT = originalPlaywright;
    } else {
      delete process.env.PLAYWRIGHT;
    }
  });

  it("returns default preferences when none are stored", async () => {
    const { GET } = await import("@/app/api/finance/preferences/route");
    const response = await GET(
      new Request("http://localhost/api/finance/preferences")
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as any;
    expect(payload.preferences.markets).toContain("US_EQUITIES");
    expect(payload.source).toBe("default");
  });

  it("persists updated preferences", async () => {
    const { PATCH, GET } = await import(
      "@/app/api/finance/preferences/route"
    );
    const body = {
      markets: ["CRYPTO", "US_EQUITIES"],
      defaultIndicators: [
        { type: "sma", length: 34 },
        { type: "ema", length: 21 },
      ],
      explanationLevel: "detailed",
      showNews: false,
    };

    const patchResponse = await PATCH(
      new Request("http://localhost/api/finance/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    );

    expect(patchResponse.status).toBe(200);
    const saved = (await patchResponse.json()) as any;
    expect(saved.preferences.showNews).toBe(false);
    expect(saved.preferences.defaultIndicators).toHaveLength(2);
    expect(saved.source).toBe("database");

    const queries = await import("@/lib/db/queries");
    const record = await queries.getFinancePreferencesByUserId({
      userId: "user-1",
    });
    expect(record?.explanationLevel).toBe("detailed");

    const getResponse = await GET(
      new Request("http://localhost/api/finance/preferences")
    );
    const payload = (await getResponse.json()) as any;
    expect(payload.source).toBe("database");
    expect(payload.preferences.defaultIndicators).toHaveLength(2);
  });

  it("rejects invalid payloads", async () => {
    const { PATCH } = await import("@/app/api/finance/preferences/route");
    const response = await PATCH(
      new Request("http://localhost/api/finance/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markets: [] }),
      })
    );

    expect(response.status).toBe(400);
  });
});
