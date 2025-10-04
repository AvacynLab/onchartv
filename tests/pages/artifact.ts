import { expect, type Page } from "@playwright/test";

export class ArtifactPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get artifact() {
    return this.page.getByTestId("artifact");
  }

  get sendButton() {
    return this.artifact.getByTestId("send-button");
  }

  get stopButton() {
    return this.page.getByTestId("stop-button");
  }

  get multimodalInput() {
    return this.page.getByTestId("multimodal-input");
  }

  async isGenerationComplete() {
    const response = await this.page.waitForResponse((currentResponse) =>
      currentResponse.url().includes("/api/chat")
    );

    await response.finished();
  }

  async sendUserMessage(message: string) {
    await this.artifact.getByTestId("multimodal-input").click();
    await this.artifact.getByTestId("multimodal-input").fill(message);
    await this.artifact.getByTestId("send-button").click();
  }

  async getRecentAssistantMessage() {
    const messageElements = await this.artifact
      .getByTestId("message-assistant")
      .all();
    const lastMessageElement = messageElements.at(-1);

    if (!lastMessageElement) {
      return null;
    }

    const content = await lastMessageElement
      .getByTestId("message-content")
      .innerText()
      .catch(() => null);

    const reasoningTrigger = lastMessageElement.getByTestId(
      "message-reasoning-trigger"
    );
    const reasoningContent = lastMessageElement.getByTestId(
      "message-reasoning-content"
    );

    const reasoningElement = await reasoningContent
      .waitFor({ state: "attached", timeout: 5_000 })
      .then(async () => {
        const isVisible = await reasoningContent
          .isVisible()
          .catch(() => false);

        if (!isVisible) {
          await reasoningTrigger.click();
          await reasoningContent.waitFor({ state: "visible", timeout: 5_000 });
        }

        return reasoningContent
          .innerText()
          .then((value) => value?.trim() ?? "")
          .catch(() => null);
      })
      .catch(() => null);

    return {
      element: lastMessageElement,
      content,
      reasoning: reasoningElement,
      async toggleReasoningVisibility() {
        await reasoningTrigger.click();
      },
    };
  }

  async getRecentUserMessage() {
    const messageElements = await this.artifact
      .getByTestId("message-user")
      .all();
    const lastMessageElement = messageElements.at(-1);

    if (!lastMessageElement) {
      return null;
    }

    const content = await lastMessageElement.innerText();

    const hasAttachments = await lastMessageElement
      .getByTestId("message-attachments")
      .isVisible()
      .catch(() => false);

    const attachments = hasAttachments
      ? await lastMessageElement.getByTestId("message-attachments").all()
      : [];

    const page = this.artifact;

    return {
      element: lastMessageElement,
      content,
      attachments,
      async edit(newMessage: string) {
        await page.getByTestId("message-edit-button").click();
        await page.getByTestId("message-editor").fill(newMessage);
        await page.getByTestId("message-editor-send-button").click();
        await expect(
          page.getByTestId("message-editor-send-button")
        ).not.toBeVisible();
      },
    };
  }

  closeArtifact() {
    return this.page.getByTestId("artifact-close-button").click();
  }
}
