"use client";
import { motion } from "framer-motion";
import { useParams, useRouter } from "next/navigation";
import type { User } from "next-auth";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWRInfinite from "swr/infinite";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  useSidebar,
} from "@/components/ui/sidebar";
import type { Chat } from "@/lib/db/schema";
import {
  HISTORY_PAGE_SIZE,
  createHistorySWRConfig,
  isPlaywrightFeatureEnabled,
  type ChatHistoryPage,
} from "@/lib/history/config";
import { fetcher } from "@/lib/utils";
import { LoaderIcon } from "./icons";
import { ChatItem } from "./sidebar-history-item";
import {
  groupChatsByDate,
  selectHistoryPagesForRender,
} from "./sidebar-history.utils";

export type ChatHistory = ChatHistoryPage;

export function getChatHistoryPaginationKey(
  pageIndex: number,
  previousPageData: ChatHistory
) {
  if (previousPageData && previousPageData.hasMore === false) {
    return null;
  }

  if (pageIndex === 0) {
    return `/api/history?limit=${HISTORY_PAGE_SIZE}`;
  }

  const firstChatFromPage = previousPageData.chats.at(-1);

  if (!firstChatFromPage) {
    return null;
  }

  return `/api/history?ending_before=${firstChatFromPage.id}&limit=${HISTORY_PAGE_SIZE}`;
}

type SidebarHistoryProps = {
  /**
   * Initial history payload rendered on the server. When provided we can skip
   * the first `/api/history` fetch and keep Playwright's offline runs hermetic.
   */
  initialHistory?: ChatHistory | null;
  user: User | undefined;
};

