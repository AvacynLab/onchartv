import {
  createUIMessageStream,
  JsonToSseTransformStream,
  smoothStream,
  stepCountIs,
} from "ai";
import { unstable_cache as cache } from "next/cache";
import { after } from "next/server";
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from "resumable-stream";
import type { ModelCatalog } from "tokenlens/core";
import { fetchModels } from "tokenlens/fetch";
import { getUsage } from "tokenlens/helpers";
import { auth, type UserType } from "@/app/(auth)/auth";
import type { VisibilityType } from "@/components/visibility-selector";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import { shouldFetchTokenlensCatalog } from "@/lib/ai/tokenlens";
import { resolveRequestGeolocation } from "@/lib/ai/geolocation";
import type { ChatModel } from "@/lib/ai/models";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { myProvider } from "@/lib/ai/providers";
import { createDocument } from "@/lib/ai/tools/create-document";
import { createFinanceTools } from "@/lib/ai/tools/finance";
import { getWeather } from "@/lib/ai/tools/get-weather";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { updateDocument } from "@/lib/ai/tools/update-document";
import { convertToModelMessages } from "@/lib/ai/messages/convert-to-model-messages";
import {
  streamChatResponse,
  type StreamTextOptions,
  __test as streamChatResponseTestUtils,
} from "@/lib/ai/stream-chat-response";
import { isProductionEnvironment, isTestEnvironment } from "@/lib/constants";
import {
  createStreamId,
  getFinancePreferencesByUserId,
  deleteChatById,
  getChatById,
  getMessageById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatLastContextById,
} from "@/lib/db/queries";
import type { MessageArtifact } from "@/lib/db/schema";
import type { FinanceArtifact } from "@/lib/finance/types";
import {
  DEFAULT_FINANCE_PREFERENCES,
  type FinancePreferences,
} from "@/lib/finance/preferences";
import { ChatSDKError } from "@/lib/errors";
import { logError, logWarning } from "@/lib/logging";
import type { Attachment, ChatMessage } from "@/lib/types";
import type { AppUsage } from "@/lib/usage";
import type { UIDataTypes, UIMessagePart, UITools } from "ai";
import {
  buildMessageTextSignature,
  type MessagePartCandidate,
} from "@/lib/ai/messages/signature";
import { normaliseAssistantMessage } from "@/lib/chat/stream-fallback";

import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

declare global {
  // eslint-disable-next-line no-var -- share the in-memory stream context across module graphs.
  var __ONCHARTV_RESUMABLE_STREAM_CONTEXT__:
    | ResumableStreamContext
    | undefined;
}

type ProcessWithStreamContext = NodeJS.Process & {
  __ONCHARTV_RESUMABLE_STREAM_CONTEXT__?: ResumableStreamContext;
};

const processWithStreamContext = process as ProcessWithStreamContext;

const cacheStreamContext = (context: ResumableStreamContext) => {
  globalThis.__ONCHARTV_RESUMABLE_STREAM_CONTEXT__ = context;
  processWithStreamContext.__ONCHARTV_RESUMABLE_STREAM_CONTEXT__ = context;
  return context;
};

const resolveGlobalStreamContext = () => {
  /**
   * Next.js spawns separate module graphs for route handlers and server
   * actions while developing with Turbopack. Persist the stream context on the
   * Node.js global object so resume requests share the same in-flight stream
   * registry as the originating POST handler.
   */
  const processCached = processWithStreamContext.__ONCHARTV_RESUMABLE_STREAM_CONTEXT__;
  if (processCached) {
    return cacheStreamContext(processCached);
  }

  const globalCached = globalThis.__ONCHARTV_RESUMABLE_STREAM_CONTEXT__;
  if (globalCached) {
    return cacheStreamContext(globalCached);
  }

  return null;
};

const textDecoder = new TextDecoder();

/**
 * Shared helper returning the canonical forbidden payload mandated by the
 * regular-only chat mode. Keeping the Response factory centralised ensures the
 * POST and DELETE handlers stay in sync with the contract asserted by the
 * Playwright storage-state initialiser.
 */
const regularSessionRequiredResponse = () =>
  Response.json(
    {
      error: {
        code: "forbidden:chat",
        message: "Regular session required",
      },
    },
    { status: 403 }
  );

class InMemoryResumableStream {
  private readonly reader: ReadableStreamDefaultReader<unknown>;
  private readonly buffer: string[] = [];
  private readonly watchers = new Set<ReadableStreamDefaultController<string>>();
  private pumpStarted = false;
  private finalised = false;
  private done = false;
  private error: unknown;

