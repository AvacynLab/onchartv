import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  type SQL,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { ArtifactKind } from "@/components/artifact";
import type { VisibilityType } from "@/components/visibility-selector";
import { isTestEnvironment } from "../constants";
import { ChatSDKError } from "../errors";
import type { AppUsage } from "../usage";
import { generateUUID } from "../utils";
import {
  type Chat,
  chat,
  type DBMessage,
  document,
  message,
  type Suggestion,
  stream,
  suggestion,
  type User,
  user,
  vote,
} from "./schema";
import { generateHashedPassword } from "./utils";

// Optionally, if not using email/pass login, you can
// use the Drizzle adapter for Auth.js / NextAuth
// https://authjs.dev/reference/adapter/drizzle

type InMemoryStore = {
  users: Map<string, User>;
  chats: Map<string, Chat>;
  messages: Map<string, DBMessage>;
  votes: Map<string, { chatId: string; messageId: string; isUpvoted: boolean }>;
  documents: Map<
    string,
    Array<{
      id: string;
      title: string;
      kind: ArtifactKind;
      content: string;
      userId: string;
      createdAt: Date;
    }>
  >;
  suggestions: Map<string, Suggestion[]>;
  streams: Map<string, Array<{ id: string; chatId: string; createdAt: Date }>>;
};

declare global {
  // eslint-disable-next-line no-var -- Explicitly extend the Node.js global scope.
  var __ONCHARTV_IN_MEMORY_STORE__: InMemoryStore | undefined;
}

function getOrCreateInMemoryStore(): InMemoryStore {
  if (!globalThis.__ONCHARTV_IN_MEMORY_STORE__) {
    /**
     * Persist the Playwright-specific data structures on the Node.js global
     * object. Next.js spawns isolated module graphs for server actions and
     * route handlers in development, so relying on module-level state causes
     * the in-memory database to reset between the registration action and the
     * credentials provider. Storing the maps globally ensures the auth flow
     * sees a consistent view of the fake database while keeping production
     * paths untouched.
     */
    globalThis.__ONCHARTV_IN_MEMORY_STORE__ = {
      users: new Map(),
      chats: new Map(),
      messages: new Map(),
      votes: new Map(),
      documents: new Map(),
      suggestions: new Map(),
      streams: new Map(),
    } as InMemoryStore;
  }

  return globalThis.__ONCHARTV_IN_MEMORY_STORE__;
}

const inMemoryStore: InMemoryStore | null = isTestEnvironment
  ? getOrCreateInMemoryStore()
  : null;

/**
 * Helper ensuring we only touch the in-memory store in the Playwright setup.
 * This avoids coupling the production Postgres code-path with the simulated
 * data required by the deterministic tests.
 */
function getInMemoryStore(): InMemoryStore {
  if (!inMemoryStore) {
    throw new Error(
      "Attempted to access the in-memory database outside the test environment"
    );
  }

  return inMemoryStore;
}

const makeVoteKey = (chatId: string, messageId: string) => `${chatId}:${messageId}`;

// biome-ignore lint: Forbidden non-null assertion.
const client = isTestEnvironment ? null : postgres(process.env.POSTGRES_URL!);
const db = client
  ? drizzle(client)
  : ({} as ReturnType<typeof drizzle>);

export async function getUser(email: string): Promise<User[]> {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const users = Array.from(store.users.values()).filter(
      (currentUser) => currentUser.email === email
    );

    return users;
  }

  try {
    return await db.select().from(user).where(eq(user.email, email));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get user by email"
    );
  }
}

export async function createUser(email: string, password: string) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const hashedPassword = generateHashedPassword(password);
    const id = generateUUID();

    store.users.set(id, { id, email, password: hashedPassword });

    return;
  }

  const hashedPassword = generateHashedPassword(password);

  try {
    return await db.insert(user).values({ email, password: hashedPassword });
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to create user");
  }
}

export async function createGuestUser() {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const id = generateUUID();
    const email = `guest-${Date.now()}`;
    const password = generateHashedPassword(generateUUID());

    store.users.set(id, { id, email, password });

    return [{ id, email }];
  }

  const email = `guest-${Date.now()}`;
  const password = generateHashedPassword(generateUUID());

  try {
    return await db.insert(user).values({ email, password }).returning({
      id: user.id,
      email: user.email,
    });
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to create guest user"
    );
  }
}

export async function saveChat({
  id,
  userId,
  title,
  visibility,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: VisibilityType;
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const chatRecord: Chat = {
      id,
      createdAt: new Date(),
      userId,
      title,
      visibility,
      lastContext: null,
    };

    store.chats.set(id, chatRecord);

    return;
  }

  try {
    return await db.insert(chat).values({
      id,
      createdAt: new Date(),
      userId,
      title,
      visibility,
    });
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to save chat");
  }
}

