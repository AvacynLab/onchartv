import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  __summarisePlaywrightStoreForTests,
  type __InMemoryStoreForTests,
} from "@/lib/db/queries";

function createStore(): __InMemoryStoreForTests {
  return {
    users: new Map(),
    userPlaintextPasswords: new Map(),
    userPlaintextByEmail: new Map(),
    chats: new Map(),
    messages: new Map(),
    votes: new Map(),
    documents: new Map(),
    suggestions: new Map(),
    streams: new Map(),
    assets: new Map(),
    assetsBySymbolExchange: new Map(),
    watchlists: new Map(),
    watchlistItems: new Map(),
    strategies: new Map(),
    strategyVersions: new Map(),
    backtestRuns: new Map(),
    indicatorConfigs: new Map(),
    newsItems: new Map(),
    financePreferences: new Map(),
  };
}

describe("__summarisePlaywrightStoreForTests", () => {
  it("summarises core metrics for debugging", () => {
    const store = createStore();

    store.users.set("user-1", {
      id: "user-1",
      email: "User@example.com",
      password: "hashed",
      type: "regular",
      name: "User@example.com",
    });

    store.userPlaintextPasswords.set("user-1", "plaintext123");
    store.userPlaintextByEmail.set("user@example.com", "plaintext123");

    const summary = __summarisePlaywrightStoreForTests(store, {
      targetEmail: "user@example.com",
    });

    expect(summary.totalUsers).toBe(1);
    expect(summary.totalPlaintextPasswords).toBe(1);
    expect(summary.sampleUserIds).toEqual(["user-1"]);
    expect(summary.sampleEmails).toEqual(["user@example.com"]);
    expect(summary.target).toEqual({
      email: "user@example.com",
      presentInUsers: true,
      presentInPlaintext: true,
      plaintextLength: "plaintext123".length,
      userId: "user-1",
    });
  });

  it("reports absence when the target user is missing", () => {
    const store = createStore();
    const summary = __summarisePlaywrightStoreForTests(store, {
      targetEmail: "missing@example.com",
    });

    expect(summary.target).toEqual({
      email: "missing@example.com",
      presentInUsers: false,
      presentInPlaintext: false,
      plaintextLength: null,
      userId: null,
    });
  });
});