  constructor(
    stream: ReadableStream<string>,
    private readonly onFinalize: () => void
  ) {
    this.reader = stream.getReader();
  }

  createInitialStream(): ReadableStream<string> {
    return this.createStream({ replay: false });
  }

  createResumeStream(): ReadableStream<string> | null {
    if (this.error) {
      return null;
    }

    if (this.done && this.buffer.length === 0) {
      return null;
    }

    return this.createStream({ replay: true });
  }

  isDone(): boolean {
    return this.done || Boolean(this.error);
  }

  private createStream({ replay }: { replay: boolean }) {
    let controllerRef: ReadableStreamDefaultController<string> | null = null;

    const stream = new ReadableStream<string>({
      start: (controller) => {
        controllerRef = controller;

        if (replay) {
          for (const chunk of this.buffer) {
            controller.enqueue(chunk);
          }
        }

        if (this.error) {
          controller.error(this.error);
          controllerRef = null;
          return;
        }

        if (this.done && !replay) {
          controller.close();
          controllerRef = null;
          return;
        }

        if (!this.done) {
          this.watchers.add(controller);
          this.ensurePump();
        } else {
          controller.close();
          controllerRef = null;
        }
      },
      cancel: () => {
        if (controllerRef) {
          this.watchers.delete(controllerRef);
          controllerRef = null;
        }

        this.cleanupIfIdle();
      },
    });

    return stream;
  }

  private ensurePump() {
    if (this.pumpStarted) {
      return;
    }

    this.pumpStarted = true;
    void this.pump();
  }

  private cleanupIfIdle() {
    if ((this.done || this.error) && !this.finalised && this.watchers.size === 0) {
      this.finalised = true;
      this.onFinalize();
    }
  }

  private async pump() {
    try {
      while (true) {
        const { done, value } = await this.reader.read();

        if (done) {
          this.done = true;
          break;
        }

        const chunk = this.toChunkString(value);
        this.buffer.push(chunk);

        for (const controller of this.watchers) {
          try {
            controller.enqueue(chunk);
          } catch {
            // Ignore enqueue errors triggered by closed controllers.
          }
        }
      }
    } catch (error) {
      this.error = error;

      for (const controller of this.watchers) {
        try {
          controller.error(error);
        } catch {
          // Ignore controllers already closed by the client.
        }
      }
    } finally {
      for (const controller of this.watchers) {
        try {
          controller.close();
        } catch {
          // Ignore controllers already closed by the client.
        }
      }

      this.watchers.clear();
      this.cleanupIfIdle();

      try {
        this.reader.releaseLock();
      } catch {
        // Ignore failures when the lock has already been released.
      }
    }
  }

  private toChunkString(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }

    if (value instanceof Uint8Array) {
      return textDecoder.decode(value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.toChunkString(item)).join("");
    }

    if (value == null) {
      return "";
    }

    return String(value);
  }
}

const createInMemoryResumableStreamContext = (): ResumableStreamContext => {
  const activeStreams = new Map<string, InMemoryResumableStream>();
  const completedStreams = new Set<string>();

  const registerStream = (
    streamId: string,
    source: ReadableStream<string>
  ): InMemoryResumableStream => {
    const stream = new InMemoryResumableStream(source, () => {
      activeStreams.delete(streamId);
      completedStreams.add(streamId);
    });

    activeStreams.set(streamId, stream);

    return stream;
  };

  return {
    async resumableStream(streamId, makeStream) {
      const existing = activeStreams.get(streamId);

      if (existing) {
        const resumed = existing.createResumeStream();

        if (!resumed) {
          activeStreams.delete(streamId);
          completedStreams.add(streamId);
        }

        return resumed;
      }

      if (completedStreams.has(streamId)) {
        return null;
      }

      const stream = registerStream(streamId, makeStream());
      return stream.createInitialStream();
    },
    async createNewResumableStream(streamId, makeStream) {
      completedStreams.delete(streamId);
      const stream = registerStream(streamId, makeStream());
      return stream.createInitialStream();
    },
    async resumeExistingStream(streamId) {
      const existing = activeStreams.get(streamId);

      if (!existing) {
        if (completedStreams.has(streamId)) {
          return null;
        }

        return undefined;
      }

      const resumed = existing.createResumeStream();

      if (!resumed) {
        activeStreams.delete(streamId);
        completedStreams.add(streamId);
      }

      return resumed;
    },
    async hasExistingStream(streamId) {
      const existing = activeStreams.get(streamId);

      if (existing) {
        return existing.isDone() ? "DONE" : true;
      }

      if (completedStreams.has(streamId)) {
        return "DONE";
      }

      return null;
    },
  } satisfies ResumableStreamContext;
};

