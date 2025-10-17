import { expect, test } from "../fixtures";
import { ChatPage } from "../pages/chat";

test.describe("chat activity with reasoning", () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ curieContext }) => {
    chatPage = new ChatPage(curieContext.page);
    await chatPage.createNewChat();
  });

  test("Curie can send message and generate response with reasoning", async () => {
    await chatPage.sendUserMessage("Why is the sky blue?");
    await chatPage.isGenerationComplete();

    const assistantMessage = await chatPage.getRecentAssistantMessage();
    expect(assistantMessage.content).toBe("It's just blue duh!");

    expect(assistantMessage.reasoning).toBe(
      "The sky is blue because of rayleigh scattering!"
    );
  });

  test("Curie can toggle reasoning visibility", async () => {
    await chatPage.sendUserMessage("Why is the sky blue?");
    await chatPage.isGenerationComplete();

    const assistantMessage = await chatPage.getRecentAssistantMessage();
    const reasoningContent =
      assistantMessage.element.getByTestId("message-reasoning-content");

    // The accordion content stays mounted even when hidden, so we assert the
    // data-state transitions instead of relying on visibility checks that can
    // be racy with Tailwind’s exit animations.
    await expect(reasoningContent).toHaveAttribute("data-state", "open");

    await assistantMessage.toggleReasoningVisibility();
    await expect(reasoningContent).toHaveAttribute("data-state", "closed");
    await expect(reasoningContent).not.toBeVisible();

    await assistantMessage.toggleReasoningVisibility();
    await expect(reasoningContent).toHaveAttribute("data-state", "open");
    await expect(reasoningContent).toBeVisible();
  });

  test("Curie can edit message and resubmit", async () => {
    await chatPage.sendUserMessage("Why is the sky blue?");
    await chatPage.isGenerationComplete();

    const assistantMessage = await chatPage.getRecentAssistantMessage();
    const reasoningContent =
      assistantMessage.element.getByTestId("message-reasoning-content");
    await expect(reasoningContent).toHaveAttribute("data-state", "open");

    const userMessage = await chatPage.getRecentUserMessage();

    await userMessage.edit("Why is grass green?");
    await chatPage.isGenerationComplete();

    await expect
      .poll(async () => {
        const latest = await chatPage.getRecentAssistantMessage();
        return latest.content;
      }, { timeout: 15_000 })
      .toBe("It's just green duh!");

    await expect
      .poll(async () => {
        const latest = await chatPage.getRecentAssistantMessage();
        return latest.reasoning;
      }, { timeout: 15_000 })
      .toBe("Grass is green because of chlorophyll absorption!");

    const updatedAssistantMessage = await chatPage.getRecentAssistantMessage();

    await expect(
      updatedAssistantMessage.element.getByTestId(
        "message-reasoning-content"
      )
    ).toHaveAttribute("data-state", "open");
  });
});
