import { createElement } from "react";
import { redirect } from "next/navigation";

import ChatPage from "@/app/(chat)/chat/page";

import { auth } from "../(auth)/auth";

/**
 * Entry point for the chat experience. We gate access to the nested `chat`
 * route at this segment level so both `/` (which aliases the chat dashboard)
 * and `/chat` share the same regular-session requirement.
 */
export default async function Page() {
  const session = await auth();

  if (!session || session.user?.type !== "regular") {
    /**
     * Redirect unauthenticated and guest users to the credentialed login flow.
     * The Playwright bootstrap seeds a regular account ahead of time, so the
     * navigation remains deterministic for the entire E2E suite.
     */
    redirect("/login");
  }

  // Using `createElement` avoids relying on the automatic JSX runtime during
  // isolated Vitest executions while producing the same markup as `<ChatPage />`.
  return createElement(ChatPage, { prefetchedSession: session });
}