// Playwright runs without network access. Skipping the TokenLens catalog
// download avoids repeated `ENETUNREACH` warnings during the e2e suite while
// leaving production behaviour untouched.
const tokenlensFetchEnabled = shouldFetchTokenlensCatalog(process.env);

const getTokenlensCatalog = tokenlensFetchEnabled
  ? cache(
      async (): Promise<ModelCatalog | undefined> => {
        try {
          return await fetchModels();
        } catch (err: unknown) {
          logWarning(
            "tokenlens.catalog",
            "Catalog fetch failed; using bundled fallback",
            { error: err }
          );
          return; // tokenlens helpers will fall back to defaultCatalog
        }
      },
      ["tokenlens-catalog"],
      { revalidate: 24 * 60 * 60 } // 24 hours
    )
  : async (): Promise<ModelCatalog | undefined> => undefined;

/**
 * AI SDK streams emit `UIMessagePart` objects while persisted history uses the
 * narrower `ChatMessage` structure. The extractor handles both so it can
 * serialise attachments during streaming as well as on final persistence.
 */
type AttachmentCandidate = Exclude<MessagePartCandidate, string>;
type FilePart = Extract<AttachmentCandidate, { type: "file" }>;

const extractAttachments = (parts: ReadonlyArray<AttachmentCandidate>) => {
  return parts
    .filter(
      (part): part is FilePart =>
        typeof part === "object" && part !== null && part.type === "file"
    )
    .map((filePart) => {
      /**
       * `streamText` reuses the same shape for both end-user uploads and tool
       * responses. Attachments coming from the UI provide a `name` attribute
       * while tool-generated ones emit `filename`. Preserve whichever label is
       * available so saved history reflects what the user saw on screen.
       */
      const attachmentName =
        ("name" in filePart && typeof filePart.name === "string"
          ? filePart.name
          : undefined) ??
        ("filename" in filePart && typeof filePart.filename === "string"
          ? filePart.filename
          : undefined) ??
        "file";

      return {
        name: attachmentName,
        url: filePart.url,
        contentType: filePart.mediaType ?? "application/octet-stream",
      };
    });
};


export function getStreamContext() {
  const cached = resolveGlobalStreamContext();

  if (cached) {
    return cached;
  }

  if (isTestEnvironment()) {
    const inMemoryContext = createInMemoryResumableStreamContext();
    return cacheStreamContext(inMemoryContext);
  }

  let resolvedContext: ResumableStreamContext;

  try {
    resolvedContext = createResumableStreamContext({
      waitUntil: after,
    });
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof (error as { message?: unknown }).message === "string" &&
      (error as { message: string }).message.includes("REDIS_URL")
    ) {
      logWarning(
        "chat.streams",
        "Resumable streams falling back to in-memory transport because REDIS_URL is unset"
      );
    } else {
      logError("chat.streams", error);
    }

    resolvedContext = createInMemoryResumableStreamContext();
  }

  return cacheStreamContext(resolvedContext);
}

