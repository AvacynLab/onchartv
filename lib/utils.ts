import type {
  CoreAssistantMessage,
  CoreToolMessage,
  UIMessage,
  UIMessagePart,
} from 'ai';
import { type ClassValue, clsx } from 'clsx';
import { formatISO } from 'date-fns';
import { twMerge } from 'tailwind-merge';
import { z } from 'zod';
import type { DBMessage, Document, MessageArtifact } from '@/lib/db/schema';
import { financeMessageArtifactSchema } from '@/lib/artifacts/types';
import { logError, logWarning } from './logging';
import { ChatSDKError, type ErrorCode } from './errors';
import type { ChatMessage, ChatTools, CustomUIDataTypes } from './types';

/**
 * Zod schema describing the standardised API error envelope returned by server
 * routes. Client helpers reuse the schema to avoid unchecked `{ any }` casts
 * and to surface useful diagnostics when responses are malformed.
 */
const apiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z
      .string({ required_error: "error.code is required" })
      .refine((value) => value.includes(':'), {
        message:
          "error.code must follow the `<type>:<surface>` convention used by ChatSDKError.",
      }),
    message: z.string().optional(),
    cause: z.unknown().optional(),
  }),
});

type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;

const FALLBACK_PARSE_ERROR_MESSAGE =
  'Unexpected error response received from the server. Please retry later.';
const FALLBACK_READ_ERROR_MESSAGE =
  'Unable to read the error response returned by the server.';

function toChatSdkErrorFromEnvelope(
  envelope: ApiErrorEnvelope['error']
): ChatSDKError {
  const error = new ChatSDKError(envelope.code as ErrorCode);

  if (typeof envelope.message === 'string' && envelope.message.trim().length > 0) {
    error.message = envelope.message;
  }

  if (typeof envelope.cause !== 'undefined') {
    (error as Error & { cause?: unknown }).cause = envelope.cause;
  }

  return error;
}

async function readErrorResponse(response: Response): Promise<ApiErrorEnvelope> {
  try {
    const payload = await response.json();
    const parsed = apiErrorEnvelopeSchema.safeParse(payload);

    if (parsed.success) {
      return parsed.data;
    }

    logError('fetcher', 'Failed to parse API error envelope', {
      issues: parsed.error.issues.map((issue) => issue.message),
      status: response.status,
    });

    const parseError = new ChatSDKError(
      'bad_request:api',
      FALLBACK_PARSE_ERROR_MESSAGE,
    );
    parseError.message = FALLBACK_PARSE_ERROR_MESSAGE;
    throw parseError;
  } catch (error) {
    if (error instanceof ChatSDKError) {
      throw error;
    }

    logError('fetcher', 'Failed to read API error response', {
      status: response.status,
      cause: error,
    });

    const readError = new ChatSDKError(
      'bad_request:api',
      FALLBACK_READ_ERROR_MESSAGE,
    );
    readError.message = FALLBACK_READ_ERROR_MESSAGE;
    throw readError;
  }
}

async function throwForErrorResponse(response: Response): Promise<never> {
  const envelope = await readErrorResponse(response);
  throw toChatSdkErrorFromEnvelope(envelope.error);
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fetcher = async (url: string) => {
  const response = await fetch(url);

  if (!response.ok) {
    await throwForErrorResponse(response);
  }

  return response.json();
};

export async function fetchWithErrorHandlers(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  try {
    const response = await fetch(input, init);

    if (!response.ok) {
      await throwForErrorResponse(response);
    }

    return response;
  } catch (error: unknown) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new ChatSDKError('offline:chat');
    }

    throw error;
  }
}

export function getLocalStorage(key: string) {
  if (typeof window !== 'undefined') {
    return JSON.parse(localStorage.getItem(key) || '[]');
  }
  return [];
}

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

type ResponseMessageWithoutId = CoreToolMessage | CoreAssistantMessage;
type ResponseMessage = ResponseMessageWithoutId & { id: string };

export function getMostRecentUserMessage(messages: UIMessage[]) {
  const userMessages = messages.filter((message) => message.role === 'user');
  return userMessages.at(-1);
}

export function getDocumentTimestampByIndex(
  documents: Document[],
  index: number,
) {
  if (!documents) { return new Date(); }
  if (index > documents.length) { return new Date(); }

  return documents[index].createdAt;
}

export function getTrailingMessageId({
  messages,
}: {
  messages: ResponseMessage[];
}): string | null {
  const trailingMessage = messages.at(-1);

  if (!trailingMessage) { return null; }

  return trailingMessage.id;
}

export function sanitizeText(text: string) {
  return text.replace('<has_function_call>', '');
}

/**
 * Translate persisted finance artefacts into the transient data parts consumed
 * by the chat UI. Persisting the raw payloads in `Message_v2.artifacts` keeps
 * the database storage agnostic while the UI receives rich JSON again when
 * rehydrating past conversations.
 */
const artifactToDataPart = (
  artifact: MessageArtifact
): UIMessagePart<CustomUIDataTypes, ChatTools> | null => {
  const parsed = financeMessageArtifactSchema.safeParse(artifact);

  if (!parsed.success) {
    const candidate = artifact as { type?: unknown };
    logWarning(
      'chat:convertToUIMessages',
      '[convertToUIMessages] skipped malformed finance artifact',
      {
        artifactType:
          typeof candidate?.type === 'string' ? candidate.type : 'unknown',
        issues: parsed.error.issues.map((issue) => issue.message),
      },
    );
    return null;
  }

  const artifactPayload = parsed.data;
  /**
   * The persisted wrapper mirrors the tool-emitted artefact type. Extracting it
   * first keeps the `switch` discriminant aligned with the UI renderer’s
   * expectations and restores the precise payload subtype inferred from the
   * union.
   */
  const financeArtifact = artifactPayload.payload;

  switch (financeArtifact.type) {
    case 'finance.chart':
      return {
        type: 'data-financeChart',
        /**
         * Finance chart artefacts carry OHLC candles, overlay metadata, and the
         * selected timeframe. Returning the payload verbatim keeps the
         * renderer strongly typed without falling back to unsafe casts.
         */
        data: financeArtifact,
      };
    case 'finance.chart.annotations':
      return {
        type: 'data-financeChartAnnotations',
        /** List of detected patterns/levels generated by the analysis tools. */
        data: financeArtifact,
      };
    case 'finance.fundamentals':
      return {
        type: 'data-financeFundamentals',
        data: financeArtifact,
      };
    case 'finance.news':
      return {
        type: 'data-financeNews',
        data: financeArtifact,
      };
    case 'finance.backtest':
      return {
        type: 'data-financeBacktest',
        data: financeArtifact,
      };
    case 'finance.screen':
      return {
        type: 'data-financeScreen',
        data: financeArtifact,
      };
    default: {
      const exhaustiveCheck: never = financeArtifact;
      return exhaustiveCheck;
    }
  }
};

export function convertToUIMessages(messages: DBMessage[]): ChatMessage[] {
  return messages.map((message) => {
    const baseParts = message.parts as UIMessagePart<CustomUIDataTypes, ChatTools>[];
    const artifactParts = (message.artifacts ?? [])
      .map(artifactToDataPart)
      .filter((part): part is UIMessagePart<CustomUIDataTypes, ChatTools> => part !== null);

    return {
      id: message.id,
      role: message.role as 'user' | 'assistant' | 'system',
      parts: [...baseParts, ...artifactParts],
      metadata: {
        createdAt: formatISO(message.createdAt),
      },
    };
  });
}

export function getTextFromMessage(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}
