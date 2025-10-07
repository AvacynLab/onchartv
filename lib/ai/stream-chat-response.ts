import { streamText } from "ai";

import type { ChatModel } from "@/lib/ai/models";
import { createHermeticMockProvider, myProvider } from "@/lib/ai/providers";
import { isTestEnvironment } from "@/lib/constants";
import { logError, logWarning } from "@/lib/logging";

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
/**
 * Determine whether the provided error (or any nested cause) carries a network
 * code that indicates the primary AI provider was unreachable. Playwright
 * often surfaces these failures as `AggregateError`s that wrap several low
 * level socket exceptions, so the helper recursively inspects the error tree
 * instead of relying solely on the top-level message.
 */
const NETWORK_CODE_PREFIXES = [
  /** Covers ENETUNREACH/ENETDOWN when the OS blocks outbound sockets. */
  "ENET",
  /** Detect ECONNREFUSED/ECONNRESET emitted by Node's HTTP client. */
  "ECONN",
  /** getaddrinfo failures when DNS is unreachable in hermetic runs. */
  "EAI",
  /** Host lookup failures (EHOSTUNREACH/EHOSTDOWN) surfaced by libuv. */
  "EHOST",
  /** Low level socket/pipe issues that bubble up as transport errors. */
  "EPIPE",
  "EADDR",
  "ETIMEDOUT",
];

const NETWORK_MESSAGE_KEYWORDS = [
  "FETCH FAILED",
  "NETWORKERROR",
  "NETWORK ERROR",
  "ERR_NETWORK",
  "ERR_INTERNET_DISCONNECTED",
  "ERR_NETWORK_CHANGED",
  "ERR_CONNECTION_REFUSED",
  "ERR_CONNECTION_RESET",
  "ERR_ADDRESS_UNREACHABLE",
  "ECONN",
  "ENET",
  "EAI_",
  "EHOST",
  "ETIMEDOUT",
  "SOCKET HANG UP",
];

export function isHermeticNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const hasNetworkKeyword = (value: unknown): boolean => {
    if (typeof value !== "string" || value.length === 0) {
      return false;
    }

    const upper = value.toUpperCase();

    return NETWORK_MESSAGE_KEYWORDS.some((keyword) => upper.includes(keyword));
  };

  const containsNetworkSignal = (candidate: unknown, depth = 0): boolean => {
    if (!candidate || typeof candidate !== "object") {
      return false;
    }

    if (depth > 6) {
      // Avoid infinite loops when the cause chain contains cycles.
      return false;
    }

    const record = candidate as {
      code?: unknown;
      errno?: unknown;
      message?: unknown;
      stack?: unknown;
      cause?: unknown;
      errors?: unknown;
      reasons?: unknown;
    };

    const codes = [record.code, record.errno]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.toUpperCase());

    if (
      codes.some((code) =>
        NETWORK_CODE_PREFIXES.some((prefix) => code.startsWith(prefix))
      )
    ) {
      return true;
    }

    if (hasNetworkKeyword(record.message) || hasNetworkKeyword(record.stack)) {
      return true;
    }

    const nestedCause = record.cause;
    if (containsNetworkSignal(nestedCause, depth + 1)) {
      return true;
    }

    const nestedCollections: unknown[] = [];
    if (Array.isArray(record.errors)) {
      nestedCollections.push(...record.errors);
    }
    if (Array.isArray(record.reasons)) {
      nestedCollections.push(...record.reasons);
    }
    if (candidate instanceof AggregateError) {
      nestedCollections.push(...candidate.errors);
    }

    if (
      nestedCollections.length > 0 &&
      nestedCollections.some((inner) => containsNetworkSignal(inner, depth + 1))
    ) {
      return true;
    }

    return false;
  };

  return hasNetworkKeyword(error.message) || containsNetworkSignal(error);
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

  const preferHermeticProvider =
    isTestEnvironment() ||
    process.env.NEXT_PUBLIC_PLAYWRIGHT === "true" ||
    process.env.HERMETIC_CHAT_PROVIDER === "true";

  if (process.env.NODE_ENV !== "production") {
    logWarning("chat.provider", "Hermetic env snapshot", {
      preferHermeticProvider,
      PLAYWRIGHT: process.env.PLAYWRIGHT,
      NEXT_PUBLIC_PLAYWRIGHT: process.env.NEXT_PUBLIC_PLAYWRIGHT,
      PLAYWRIGHT_TEST_BASE_URL: process.env.PLAYWRIGHT_TEST_BASE_URL,
      CI_PLAYWRIGHT: process.env.CI_PLAYWRIGHT,
      HERMETIC_CHAT_PROVIDER: process.env.HERMETIC_CHAT_PROVIDER,
    });
  }

  if (preferHermeticProvider) {
    /**
     * Hermetic Playwright and Vitest environments run without outbound network
     * access. Short-circuit to the inline mock provider so the chat route never
     * attempts to reach the real vendor endpoints and the e2e suite stays
     * deterministic. The network-failure fallback below remains in place for
     * development and production environments where transient connectivity
     * issues may occur.
     */
    const hermeticProvider = createHermeticMockProvider("playwright");

    try {
      return await runStream(hermeticProvider);
    } catch (error) {
      logError("chat.provider", error, { hermeticProfile: "playwright" });
      throw error;
    }
  }

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
