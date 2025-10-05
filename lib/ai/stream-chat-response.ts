import { streamText } from "ai";

import type { ChatModel } from "@/lib/ai/models";
import { createHermeticMockProvider, myProvider } from "@/lib/ai/providers";
import { logWarning } from "@/lib/logging";

/**
 * Subset of the AI SDK `streamText` options excluding the model configuration,
 * which is supplied internally depending on the selected provider.
 */
type StreamTextBaseOptions = Parameters<typeof streamText>[0];

// The helper always works with structured chat messages, so forbid callers from
// passing the raw `prompt` shape and require `messages` instead. This mirrors
// what the route already supplies and keeps the AI SDK contract explicit.
export type StreamTextOptions = Omit<StreamTextBaseOptions, "model" | "prompt"> &
  Pick<Required<StreamTextBaseOptions>, "messages"> & { prompt?: undefined };

/**
 * Detects network-related failures that occur when the primary AI provider is
 * unreachable in hermetic (offline) environments such as Playwright runs.
 */
export function isHermeticNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.message.toLowerCase().includes("fetch failed")) {
    return true;
  }

  const cause = (error as { cause?: unknown }).cause;

  if (cause && typeof cause === "object") {
    const code = (cause as { code?: unknown }).code;

    if (typeof code === "string" && code.startsWith("ENET")) {
      return true;
    }
  }

  return false;
}

export async function streamChatResponse({
  selectedChatModel,
  streamOptions,
}: {
  readonly selectedChatModel: ChatModel["id"];
  readonly streamOptions: StreamTextOptions;
}) {
  /**
   * Helper that streams the chat response using the provided AI SDK instance so
   * we can reuse the same invocation when retrying with hermetic mocks.
   */
  const runStream = async (provider: typeof myProvider) =>
    streamText({
      ...streamOptions,
      model: provider.languageModel(selectedChatModel),
    });

  try {
    return await runStream(myProvider);
  } catch (error) {
    if (!isHermeticNetworkError(error)) {
      throw error;
    }

    logWarning(
      "chat.provider",
      "Primary provider failed, using hermetic fallback",
      { chatModel: selectedChatModel, error }
    );

    const fallbackProvider = createHermeticMockProvider("playwright");

    return runStream(fallbackProvider);
  }
}

export const __test = {
  isHermeticNetworkError,
};