export async function deleteChatById({ id }: { id: string }) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const chatToDelete = store.chats.get(id) ?? null;

    for (const [messageId, messageRecord] of Array.from(store.messages)) {
      if (messageRecord.chatId === id) {
        store.messages.delete(messageId);
      }
    }

    for (const [voteKey, voteRecord] of Array.from(store.votes)) {
      if (voteRecord.chatId === id) {
        store.votes.delete(voteKey);
      }
    }

    store.streams.delete(id);
    store.chats.delete(id);

    return chatToDelete;
  }

  try {
    await db.delete(vote).where(eq(vote.chatId, id));
    await db.delete(message).where(eq(message.chatId, id));
    await db.delete(stream).where(eq(stream.chatId, id));

    const [chatsDeleted] = await db
      .delete(chat)
      .where(eq(chat.id, id))
      .returning();
    return chatsDeleted;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to delete chat by id"
    );
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const allChats = Array.from(store.chats.values()).filter(
      (currentChat) => currentChat.userId === id
    );

    const sortedChats = allChats.sort(
      (first, second) => second.createdAt.getTime() - first.createdAt.getTime()
    );

    let filteredChats = sortedChats;

    if (startingAfter) {
      const pivotChat = store.chats.get(startingAfter);

      if (!pivotChat) {
        throw new ChatSDKError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`
        );
      }

      filteredChats = sortedChats.filter(
        (currentChat) => currentChat.createdAt > pivotChat.createdAt
      );
    } else if (endingBefore) {
      const pivotChat = store.chats.get(endingBefore);

      if (!pivotChat) {
        throw new ChatSDKError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`
        );
      }

      filteredChats = sortedChats.filter(
        (currentChat) => currentChat.createdAt < pivotChat.createdAt
      );
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  }

  try {
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<any>) =>
      db
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(whereCondition, eq(chat.userId, id))
            : eq(chat.userId, id)
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);

    let filteredChats: Chat[] = [];

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new ChatSDKError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`
        );
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new ChatSDKError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`
        );
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get chats by user id"
    );
  }
}

export async function getChatById({ id }: { id: string }) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    return store.chats.get(id) ?? null;
  }

  try {
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id));
    if (!selectedChat) {
      return null;
    }

    return selectedChat;
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to get chat by id");
  }
}

export async function saveMessages({ messages }: { messages: DBMessage[] }) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();

    for (const messageRecord of messages) {
      store.messages.set(messageRecord.id, {
        ...messageRecord,
        createdAt: new Date(messageRecord.createdAt),
      });
    }

    return;
  }

  try {
    return await db.insert(message).values(messages);
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to save messages");
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    return Array.from(store.messages.values())
      .filter((messageRecord) => messageRecord.chatId === id)
      .sort(
        (first, second) =>
          new Date(first.createdAt).getTime() -
          new Date(second.createdAt).getTime()
      );
  }

  try {
    return await db
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get messages by chat id"
    );
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: "up" | "down";
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const voteKey = makeVoteKey(chatId, messageId);
    store.votes.set(voteKey, {
      chatId,
      messageId,
      isUpvoted: type === "up",
    });

    return;
  }

  try {
    const [existingVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.messageId, messageId)));

    if (existingVote) {
      return await db
        .update(vote)
        .set({ isUpvoted: type === "up" })
        .where(and(eq(vote.messageId, messageId), eq(vote.chatId, chatId)));
    }
    return await db.insert(vote).values({
      chatId,
      messageId,
      isUpvoted: type === "up",
    });
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to vote message");
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    return Array.from(store.votes.values()).filter(
      (voteRecord) => voteRecord.chatId === id
    );
  }

  try {
    return await db.select().from(vote).where(eq(vote.chatId, id));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get votes by chat id"
    );
  }
}

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const documentRecord = {
      id,
      title,
      kind,
      content,
      userId,
      createdAt: new Date(),
    };

    const documents = store.documents.get(id) ?? [];
    documents.push(documentRecord);
    documents.sort(
      (first, second) => first.createdAt.getTime() - second.createdAt.getTime()
    );
    store.documents.set(id, documents);

    return [documentRecord];
  }

  try {
    return await db
      .insert(document)
      .values({
        id,
        title,
        kind,
        content,
        userId,
        createdAt: new Date(),
      })
      .returning();
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to save document");
  }
}

export async function getDocumentsById({ id }: { id: string }) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const documents = store.documents.get(id) ?? [];
    return [...documents].sort(
      (first, second) => first.createdAt.getTime() - second.createdAt.getTime()
    );
  }

  try {
    const documents = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(asc(document.createdAt));

    return documents;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get documents by id"
    );
  }
}

