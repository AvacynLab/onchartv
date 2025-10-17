import { cache } from "react";
import type { Session } from "next-auth";

import { auth } from "../(auth)/auth";

/**
 * Returns the NextAuth session associated with the current request. The result
 * is cached per render pass so nested segments can reuse the session without
 * triggering additional provider calls.
 */
export const loadChatSession = cache(async (): Promise<Session | null> => {
  return auth();
});

/**
 * Fetches the cached session and ensures it belongs to a regular account. The
 * chat experience only supports regular users; returning `null` signals that
 * the caller should redirect to the login screen.
 */
export async function requireRegularChatSession(): Promise<Session | null> {
  const session = await loadChatSession();

  if (!session || session.user?.type !== "regular") {
    return null;
  }

  return session;
}
