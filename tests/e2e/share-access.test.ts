import { expect, test } from "../fixtures";
import { createAuthenticatedContext } from "../helpers";
import { generateUUID } from "@/lib/utils";

/**
 * End-to-end coverage verifying public share links remain read-only while the
 * application enforces the regular-authentication flow for access.
 */
test.describe.serial("Share access control", () => {
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

  test("Unauthenticated visitors are redirected to the login flow", async ({ page }) => {
    await page.context().clearCookies();

    await page.goto(`/share/${publicChatId}`);
    await page.waitForURL(/\/login\?callbackUrl=/);
    expect(page.url()).toContain(encodeURIComponent(`/share/${publicChatId}`));
  });

  test("Authenticated users can view shared chats in read-only mode", async ({ browser }) => {
    const viewer = await createAuthenticatedContext({
      browser,
      name: `share-viewer-${Date.now()}`,
    });

    try {
      await viewer.page.goto(`/share/${publicChatId}`);
      await viewer.page.waitForURL(`/share/${publicChatId}`);

      const sharedUserMessage = viewer.page.getByTestId("message-user").last();
      await expect(sharedUserMessage).toContainText(sharedMessageText);
    } finally {
      await viewer.context.close();
    }
  });

  test("Shared chats cannot be mutated by other regular accounts", async ({ browser }) => {
    const viewer = await createAuthenticatedContext({
      browser,
      name: `share-readonly-${Date.now()}`,
    });

    try {
      const forbiddenResponse = await viewer.request.post("/api/chat", {
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
      expect(responseBody).toMatchObject({
        error: { code: "forbidden:chat" },
      });
    } finally {
      await viewer.context.close();
    }
  });
});
