"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import equal from "fast-deep-equal";
import { motion } from "framer-motion";
import { memo, useState } from "react";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { cn, sanitizeText } from "@/lib/utils";
import { useDataStream } from "./data-stream-provider";
import { DocumentToolResult } from "./document";
import { DocumentPreview } from "./document-preview";
import { MessageContent } from "./elements/message";
import { Response } from "./elements/response";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "./elements/tool";
import { SparklesIcon } from "./icons";
import {
  ArtifactRenderer,
  type ArtifactRendererProps,
} from "./ArtifactRenderer";
import { MessageActions } from "./message-actions";
import { MessageEditor } from "./message-editor";
import { MessageReasoning } from "./message-reasoning";
import { PreviewAttachment } from "./preview-attachment";
import { Weather } from "./weather";
import {
  buildBacktestSlashCommand,
  buildExplainCandlePrompt,
} from "@/lib/finance/artifact-commands";
import {
  financeArtifactSchema,
  type FinanceArtifact,
  type FinanceBacktestArtifact,
  type FinanceChartArtifact,
} from "@/lib/finance/types";
import { logWarning } from "@/lib/logging";
import { useChatComposer } from "./chat-composer-context";
import { isFinanceFeatureEnabledClient } from "@/lib/feature-flags";

const isFinanceArtifact = (value: unknown): value is FinanceArtifact => {
  return financeArtifactSchema.safeParse(value).success;
};