export async function getDocumentById({ id }: { id: string }) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const documents = store.documents.get(id) ?? [];
    return documents.at(-1);
  }

  try {
    const [selectedDocument] = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt));

    return selectedDocument;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get document by id"
    );
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const documents = store.documents.get(id) ?? [];
    const remainingDocuments = documents.filter(
      (currentDocument) => currentDocument.createdAt <= timestamp
    );
    const deletedDocuments = documents.filter(
      (currentDocument) => currentDocument.createdAt > timestamp
    );

    store.documents.set(id, remainingDocuments);

    const existingSuggestions = store.suggestions.get(id) ?? [];
    const keptSuggestions = existingSuggestions.filter(
      (suggestionRecord) => suggestionRecord.documentCreatedAt <= timestamp
    );
    store.suggestions.set(id, keptSuggestions);

    return deletedDocuments;
  }

  try {
    await db
      .delete(suggestion)
      .where(
        and(
          eq(suggestion.documentId, id),
          gt(suggestion.documentCreatedAt, timestamp)
        )
      );

    return await db
      .delete(document)
      .where(and(eq(document.id, id), gt(document.createdAt, timestamp)))
      .returning();
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to delete documents by id after timestamp"
    );
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Suggestion[];
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    for (const suggestionRecord of suggestions) {
      const records = store.suggestions.get(suggestionRecord.documentId) ?? [];
      records.push(suggestionRecord);
      store.suggestions.set(suggestionRecord.documentId, records);
    }

    return;
  }

  try {
    return await db.insert(suggestion).values(suggestions);
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to save suggestions"
    );
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    return [...(store.suggestions.get(documentId) ?? [])];
  }

  try {
    return await db
      .select()
      .from(suggestion)
      .where(and(eq(suggestion.documentId, documentId)));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get suggestions by document id"
    );
  }
}

export async function getMessageById({ id }: { id: string }) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const messageRecord = store.messages.get(id);
    return messageRecord ? [messageRecord] : [];
  }

  try {
    return await db.select().from(message).where(eq(message.id, id));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get message by id"
    );
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const messagesToDelete = Array.from(store.messages.values()).filter(
      (messageRecord) =>
        messageRecord.chatId === chatId &&
        new Date(messageRecord.createdAt) >= timestamp
    );

    for (const messageRecord of messagesToDelete) {
      store.messages.delete(messageRecord.id);
      store.votes.delete(makeVoteKey(chatId, messageRecord.id));
    }

    return;
  }

  try {
    const messagesToDelete = await db
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp))
      );

    const messageIds = messagesToDelete.map(
      (currentMessage) => currentMessage.id
    );

    if (messageIds.length > 0) {
      await db
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds))
        );

      return await db
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds))
        );
    }
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to delete messages by chat id after timestamp"
    );
  }
}

export async function updateChatVisiblityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: "private" | "public";
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const chatRecord = store.chats.get(chatId);
    if (chatRecord) {
      store.chats.set(chatId, { ...chatRecord, visibility });
    }

    return;
  }

  try {
    return await db.update(chat).set({ visibility }).where(eq(chat.id, chatId));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to update chat visibility by id"
    );
  }
}

export async function updateChatLastContextById({
  chatId,
  context,
}: {
  chatId: string;
  // Store merged server-enriched usage object
  context: AppUsage;
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const chatRecord = store.chats.get(chatId);
    if (chatRecord) {
      store.chats.set(chatId, { ...chatRecord, lastContext: context });
    }

    return;
  }

  try {
    return await db
      .update(chat)
      .set({ lastContext: context })
      .where(eq(chat.id, chatId));
  } catch (error) {
    console.warn("Failed to update lastContext for chat", chatId, error);
    return;
  }
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: {
  id: string;
  differenceInHours: number;
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const threshold = Date.now() - differenceInHours * 60 * 60 * 1000;

    let total = 0;

    for (const messageRecord of store.messages.values()) {
      if (messageRecord.role !== "user") {
        continue;
      }

      if (new Date(messageRecord.createdAt).getTime() < threshold) {
        continue;
      }

      const chatRecord = store.chats.get(messageRecord.chatId);
      if (chatRecord?.userId === id) {
        total += 1;
      }
    }

    return total;
  }

  try {
    const twentyFourHoursAgo = new Date(
      Date.now() - differenceInHours * 60 * 60 * 1000
    );

    const [stats] = await db
      .select({ count: count(message.id) })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(
        and(
          eq(chat.userId, id),
          gte(message.createdAt, twentyFourHoursAgo),
          eq(message.role, "user")
        )
      )
      .execute();

    return stats?.count ?? 0;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get message count by user id"
    );
  }
}

export async function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const streams = store.streams.get(chatId) ?? [];
    streams.push({ id: streamId, chatId, createdAt: new Date() });
    streams.sort(
      (first, second) => first.createdAt.getTime() - second.createdAt.getTime()
    );
    store.streams.set(chatId, streams);

    return;
  }

  try {
    await db
      .insert(stream)
      .values({ id: streamId, chatId, createdAt: new Date() });
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to create stream id"
    );
  }
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  if (isTestEnvironment) {
    const store = getInMemoryStore();
    const streams = store.streams.get(chatId) ?? [];
    return streams.map(({ id }) => id);
  }

  try {
    const streamIds = await db
      .select({ id: stream.id })
      .from(stream)
      .where(eq(stream.chatId, chatId))
      .orderBy(asc(stream.createdAt))
      .execute();

    return streamIds.map(({ id }) => id);
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get stream ids by chat id"
    );
  }
}
