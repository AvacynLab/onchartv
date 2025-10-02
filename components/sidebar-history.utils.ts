import { isSameDay, subDays, subMonths, subWeeks } from "date-fns";

import type { Chat } from "@/lib/db/schema";
import type { ChatHistoryPage } from "@/lib/history/config";

export type GroupedChats = {
  today: Chat[];
  yesterday: Chat[];
  lastWeek: Chat[];
  lastMonth: Chat[];
  older: Chat[];
};

/**
 * Snapshot of the paginated chat history returned by the sidebar SWR hook.
 *
 * We keep the type in this module so both the component and its tests can
 * reason about the render-time value without reimporting the full SWR hook
 * implementation.
 */
export type ChatHistoryPagesSnapshot =
  | readonly ChatHistoryPage[]
  | null
  | undefined;

/**
 * Selects the chat history pages that should be rendered during the current
 * React pass, ensuring the markup produced on the server matches the markup we
 * ship to the browser before hydration completes.
 *
 * The initial snapshot reflects the data serialized during SSR. Until the
 * `useEffect` hook flips the `hasHydrated` flag we must continue rendering that
 * snapshot so the sidebar does not oscillate between an empty skeleton and a
 * populated list, which previously triggered the Playwright hydration overlay.
 */
export function selectHistoryPagesForRender({
  currentPages,
  initialSnapshot,
  hasHydrated,
}: {
  currentPages: ChatHistoryPagesSnapshot;
  initialSnapshot: ChatHistoryPagesSnapshot;
  hasHydrated: boolean;
}): ChatHistoryPagesSnapshot {
  if (hasHydrated) {
    return currentPages ?? initialSnapshot;
  }

  return initialSnapshot ?? currentPages;
}

export function groupChatsByDate(
  chats: Chat[],
  referenceDate: Date
): GroupedChats {
  const oneWeekAgo = subWeeks(referenceDate, 1);
  const oneMonthAgo = subMonths(referenceDate, 1);
  const yesterdayReference = subDays(referenceDate, 1);

  return chats.reduce(
    (groups, chat) => {
      const chatDate = new Date(chat.createdAt);

      if (isSameDay(chatDate, referenceDate)) {
        groups.today.push(chat);
      } else if (isSameDay(chatDate, yesterdayReference)) {
        groups.yesterday.push(chat);
      } else if (chatDate > oneWeekAgo) {
        groups.lastWeek.push(chat);
      } else if (chatDate > oneMonthAgo) {
        groups.lastMonth.push(chat);
      } else {
        groups.older.push(chat);
      }

      return groups;
    },
    {
      today: [],
      yesterday: [],
      lastWeek: [],
      lastMonth: [],
      older: [],
    } as GroupedChats
  );
}