const PurePreviewMessage = ({
  chatId,
  message,
  vote,
  isLoading,
  setMessages,
  regenerate,
  isReadonly,
  requiresScrollPadding,
}: {
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
}) => {
  // `mode` toggles between rendering the standard chat bubble and the inline
  // editor when a user chooses to revise their prompt via the edit button.
  const [mode, setMode] = useState<"view" | "edit">("view");

  const attachmentsFromMessage = message.parts.filter(
    (part) => part.type === "file"
  );

  useDataStream();
  const chatComposer = useChatComposer();
  const financeFeatureEnabled = isFinanceFeatureEnabledClient();

  // Tag the rendered message with its unique identifier so e2e helpers
  // can detect updates even when the assistant reuses identical copy.
  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="group/message w-full"
      data-role={message.role}
      data-testid={`message-${message.role}`}
      data-message-id={message.id}
      initial={{ opacity: 0 }}
    >
      <div
        className={cn("flex w-full items-start gap-2 md:gap-3", {
          "justify-end": message.role === "user" && mode !== "edit",
          "justify-start": message.role === "assistant",
        })}
      >
        {message.role === "assistant" && (
          <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
            <SparklesIcon size={14} />
          </div>
        )}

        <div
          className={cn("flex flex-col", {
            "gap-2 md:gap-4": message.parts?.some(
              (p) => p.type === "text" && p.text?.trim()
            ),
            "min-h-96": message.role === "assistant" && requiresScrollPadding,
            "w-full":
              (message.role === "assistant" &&
                message.parts?.some(
                  (p) => p.type === "text" && p.text?.trim()
                )) ||
              mode === "edit",
            "max-w-[calc(100%-2.5rem)] sm:max-w-[min(fit-content,80%)]":
              message.role === "user" && mode !== "edit",
          })}
        >
          {attachmentsFromMessage.length > 0 && (
            <div
              className="flex flex-row justify-end gap-2"
              data-testid={"message-attachments"}
            >
              {attachmentsFromMessage.map((attachment) => (
                <PreviewAttachment
                  attachment={{
                    name: attachment.filename ?? "file",
                    contentType: attachment.mediaType,
                    url: attachment.url,
                  }}
                  key={attachment.url}
                />
              ))}
            </div>
          )}

          {message.parts?.map((part, index) => {
            const { type } = part;
            const key = `message-${message.id}-part-${index}`;

            if (type === "reasoning" && part.text?.trim().length > 0) {
              return (
                <MessageReasoning
                  isLoading={isLoading}
                  key={key}
                  reasoning={part.text}
                />
              );
            }

            if (type.startsWith("data-finance")) {
              if (!financeFeatureEnabled) {
                return null;
              }

              const payload = (part as { data?: unknown }).data;

              if (!isFinanceArtifact(payload)) {
                logWarning("chat:message", "[finance] ignored malformed persisted artifact", {
                  artifactType:
                    typeof (payload as { type?: unknown })?.type === "string"
                      ? (payload as { type: string }).type
                      : part.type,
                });
                return null;
              }

              let onExplainCandle: ArtifactRendererProps["onExplainCandle"];
              let onRetest: ArtifactRendererProps["onRetest"];

              if (chatComposer && payload.type === "finance.chart") {
                const chartArtifact = payload as FinanceChartArtifact;
                onExplainCandle = ({ timestamp }) => {
                  const prompt = buildExplainCandlePrompt(chartArtifact, timestamp);
                  chatComposer.prefillPrompt(prompt, { focus: true });
                };
              }

              if (chatComposer && payload.type === "finance.backtest") {
                onRetest = (artifact: FinanceBacktestArtifact) => {
                  const command = buildBacktestSlashCommand(artifact);

                  if (!command) {
                    logWarning("chat:message", "[finance] unsupported backtest strategy for retest", {
                      strategy: artifact.strategy,
                    });
                    return;
                  }

                  chatComposer.prefillPrompt(command, { focus: true });
                };
              }

              return (
                <ArtifactRenderer
                  artifact={payload}
                  key={key}
                  onExplainCandle={onExplainCandle}
                  onRetest={onRetest}
                />
              );
            }

            if (type === "text") {
              if (mode === "view") {
                return (
                  <div key={key}>
                    <MessageContent
                      className={cn({
                        "w-fit break-words rounded-2xl px-3 py-2 text-right text-white":
                          message.role === "user",
                        "bg-transparent px-0 py-0 text-left":
                          message.role === "assistant",
                      })}
                      data-testid="message-content"
                      style={
                        message.role === "user"
                          ? { backgroundColor: "#006cff" }
                          : undefined
                      }
                    >
                      <Response>{sanitizeText(part.text)}</Response>
                    </MessageContent>
                  </div>
                );
              }

              if (mode === "edit") {
                return (
                  <div
                    className="flex w-full flex-row items-start gap-3"
                    key={key}
                  >
                    <div className="size-8" />
                    <div className="min-w-0 flex-1">
                      <MessageEditor
                        key={message.id}
                        message={message}
                        regenerate={regenerate}
                        setMode={setMode}
                        setMessages={setMessages}
                      />
                    </div>
                  </div>
                );
              }
            }

            if (type === "tool-getWeather") {
              const { toolCallId, state } = part;

              return (
                <Tool defaultOpen={true} key={toolCallId}>
                  <ToolHeader state={state} type="tool-getWeather" />
                  <ToolContent>
                    {state === "input-available" && (
                      <ToolInput input={part.input} />
                    )}
                    {state === "output-available" && (
                      <ToolOutput
                        errorText={undefined}
                        output={<Weather weatherAtLocation={part.output} />}
                      />
                    )}
                  </ToolContent>
                </Tool>
              );
            }

            if (type === "tool-createDocument") {
              const { toolCallId } = part;

              if (part.output && "error" in part.output) {
                return (
                  <div
                    className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
                    key={toolCallId}
                  >
                    Error creating document: {String(part.output.error)}
                  </div>
                );
              }

              return (
                <DocumentPreview
                  isReadonly={isReadonly}
                  key={toolCallId}
                  result={part.output}
                />
              );
            }

            if (type.startsWith("tool-tool.finance.")) {
              if (!financeFeatureEnabled) {
                /**
                 * Hide finance-specific tool outputs entirely when the feature
                 * flag is disabled. Rendering an empty placeholder avoids
                 * leaking partially initialised UI modules while still keeping
                 * the surrounding assistant message readable.
                 */
                return null;
              }

              if (!("toolCallId" in part) || !("state" in part)) {
                return null;
              }

              const toolPart = part as typeof part & {
                toolCallId: string;
                state: string;
                output?: unknown;
              };
              const { toolCallId, state } = toolPart;
              const label = type.replace(/^tool-/, "");
              const output =
                state === "output-available" &&
                isFinanceArtifact(toolPart.output)
                  ? toolPart.output
                  : undefined;

              let onExplainCandle: ArtifactRendererProps["onExplainCandle"];
              let onRetest: ArtifactRendererProps["onRetest"];

              if (chatComposer && output?.type === "finance.chart") {
                const chartArtifact = output as FinanceChartArtifact;
                onExplainCandle = ({ timestamp }) => {
                  const prompt = buildExplainCandlePrompt(
                    chartArtifact,
                    timestamp
                  );
                  chatComposer.prefillPrompt(prompt, { focus: true });
                };
              }

              if (chatComposer && output?.type === "finance.backtest") {
                onRetest = (artifact: FinanceBacktestArtifact) => {
                  const command = buildBacktestSlashCommand(artifact);

                  if (!command) {
                    // Emit a structured warning so unsupported strategies remain discoverable during QA.
                    logWarning(
                      "chat:message",
                      "[finance] unsupported backtest strategy for retest",
                      { strategy: artifact.strategy }
                    );
                    return;
                  }

                  chatComposer.prefillPrompt(command, { focus: true });
                };
              }

              return (
                <Tool defaultOpen key={toolCallId}>
                  <ToolHeader
                    displayLabel={label}
                    state={state}
                    /**
                     * The OpenAI SDK guarantees tool parts always follow the
                     * `tool-${name}` convention, so the assertion keeps the type
                     * system satisfied while we render a friendlier label.
                     */
                    type={type as `tool-${string}`}
                  />
                  <ToolContent>
                    {state === "input-available" && part.input ? (
                      <ToolInput input={part.input} />
                    ) : null}
                    <ToolOutput
                      errorText={part.errorText}
                      output={
                        output ? (
                          <ArtifactRenderer
                            artifact={output}
                            onExplainCandle={onExplainCandle}
                            onRetest={onRetest}
                          />
                        ) : null
                      }
                    />
                  </ToolContent>
                </Tool>
              );
            }

            if (type === "tool-updateDocument") {
              const { toolCallId } = part;

              if (part.output && "error" in part.output) {
                return (
                  <div
                    className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
                    key={toolCallId}
                  >
                    Error updating document: {String(part.output.error)}
                  </div>
                );
              }

              const previewArgs = part.output
                ? {
                    ...part.output,
                    kind: part.output.kind ?? "text",
                    isUpdate: true,
                  }
                : null;

              return (
                <div className="relative" key={toolCallId}>
                  <DocumentPreview
                    args={previewArgs}
                    isReadonly={isReadonly}
                    result={part.output}
                  />
                </div>
              );
            }

            if (type === "tool-requestSuggestions") {
              const { toolCallId, state } = part;

              return (
                <Tool defaultOpen={true} key={toolCallId}>
                  <ToolHeader state={state} type="tool-requestSuggestions" />
                  <ToolContent>
                    {state === "input-available" && (
                      <ToolInput input={part.input} />
                    )}
                    {state === "output-available" && (
                      <ToolOutput
                        errorText={undefined}
                        output={
                          "error" in part.output ? (
                            <div className="rounded border p-2 text-red-500">
                              Error: {String(part.output.error)}
                            </div>
                          ) : (
                            <DocumentToolResult
                              isReadonly={isReadonly}
                              result={part.output}
                              type="request-suggestions"
                            />
                          )
                        }
                      />
                    )}
                  </ToolContent>
                </Tool>
              );
            }

            return null;
          })}

          {!isReadonly && (
            <MessageActions
              chatId={chatId}
              isLoading={isLoading}
              key={`action-${message.id}`}
              message={message}
              setMode={setMode}
              vote={vote}
            />
          )}
        </div>
      </div>
    </motion.div>
  );
};