export function SidebarHistory({ initialHistory, user }: SidebarHistoryProps) {
  const { setOpenMobile } = useSidebar();
  const { id } = useParams();
  /**
   * Capture the server-rendered timestamp once so the client reuses the same
   * reference point after hydration. Without this guard the grouping logic
   * would call `Date.now()` during each render, causing the server and client
   * to disagree about whether a chat belongs to "Today" or "Yesterday" and
   * crashing the app with a hydration error during Playwright runs.
   */
  const [groupingTimestamp] = useState(() => Date.now());
  const groupingReferenceDate = useMemo(
    () => new Date(groupingTimestamp),
    [groupingTimestamp]
  );

  const shouldPauseFetches = isPlaywrightFeatureEnabled();
  const historyConfig = useMemo(
    () =>
      createHistorySWRConfig({
        initialPage: initialHistory ?? undefined,
        pause: shouldPauseFetches,
      }),
    [initialHistory, shouldPauseFetches]
  );

  const {
    data: paginatedChatHistories,
    setSize,
    isValidating,
    isLoading,
    mutate,
  } = useSWRInfinite<ChatHistory>(
    getChatHistoryPaginationKey,
    fetcher,
    historyConfig
  );

  /**
   * Preserve the loading state observed during the server render so the client
   * does not flip from the skeleton view to the populated history during the
   * hydration pass. The SWR `isLoading` flag switches to `false` once the
   * browser resolves the first request, but we only want to show the skeleton
   * while the initial payload is genuinely unavailable.
   */
  const [initialLoading] = useState(() => isLoading);
  const [hasHydrated, setHasHydrated] = useState(false);
  /**
   * Preserve the server-rendered chat history snapshot so the first client
   * render mirrors the markup that Next.js streamed. Without this guard the
   * sidebar could briefly render an empty skeleton while the SWR cache warms
   * up, which previously produced a hydration mismatch during Playwright runs.
   */
  const [initialChatHistoryPages] = useState(
    () => paginatedChatHistories ?? null
  );

  const historyPagesForRender = selectHistoryPagesForRender({
    currentPages: paginatedChatHistories ?? null,
    initialSnapshot: initialChatHistoryPages,
    hasHydrated,
  });

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const router = useRouter();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const hasReachedEnd = historyPagesForRender
    ? historyPagesForRender.some((page) => page.hasMore === false)
    : false;

  const hasEmptyChatHistory = historyPagesForRender
    ? historyPagesForRender.every((page) => page.chats.length === 0)
    : false;

  const handleDelete = () => {
    const deletePromise = fetch(`/api/chat?id=${deleteId}`, {
      method: "DELETE",
    });

    toast.promise(deletePromise, {
      loading: "Deleting chat...",
      success: () => {
        mutate((chatHistories) => {
          if (chatHistories) {
            return chatHistories.map((chatHistory) => ({
              ...chatHistory,
              chats: chatHistory.chats.filter((chat) => chat.id !== deleteId),
            }));
          }
        });

        return "Chat deleted successfully";
      },
      error: "Failed to delete chat",
    });

    setShowDeleteDialog(false);

    if (deleteId === id) {
      router.push("/");
    }
  };

  if (!user) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <div className="flex w-full flex-row items-center justify-center gap-2 px-2 text-sm text-zinc-500">
            Login to save and revisit previous chats!
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (
    !hasHydrated &&
    initialLoading &&
    (!historyPagesForRender || historyPagesForRender.length === 0)
  ) {
    return (
      <SidebarGroup>
        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
          Today
        </div>
        <SidebarGroupContent>
          <div className="flex flex-col">
            {[44, 32, 28, 64, 52].map((item) => (
              <div
                className="flex h-8 items-center gap-2 rounded-md px-2"
                key={item}
              >
                <div
                  className="h-4 max-w-(--skeleton-width) flex-1 rounded-md bg-sidebar-accent-foreground/10"
                  style={
                    {
                      "--skeleton-width": `${item}%`,
                    } as React.CSSProperties
                  }
                />
              </div>
            ))}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (hasEmptyChatHistory) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <div className="flex w-full flex-row items-center justify-center gap-2 px-2 text-sm text-zinc-500">
            Your conversations will appear here once you start chatting!
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {historyPagesForRender &&
              (() => {
                const chatsFromHistory = historyPagesForRender.flatMap(
                  (paginatedChatHistory) => paginatedChatHistory.chats
                );

                const groupedChats = groupChatsByDate(
                  chatsFromHistory,
                  groupingReferenceDate
                );

                return (
                  <div className="flex flex-col gap-6">
                    {groupedChats.today.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
                          Today
                        </div>
                        {groupedChats.today.map((chat) => (
                          <ChatItem
                            chat={chat}
                            isActive={chat.id === id}
                            key={chat.id}
                            onDelete={(chatId) => {
                              setDeleteId(chatId);
                              setShowDeleteDialog(true);
                            }}
                            setOpenMobile={setOpenMobile}
                          />
                        ))}
                      </div>
                    )}

                    {groupedChats.yesterday.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
                          Yesterday
                        </div>
                        {groupedChats.yesterday.map((chat) => (
                          <ChatItem
                            chat={chat}
                            isActive={chat.id === id}
                            key={chat.id}
                            onDelete={(chatId) => {
                              setDeleteId(chatId);
                              setShowDeleteDialog(true);
                            }}
                            setOpenMobile={setOpenMobile}
                          />
                        ))}
                      </div>
                    )}

                    {groupedChats.lastWeek.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
                          Last 7 days
                        </div>
                        {groupedChats.lastWeek.map((chat) => (
                          <ChatItem
                            chat={chat}
                            isActive={chat.id === id}
                            key={chat.id}
                            onDelete={(chatId) => {
                              setDeleteId(chatId);
                              setShowDeleteDialog(true);
                            }}
                            setOpenMobile={setOpenMobile}
                          />
                        ))}
                      </div>
                    )}

                    {groupedChats.lastMonth.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
                          Last 30 days
                        </div>
                        {groupedChats.lastMonth.map((chat) => (
                          <ChatItem
                            chat={chat}
                            isActive={chat.id === id}
                            key={chat.id}
                            onDelete={(chatId) => {
                              setDeleteId(chatId);
                              setShowDeleteDialog(true);
                            }}
                            setOpenMobile={setOpenMobile}
                          />
                        ))}
                      </div>
                    )}

                    {groupedChats.older.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
                          Older than last month
                        </div>
                        {groupedChats.older.map((chat) => (
                          <ChatItem
                            chat={chat}
                            isActive={chat.id === id}
                            key={chat.id}
                            onDelete={(chatId) => {
                              setDeleteId(chatId);
                              setShowDeleteDialog(true);
                            }}
                            setOpenMobile={setOpenMobile}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
          </SidebarMenu>

          <motion.div
            onViewportEnter={() => {
              if (!isValidating && !hasReachedEnd) {
                setSize((size) => size + 1);
              }
            }}
          />

          {hasReachedEnd ? (
            <div className="mt-8 flex w-full flex-row items-center justify-center gap-2 px-2 text-sm text-zinc-500">
              You have reached the end of your chat history.
            </div>
          ) : (
            <div className="mt-8 flex flex-row items-center gap-2 p-2 text-zinc-500 dark:text-zinc-400">
              <div className="animate-spin">
                <LoaderIcon />
              </div>
              <div>Loading Chats...</div>
            </div>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

      <AlertDialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete your
              chat and remove it from our servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
