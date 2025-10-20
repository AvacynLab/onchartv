import type { ChatMessage } from "@/lib/types";

/**
 * Describe a message that required a synthetic identifier so the UI state can
 * remain stable while the upstream SDK omits an `id` property.
 */
export type IdentifierPatch = {
  index: number;
  fallbackId: string;
  role: ChatMessage["role"] | undefined;
};

export type NormalisedIdentifiersResult = {
  messages: ChatMessage[];
  patches: IdentifierPatch[];
  /**
   * Flag indicating whether the helper had to materialise a brand-new array
   * because the upstream message objects were non-extensible. Callers can use
   * this signal to decide whether they should preserve the original array
   * reference (by cloning it themselves) or reuse the pre-cloned collection
   * returned here.
   */
  clonedArray: boolean;
};

/**
 * Resolve a stable identifier for the provided message. Whenever the upstream
 * payload already exposes a non-empty `id` we reuse it verbatim; otherwise we
 * synthesise a deterministic fallback based on the chat id, the message index
 * and the creation timestamp exposed through the metadata.
 */
export function resolveStableMessageId({
  chatId,
  index,
  message,
}: {
  chatId: string;
  index: number;
  message: ChatMessage | null | undefined;
}): { id: string; isSynthetic: boolean } {
  const hasStableId =
    typeof message?.id === "string" && message.id.trim().length > 0;

  if (hasStableId && message) {
    return { id: message.id, isSynthetic: false };
  }

  /**
   * Some streamed payloads omit the metadata block altogether until the server
   * persists the final message. Access it defensively so a missing
   * `createdAt` timestamp results in a deterministic placeholder instead of a
   * runtime TypeError that would collapse the entire chat surface.
   */
  const rawMetadata =
    message && typeof message === "object"
      ? (message as { metadata?: unknown }).metadata
      : undefined;

  let createdAt = "unknown";

  if (rawMetadata && typeof rawMetadata === "object") {
    const maybeCreatedAt = (rawMetadata as { createdAt?: unknown }).createdAt;

    if (typeof maybeCreatedAt === "string" && maybeCreatedAt.trim().length > 0) {
      createdAt = maybeCreatedAt;
    }
  }

  return {
    id: `${chatId}-synthetic-${index}-${createdAt}`,
    isSynthetic: true,
  };
}

/**
 * Ensure every message in the provided collection exposes a stable identifier.
 * The helper keeps the original array untouched when all entries already have
 * an `id`, but returns a cloned array – and patch diagnostics – whenever a
 * synthetic value had to be generated.
 */
export function normaliseMessageIdentifiers({
  chatId,
  messages,
}: {
  chatId: string;
  messages: ChatMessage[] | null | undefined;
}): NormalisedIdentifiersResult {
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      messages: Array.isArray(messages) ? messages : [],
      patches: [],
      clonedArray: false,
    };
  }

  let mutated = false;
  let clonedArray: ChatMessage[] | null = null;
  const patches: IdentifierPatch[] = [];

  const ensureClonedArray = (): ChatMessage[] => {
    if (clonedArray) {
      return clonedArray;
    }

    clonedArray = [...(messages as ChatMessage[])];
    return clonedArray;
  };

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const { id, isSynthetic } = resolveStableMessageId({
      chatId,
      index,
      message,
    });

    if (isSynthetic) {
      mutated = true;
      patches.push({ index, fallbackId: id, role: message?.role });

      if (message && typeof message === "object") {
        try {
          Object.assign(message as ChatMessage, { id });
          if (clonedArray) {
            ensureClonedArray()[index] = message as ChatMessage;
          }
          continue;
        } catch (error) {
          const snapshot = ensureClonedArray();
          snapshot[index] = { ...(message as ChatMessage), id };
          continue;
        }
      } else {
        ensureClonedArray();
      }
    }

    if (clonedArray) {
      ensureClonedArray()[index] = message as ChatMessage;
    }
  }

  if (!mutated) {
    return { messages: messages as ChatMessage[], patches, clonedArray: false };
  }

  if (!clonedArray) {
    return { messages: messages as ChatMessage[], patches, clonedArray: false };
  }

  return { messages: clonedArray, patches, clonedArray: true };
}

export type PreparedIdentifierNormalisation = {
  /**
   * The next message collection that should replace the existing chat state.
   * The array is always safe to reuse directly when a clone was required or
   * re-created when mutations happened in place so React observers receive a
   * fresh reference.
   */
  messages: ChatMessage[];
  /**
   * Collection of the identifier patches applied while normalising the
   * messages. Callers can surface these diagnostics once the state has been
   * updated so end-to-end tooling understands why synthetic identifiers were
   * introduced.
   */
  patches: IdentifierPatch[];
};

/**
 * Prepare a safe message collection ready to be committed back into the chat
 * state. The helper acts as a thin wrapper around `normaliseMessageIdentifiers`
 * but guarantees that callers always receive a fresh array reference when the
 * upstream payload was mutated in place. Returning `null` keeps the updater
 * short-circuiting friendly so state setters can bail out without triggering
 * redundant renders.
 */
export function prepareNormalisedMessageUpdate({
  chatId,
  messages,
}: {
  chatId: string;
  messages: ChatMessage[] | null | undefined;
}): PreparedIdentifierNormalisation | null {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }

  const { messages: normalisedMessages, patches, clonedArray } =
    normaliseMessageIdentifiers({
      chatId,
      messages,
    });

  if (patches.length === 0) {
    return null;
  }

  const nextMessages = clonedArray
    ? normalisedMessages
    : [...normalisedMessages];

  return { messages: nextMessages, patches };
}