export const PreviewMessage = memo(
  PurePreviewMessage,
  (prevProps, nextProps) => {
    if (prevProps.isLoading !== nextProps.isLoading) {
      return false;
    }
    if (prevProps.message.id !== nextProps.message.id) {
      return false;
    }
    if (prevProps.requiresScrollPadding !== nextProps.requiresScrollPadding) {
      return false;
    }
    if (!equal(prevProps.message.parts, nextProps.message.parts)) {
      return false;
    }
    if (!equal(prevProps.vote, nextProps.vote)) {
      return false;
    }

    return false;
  }
);

export const ThinkingMessage = () => {
  const role = "assistant";

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="group/message w-full"
      data-role={role}
      data-testid="message-assistant-loading"
      initial={{ opacity: 0 }}
    >
      <div className="flex items-start justify-start gap-3">
        <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
          <SparklesIcon size={14} />
        </div>

        <div className="flex w-full flex-col gap-2 md:gap-4">
          <div className="p-0 text-muted-foreground text-sm">
            <LoadingText>Thinking...</LoadingText>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

const LoadingText = ({ children }: { children: React.ReactNode }) => {
  return (
    <motion.div
      animate={{ backgroundPosition: ["100% 50%", "-100% 50%"] }}
      className="flex items-center text-transparent"
      style={{
        background:
          "linear-gradient(90deg, hsl(var(--muted-foreground)) 0%, hsl(var(--muted-foreground)) 35%, hsl(var(--foreground)) 50%, hsl(var(--muted-foreground)) 65%, hsl(var(--muted-foreground)) 100%)",
        backgroundSize: "200% 100%",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
      }}
      transition={{
        duration: 1.5,
        repeat: Number.POSITIVE_INFINITY,
        ease: "linear",
      }}
    >
      {children}
    </motion.div>
  );
};