export async function POST(request: Request) {
  let requestBody: PostRequestBody;
  // Preserve the chat identifier for error logging so the catch block can
  // report context even if parsing or auth validation throw before the local
  // `id` variable is in scope.
  let chatIdForLogs: string | undefined;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatSDKError("bad_request:api").toResponse();
  }

  try {
    const {
      id,
      message: incomingMessage,
      selectedChatModel,
      selectedVisibilityType,
    } = requestBody;

    chatIdForLogs = id;

    const session = await auth();

    /**
     * Enforce the regular-session gate mandated by the product brief. Returning
     * a deterministic JSON payload keeps the API aligned with the E2E storage
     * state initialiser which now provisions a fully registered account.
     */
    if (!session || session.user?.type !== "regular") {
      return regularSessionRequiredResponse();
    }

    const sessionUser = session.user as typeof session.user & {
      id: string | undefined;
      type: "regular";
    };

    if (typeof sessionUser.id !== "string" || sessionUser.id.length === 0) {
      return regularSessionRequiredResponse();
    }
    const ensuredSession = session;

    const userType: UserType = sessionUser.type;

    const messageCount = await getMessageCountByUserId({
      id: sessionUser.id,
      differenceInHours: 24,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
      return new ChatSDKError("rate_limit:chat").toResponse();
    }

    const chat = await getChatById({ id });

    if (chat) {
      if (chat.userId !== sessionUser.id) {
        return new ChatSDKError("forbidden:chat").toResponse();
      }
    } else {
      const title = await generateTitleFromUserMessage({
        message: incomingMessage,
      });

      await saveChat({
        id,
        userId: sessionUser.id,
        title,
        visibility: selectedVisibilityType,
      });
    }

    const preferenceRecord = await getFinancePreferencesByUserId({
      userId: sessionUser.id,
    });

    const financePreferences: FinancePreferences = preferenceRecord
      ? {
          markets: [...preferenceRecord.markets],
          defaultIndicators: preferenceRecord.indicators.map((indicator) => ({
            ...indicator,
          })),
          explanationLevel: preferenceRecord.explanationLevel,
          showNews: preferenceRecord.showNews,
        }
      : DEFAULT_FINANCE_PREFERENCES;

    const messagesFromDb = await getMessagesByChatId({ id });
    const [persistedMessage] = await getMessageById({ id: incomingMessage.id });

    const incomingParts = Array.isArray(incomingMessage.parts)
      ? (incomingMessage.parts as ChatMessage["parts"])
      : [];
    const persistedParts = Array.isArray(persistedMessage?.parts)
      ? (persistedMessage!.parts as ChatMessage["parts"])
      : null;

    const incomingSignature = buildMessageTextSignature(incomingParts);
    const persistedSignature = buildMessageTextSignature(persistedParts);

    const clientSignature = (() => {
      const metadata = incomingMessage.metadata;

      if (!metadata || typeof metadata !== "object") {
        return null;
      }

      const signature = (metadata as { clientTextSignature?: unknown })
        .clientTextSignature;

      return typeof signature === "string" ? signature.trim() : null;
    })();

    let resolvedParts: ChatMessage["parts"];

    if (!persistedParts || persistedParts.length === 0 || persistedSignature.length === 0) {
      resolvedParts = incomingParts;
    } else if (clientSignature) {
      if (clientSignature === persistedSignature) {
        resolvedParts = persistedParts;
      } else if (clientSignature === incomingSignature) {
        resolvedParts = incomingParts;
      } else {
        logWarning(
          "chat:message",
          "Client and persisted text signatures diverge; defaulting to persisted parts",
          {
            clientSignature,
            persistedSignature,
            incomingSignature,
          }
        );
        resolvedParts = persistedParts;
      }
    } else if (incomingSignature.length > 0 && persistedSignature.length === 0) {
      resolvedParts = incomingParts;
    } else {
      resolvedParts = persistedParts;
    }

    const resolvedAttachments: Attachment[] = Array.isArray(
      persistedMessage?.attachments
    )
      ? (persistedMessage!.attachments as Attachment[])
      : extractAttachments(resolvedParts);

    // Attachments are persisted alongside the chat record but the UI message
    // contract mirrors `UIMessage` which does not expose an attachments field.
    // Returning the pared-down shape keeps the in-flight stream compatible
    // while the saved database row still retains the uploaded assets.
    const resolvedMessageMetadata: ChatMessage["metadata"] = (() => {
      /**
       * Prefer the persisted timestamp so edited prompts retain their original
       * creation date. When the client emits a fresh message (no persisted
       * record yet), fall back to either the provided metadata timestamp or
       * generate one on the fly to keep the UI payload consistent.
       */
      const persistedCreatedAt =
        persistedMessage?.createdAt instanceof Date
          ? persistedMessage.createdAt.toISOString()
          : null;

      let createdAt = persistedCreatedAt;

      if (!createdAt) {
        const candidate =
          typeof incomingMessage.metadata === "object" &&
          incomingMessage.metadata !== null &&
          "createdAt" in incomingMessage.metadata
            ? (incomingMessage.metadata as { createdAt?: unknown }).createdAt
            : undefined;

        createdAt = typeof candidate === "string" && candidate.length > 0 ? candidate : new Date().toISOString();
      }

      const metadata: ChatMessage["metadata"] = {
        createdAt,
      };

      if (clientSignature) {
        metadata.clientTextSignature = clientSignature;
      }

      return metadata;
    })();

    const resolvedMessage: ChatMessage = {
      id: incomingMessage.id,
      role: incomingMessage.role,
      parts: resolvedParts,
      metadata: resolvedMessageMetadata,
    };

    const updatedMessagesFromDb = persistedMessage
      ? messagesFromDb.map((messageRecord) =>
          messageRecord.id === resolvedMessage.id
            ? {
                ...messageRecord,
                parts: resolvedParts as typeof messageRecord.parts,
                attachments: resolvedAttachments.map((attachment) => ({
                  ...attachment,
                })) as typeof messageRecord.attachments,
              }
            : messageRecord
        )
      : messagesFromDb;

    const uiMessages = persistedMessage
      ? convertToUIMessages(updatedMessagesFromDb)
      : [...convertToUIMessages(updatedMessagesFromDb), resolvedMessage];

    // Resolve coarse location data without triggering network calls during
    // hermetic Playwright runs. The helper gracefully falls back to an empty
    // payload whenever the underlying resolver throws.
    const { longitude, latitude, city, country } = resolveRequestGeolocation(
      request
    );

    // The prompt helper expects the same string-based coordinate shape that
    // `@vercel/functions` exposes. Convert numeric values to strings so the
    // type contract remains intact while keeping `undefined` for missing data.
    const requestHints: RequestHints = {
      longitude:
        typeof longitude === "number" ? String(longitude) : undefined,
      latitude: typeof latitude === "number" ? String(latitude) : undefined,
      city,
      country,
    };

    if (!persistedMessage) {
      await saveMessages({
        messages: [
          {
            chatId: id,
            id: resolvedMessage.id,
            role: "user",
            parts: resolvedMessage.parts,
            attachments: resolvedAttachments,
            artifacts: [],
            createdAt: new Date(),
          },
        ],
      });
    }

    const streamId = generateUUID();
    await createStreamId({ streamId, chatId: id });

    let finalMergedUsage: AppUsage | undefined;
    // Collect finance artefacts emitted during streaming so they can be saved
    // atomically with the assistant response at the end of the request.
    const capturedArtifacts: MessageArtifact[] = [];

    const stream = createUIMessageStream({
      // Streaming may yield provider fallbacks and database writes, so we keep
      // the executor async to await those side effects sequentially.
      execute: async ({ writer: dataStream }) => {
        const financeTools = createFinanceTools({
          preferences: financePreferences,
          onArtifact: (artifact: FinanceArtifact) => {
            capturedArtifacts.push({ type: artifact.type, payload: artifact });

            switch (artifact.type) {
              case "finance.chart":
                dataStream.write({
                  type: "data-financeChart",
                  data: artifact,
                  transient: true,
                });
                break;
              case "finance.chart.annotations":
                dataStream.write({
                  type: "data-financeChartAnnotations",
                  data: artifact,
                  transient: true,
                });
                break;
              case "finance.fundamentals":
                dataStream.write({
                  type: "data-financeFundamentals",
                  data: artifact,
                  transient: true,
                });
                break;
              case "finance.news":
                dataStream.write({
                  type: "data-financeNews",
                  data: artifact,
                  transient: true,
                });
                break;
              case "finance.backtest":
                dataStream.write({
                  type: "data-financeBacktest",
                  data: artifact,
                  transient: true,
                });
                break;
              case "finance.screen":
                dataStream.write({
                  type: "data-financeScreen",
                  data: artifact,
                  transient: true,
                });
                break;
              default:
                break;
            }
          },
        });

        const streamOptions: StreamTextOptions = {
          system: systemPrompt({ selectedChatModel, requestHints }),
          messages: convertToModelMessages(uiMessages),
          stopWhen: stepCountIs(5),
          experimental_activeTools:
            selectedChatModel === "chat-model-reasoning"
              ? []
              : [
                  "getWeather",
                  "createDocument",
                  "updateDocument",
                  "requestSuggestions",
                  "tool.finance.chart.fetch",
                  "tool.finance.chart.annotate",
                  "tool.finance.fundamentals.fetch",
                  "tool.finance.news.fetch",
                  "tool.finance.strategy.backtest",
                  "tool.finance.screen",
                ],
          experimental_transform: smoothStream({ chunking: "word" }),
          tools: {
            getWeather,
            createDocument: createDocument({
              session: ensuredSession,
              dataStream,
            }),
            updateDocument: updateDocument({
              session: ensuredSession,
              dataStream,
            }),
            requestSuggestions: requestSuggestions({
              session: ensuredSession,
              dataStream,
            }),
            "tool.finance.chart.fetch": financeTools.chartFetch,
            "tool.finance.chart.annotate": financeTools.chartAnnotate,
            "tool.finance.fundamentals.fetch":
              financeTools.fundamentalsFetch,
            "tool.finance.news.fetch": financeTools.newsFetch,
            "tool.finance.strategy.backtest": financeTools.strategyBacktest,
            "tool.finance.screen": financeTools.screenAssets,
          },
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: "stream-text",
          },
          onFinish: async ({ usage }) => {
            try {
              const providers = await getTokenlensCatalog();
              const modelId =
                myProvider.languageModel(selectedChatModel).modelId;
              if (!modelId) {
                finalMergedUsage = usage;
                dataStream.write({
                  type: "data-usage",
                  data: finalMergedUsage,
                });
                return;
              }

              if (!providers) {
                finalMergedUsage = usage;
                dataStream.write({
                  type: "data-usage",
                  data: finalMergedUsage,
                });
                return;
              }

              const summary = getUsage({ modelId, usage, providers });
              finalMergedUsage = { ...usage, ...summary, modelId } as AppUsage;
              dataStream.write({ type: "data-usage", data: finalMergedUsage });
            } catch (err: unknown) {
              logWarning(
                "tokenlens.enrichment",
                "TokenLens enrichment failed",
                { error: err, modelId: selectedChatModel }
              );
              finalMergedUsage = usage;
              dataStream.write({ type: "data-usage", data: finalMergedUsage });
            }
          },
        };

        const result = await streamChatResponse({
          selectedChatModel,
          streamOptions,
        });

        result.consumeStream();

        dataStream.merge(
          result.toUIMessageStream({
            sendReasoning: true,
          })
        );
      },
      generateId: generateUUID,
      onFinish: async ({ messages }) => {
        const assistantWithArtifacts = [...messages]
          .reverse()
          .find((currentMessage) => currentMessage.role === "assistant");

        await saveMessages({
          messages: messages.map((currentMessage) => {
            const enrichedMessage =
              currentMessage.role === "assistant"
                ? normaliseAssistantMessage(currentMessage)
                : currentMessage;

            /**
             * Persist the enriched parts so resume requests can reconstruct a
             * deterministic text payload even when the original stream only
             * emitted transient delta fragments. Attachments are derived from
             * the same parts array, therefore we extract them from the
             * normalised structure as well.
             */
            return {
              id: currentMessage.id,
              role: currentMessage.role,
              parts: enrichedMessage.parts,
              createdAt: new Date(),
              attachments: extractAttachments(enrichedMessage.parts),
              chatId: id,
              artifacts:
                assistantWithArtifacts &&
                currentMessage.id === assistantWithArtifacts.id
                  ? capturedArtifacts
                  : [],
            };
          }),
        });

        if (finalMergedUsage) {
          try {
            await updateChatLastContextById({
              chatId: id,
              context: finalMergedUsage,
            });
          } catch (err: unknown) {
            logWarning(
              "chat.persistence",
              "Unable to persist last usage for chat",
              { chatId: id, error: err }
            );
          }
        }
      },
      onError: () => {
        return "Oops, an error occurred!";
      },
    });

    const streamContext = getStreamContext();

    if (streamContext) {
      /**
       * Register the active stream with the resumable context so follow-up
       * requests can recover mid-generation. Without this hook the `/stream`
       * endpoint falls back to replaying cached messages, leaving the client
       * without incremental updates and breaking the Playwright resume tests.
       */
      const resumableStream = await streamContext.resumableStream(
        streamId,
        () => stream.pipeThrough(new JsonToSseTransformStream())
      );

      return new Response(resumableStream);
    }

    return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
  } catch (error: unknown) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    logError("api:chat", error, { vercelId, chatId: chatIdForLogs });
    return new ChatSDKError("offline:chat").toResponse();
  }
}

export const __test = {
  ...streamChatResponseTestUtils,
  streamChatResponse,
};

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatSDKError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session || session.user?.type !== "regular") {
    return regularSessionRequiredResponse();
  }

  const sessionUser = session.user as typeof session.user & {
    id: string | undefined;
    type: "regular";
  };

  if (typeof sessionUser.id !== "string" || sessionUser.id.length === 0) {
    return regularSessionRequiredResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== sessionUser.id) {
    return new ChatSDKError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
