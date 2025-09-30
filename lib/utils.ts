import type {
  CoreAssistantMessage,
  CoreToolMessage,
  UIMessage,
  UIMessagePart,
} from 'ai';
import { type ClassValue, clsx } from 'clsx';
import { formatISO } from 'date-fns';
import { twMerge } from 'tailwind-merge';
import type { DBMessage, Document, MessageArtifact } from '@/lib/db/schema';
import type {
  FinanceArtifact,
  FinanceBacktestArtifact,
  FinanceChartAnnotationsArtifact,
  FinanceChartArtifact,
  FinanceFundamentalsArtifact,
  FinanceNewsArtifact,
  FinanceScreenArtifact,
} from '@/lib/finance/types';
import { ChatSDKError, type ErrorCode } from './errors';
import type { ChatMessage, ChatTools, CustomUIDataTypes } from './types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fetcher = async (url: string) => {
  const response = await fetch(url);

  if (!response.ok) {
    const { code, cause } = await response.json();
    throw new ChatSDKError(code as ErrorCode, cause);
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
      const { code, cause } = await response.json();
      throw new ChatSDKError(code as ErrorCode, cause);
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
  const payload = artifact.payload as FinanceArtifact;

  switch (artifact.type) {
    case 'finance.chart':
      return {
        type: 'data-financeChart',
        data: payload as FinanceChartArtifact,
      };
    case 'finance.chart.annotations':
      return {
        type: 'data-financeChartAnnotations',
        data: payload as FinanceChartAnnotationsArtifact,
      };
    case 'finance.fundamentals':
      return {
        type: 'data-financeFundamentals',
        data: payload as FinanceFundamentalsArtifact,
      };
    case 'finance.news':
      return {
        type: 'data-financeNews',
        data: payload as FinanceNewsArtifact,
      };
    case 'finance.backtest':
      return {
        type: 'data-financeBacktest',
        data: payload as FinanceBacktestArtifact,
      };
    case 'finance.screen':
      return {
        type: 'data-financeScreen',
        data: payload as FinanceScreenArtifact,
      };
    default:
      return null;
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
