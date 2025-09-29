import type { SWRInfiniteConfiguration } from "swr/infinite";
import type { Chat } from "@/lib/db/schema";

/**
 * Number of chat records to request per `/api/history` page.
 *
 * Shared between the client sidebar and the server layout so both sides stay
 * in sync when seeding initial data for Playwright runs.
 */
export const HISTORY_PAGE_SIZE = 20;

/**
 * A single page of chat history data as returned by the `/api/history` route.
 *
 * The Playwright suite consumes this shape directly when rendering the
 * sidebar, so we keep the definition in a shared module instead of duplicating
 * it in client components and server routes.
 */
export type ChatHistoryPage = {
  chats: Chat[];
  hasMore: boolean;
};

/**
 * Determines whether the Playwright feature flag is active for the current
 * execution environment. When enabled we must avoid live network fetches so
 * end-to-end tests can run in a fully hermetic mode.
 */
export function isPlaywrightFeatureEnabled(
  env: Partial<Record<string, string | undefined>> = process.env
): boolean {
  return env.PLAYWRIGHT === "true" || env.NEXT_PUBLIC_PLAYWRIGHT === "true";
}

/**
 * Builds a deterministic SWR configuration for the chat history hook. When we
 * run the Playwright suite we pause revalidation entirely so the browser never
 * attempts to hit the `/api/history` endpoint.
 */
export function createHistorySWRConfig(
  {
    initialPage,
    pause,
  }: {
    initialPage?: ChatHistoryPage;
    pause: boolean;
  }
): Partial<SWRInfiniteConfiguration<ChatHistoryPage>> {
  const fallbackData = initialPage ? [initialPage] : [];

  if (!pause) {
    return {
      fallbackData,
      revalidateFirstPage: true,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      revalidateIfStale: true,
    } satisfies Partial<SWRInfiniteConfiguration<ChatHistoryPage>>;
  }

  return {
    fallbackData,
    dedupingInterval: Infinity,
    isPaused: () => true,
    refreshInterval: 0,
    revalidateFirstPage: false,
    revalidateIfStale: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  } satisfies Partial<SWRInfiniteConfiguration<ChatHistoryPage>>;
}
