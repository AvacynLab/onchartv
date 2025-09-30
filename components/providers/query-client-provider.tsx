"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

/**
 * Provides a singleton {@link QueryClient} instance to the React subtree.
 *
 * Keeping the instantiation inside a component-level state avoids recreating
 * the client on every render, which would otherwise clear caches and trigger
 * unnecessary network requests. Default options intentionally disable
 * refetch-on-focus to prevent disruptive UI updates while analysts fine tune
 * their finance artefact parameters.
 */
export function AppQueryClientProvider({
  children,
}: Readonly<{ children: ReactNode }>): JSX.Element {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            /**
             * Finance preference fetches are deterministic thanks to the
             * hermetic mocks. Mark data as fresh for a minute to reduce
             * redundant requests while allowing explicit refetches via the UI.
             */
            staleTime: 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
          mutations: {
            retry: 0,
          },
        },
      })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
