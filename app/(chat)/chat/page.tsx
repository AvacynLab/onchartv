import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { Chat } from "@/components/chat";
import { DataStreamHandler } from "@/components/data-stream-handler";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { generateUUID } from "@/lib/utils";

import { auth } from "../../(auth)/auth";

/**
 * Server component responsible for provisioning a brand new chat surface.
 * Regular sessions land here after authentication; guests are bounced back to
 * `/login` where the Playwright harness provisions credentials.
 */
export default async function Page() {
  const session = await auth();

  if (!session || session.user.type !== "regular") {
    // Regular accounts are required for the chat surface; guests are routed to
    // the credentials login flow where the E2E setup provisions a session.
    redirect("/login");
  }

  const id = generateUUID();

  const cookieStore = await cookies();
  const modelIdFromCookie = cookieStore.get("chat-model");

  if (!modelIdFromCookie) {
    return (
      <>
        <Chat
          autoResume={false}
          id={id}
          initialChatModel={DEFAULT_CHAT_MODEL}
          initialMessages={[]}
          initialVisibilityType="private"
          isReadonly={false}
          key={id}
        />
        <DataStreamHandler />
      </>
    );
  }

  return (
    <>
      <Chat
        autoResume={false}
        id={id}
        initialChatModel={modelIdFromCookie.value}
        initialMessages={[]}
        initialVisibilityType="private"
        isReadonly={false}
        key={id}
      />
      <DataStreamHandler />
    </>
  );
}
