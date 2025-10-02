import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  groupChatsByDate,
  selectHistoryPagesForRender,
} from "@/components/sidebar-history.utils";
import type { Chat } from "@/lib/db/schema";

type ChatOverrides = Partial<Chat> & { readonly createdAt: Date };

function buildChat(overrides: ChatOverrides): Chat {
  return {
    id: overrides.id ?? randomUUID(),
    createdAt: overrides.createdAt,
    title: overrides.title ?? "Test Chat",
    userId: overrides.userId ?? "user-1",
    visibility: overrides.visibility ?? "private",
    lastContext: overrides.lastContext ?? null,
  } satisfies Chat;
}

describe("groupChatsByDate", () => {
  it("groups chats relative to the provided reference date", () => {
    const referenceDate = new Date("2024-06-15T12:00:00Z");

    const chats: Chat[] = [
      buildChat({ id: "today", createdAt: new Date("2024-06-15T08:00:00Z") }),
      buildChat({ id: "yesterday", createdAt: new Date("2024-06-14T18:30:00Z") }),
      buildChat({ id: "last-week", createdAt: new Date("2024-06-10T09:00:00Z") }),
      buildChat({ id: "last-month", createdAt: new Date("2024-05-25T14:00:00Z") }),
      buildChat({ id: "older", createdAt: new Date("2024-04-10T09:00:00Z") }),
    ];

    const grouped = groupChatsByDate(chats, referenceDate);

    expect(grouped.today.map((chat) => chat.id)).toEqual(["today"]);
    expect(grouped.yesterday.map((chat) => chat.id)).toEqual(["yesterday"]);
    expect(grouped.lastWeek.map((chat) => chat.id)).toEqual(["last-week"]);
    expect(grouped.lastMonth.map((chat) => chat.id)).toEqual(["last-month"]);
    expect(grouped.older.map((chat) => chat.id)).toEqual(["older"]);
  });

  it("does not mutate the provided reference date", () => {
    const referenceDate = new Date("2024-03-20T00:00:00Z");
    const originalTimestamp = referenceDate.getTime();

    const chats: Chat[] = [
      buildChat({ id: "sample", createdAt: new Date("2024-03-19T10:00:00Z") }),
    ];

    groupChatsByDate(chats, referenceDate);

    expect(referenceDate.getTime()).toBe(originalTimestamp);
  });
});

describe("selectHistoryPagesForRender", () => {
  const samplePage = (id: string): { chats: Chat[]; hasMore: boolean } => ({
    chats: [
      buildChat({
        id,
        createdAt: new Date("2024-03-18T09:00:00Z"),
      }),
    ],
    hasMore: false,
  });

  it("returns the server snapshot before hydration completes", () => {
    const snapshot = [samplePage("initial")];
    const currentPages = [samplePage("client")];

    const pages = selectHistoryPagesForRender({
      currentPages,
      initialSnapshot: snapshot,
      hasHydrated: false,
    });

    expect(pages).toBe(snapshot);
  });

  it("prefers the live SWR pages once hydration completes", () => {
    const snapshot = [samplePage("initial")];
    const currentPages = [samplePage("client")];

    const pages = selectHistoryPagesForRender({
      currentPages,
      initialSnapshot: snapshot,
      hasHydrated: true,
    });

    expect(pages).toBe(currentPages);
  });

  it("falls back to the snapshot when hydration completes but SWR has no data yet", () => {
    const snapshot = [samplePage("initial")];

    const pages = selectHistoryPagesForRender({
      currentPages: null,
      initialSnapshot: snapshot,
      hasHydrated: true,
    });

    expect(pages).toBe(snapshot);
  });
});
