import { expect, test } from "../fixtures";
import { createAuthenticatedContext } from "../helpers";
import { generateUUID } from "@/lib/utils";

/**
 * End-to-end coverage ensuring the middleware grants guest-only access to
 * shared chats while still protecting the rest of the application.
 */
test.describe.serial("Guest share access control", () => {
  let publicChatId: string;
  const sharedMessageText = "Sharing is caring!";

  test.beforeAll(async ({ browser }) => {
    const shareAuthorContext = await createAuthenticatedContext({
      browser,
      name: `share-${Date.now()}`,
    });

    try {
      publicChatId = generateUUID();

      const response = await shareAuthorContext.request.post("/api/chat", {
        data: {
          id: publicChatId,
          message: {
            id: generateUUID(),
            role: "user",
            createdAt: new Date().toISOString(),
            content: sharedMessageText,
            parts: [{ type: "text", text: sharedMessageText }],
          },
          selectedChatModel: "chat-model",
          selectedVisibilityType: "public",
        },
      });

      expect(response.status()).toBe(200);
      // Consume the full stream so the chat is completely persisted for later checks.
      await response.text();
    } finally {
      await shareAuthorContext.context.close();
    }
  });

  test("Guests receive scoped access when opening a share link", async ({ page }) => {
    await page.context().clearCookies();

    await page.goto(`/share/${publicChatId}`);
    await expect(page).toHaveURL(`/share/${publicChatId}`);

    const sharedUserMessage = page.getByTestId("message-user").last();
    await expect(sharedUserMessage).toContainText(sharedMessageText);

    const sessionCookies = await page.context().cookies();
    // The presence of a NextAuth session cookie confirms the middleware issued
    // a scoped guest credential instead of forcing a full login.
    const hasNextAuthCookie = sessionCookies.some((cookie) =>
      cookie.name.includes("next-auth.session-token")
    );
    expect(hasNextAuthCookie).toBe(true);

    await page.goto("/");
    await page.waitForURL(/\/login\?callbackUrl=/);
    expect(page.url()).toContain("/login?callbackUrl=");
  });

  test("Guest share sessions cannot call protected APIs", async ({ page }) => {
    await page.context().clearCookies();

    await page.goto(`/share/${publicChatId}`);
    await expect(page).toHaveURL(`/share/${publicChatId}`);

    // Attempting to reuse the guest session for a protected API should fail.
    const forbiddenResponse = await page.request.post("/api/chat", {
      data: {
        id: publicChatId,
        message: {
          id: generateUUID(),
          role: "user",
          createdAt: new Date().toISOString(),
          content: "Should not work",
          parts: [{ type: "text", text: "Should not work" }],
        },
        selectedChatModel: "chat-model",
        selectedVisibilityType: "public",
      },
    });

    expect(forbiddenResponse.status()).toBe(403);

    const responseBody = await forbiddenResponse.json();
    expect(responseBody).toMatchObject({ code: "forbidden:chat" });
  });
});
