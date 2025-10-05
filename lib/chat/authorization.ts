import type { Session } from "next-auth";

import { ChatSDKError } from "@/lib/errors";

/**
 * Ensure the caller holds a regular session before invoking chat-specific
 * server actions. The helper centralises the guard so both the API route and
 * potential server actions reuse the same error semantics.
 */
export function assertRegularChatUser(session: Session | null | undefined) {
  if (!session?.user) {
    throw new ChatSDKError(
      "unauthorized:chat",
      "You need to sign in to continue this conversation."
    );
  }

  if (session.user.type !== "regular") {
    throw new ChatSDKError(
      "forbidden:auth",
      "A regular account is required to send chat messages."
    );
  }

  return session.user;
}
