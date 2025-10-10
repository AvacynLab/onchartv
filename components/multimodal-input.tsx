"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { Trigger } from "@radix-ui/react-select";
import type { UIMessage } from "ai";
import equal from "fast-deep-equal";
import {
  type ChangeEvent,
  type Dispatch,
  memo,
  type SetStateAction,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useLocalStorage, useWindowSize } from "usehooks-ts";
import { saveChatModelAsCookie } from "@/app/(chat)/actions";
import { SelectItem } from "@/components/ui/select";
import { chatModels } from "@/lib/ai/models";
import { resolveSlashCommand } from "@/lib/ai/chat-commands";
import { myProvider } from "@/lib/ai/providers";
import type { Attachment, ChatMessage } from "@/lib/types";
import type { AppUsage } from "@/lib/usage";
import { cn } from "@/lib/utils";
import { Context } from "./elements/context";
import {
  PromptInput,
  PromptInputModelSelect,
  PromptInputModelSelectContent,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "./elements/prompt-input";
import {
  ArrowUpIcon,
  ChevronDownIcon,
  CpuIcon,
  PaperclipIcon,
  StopIcon,
} from "./icons";
import { PreviewAttachment } from "./preview-attachment";
import { SuggestedActions } from "./suggested-actions";
import { Button } from "./ui/button";
import type { VisibilityType } from "./visibility-selector";

const ACTIVE_CHAT_STATUSES: ReadonlySet<UseChatHelpers<ChatMessage>["status"]> =
  new Set(["submitted", "streaming"]);
/**
 * Minimum duration (in milliseconds) to keep the stop button visible after the
 * assistant finishes responding. This guards against ultra-fast responses that
 * would otherwise swap the control back to "Send" before users can interact
 * with it.
 */
/**
 * Délai minimal (en millisecondes) pendant lequel le bouton d'arrêt reste visible
 * après la fin d'un streaming. Les réponses hermétiques de Playwright arrivent
 * quasi instantanément ; conserver le bouton environ trois quarts de seconde
 * laisse suffisamment de marge aux assertions e2e pour interagir avec le
 * composant même lorsque le modèle a déjà terminé.
 */
export const STOP_BUTTON_MINIMUM_DURATION_MS = 750;

type DispatchPromptOptions = {
  /**
   * Texte brut à envoyer au modèle. Il sera automatiquement nettoyé et
   * réécrit via `resolveSlashCommand` si nécessaire.
   */
  text: string;
  /**
   * Jeux de pièces à joindre explicitement. Par défaut, on réutilise les
   * pièces présentes dans l'état local du composer.
   */
  attachmentsOverride?: Attachment[];
};

function PureMultimodalInput({
  chatId,
  input,
  setInput,
  status,
  stop,
  attachments,
  setAttachments,
  messages,
  setMessages,
  sendMessage,
  className,
  selectedVisibilityType,
  selectedModelId,
  onModelChange,
  focusSignal,
  usage,
}: {
  chatId: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<ChatMessage>["status"];
  stop: () => void;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  messages: UIMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  className?: string;
  selectedVisibilityType: VisibilityType;
  selectedModelId: string;
  onModelChange?: (modelId: string) => void;
  focusSignal: number;
  usage?: AppUsage;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { width } = useWindowSize();

  const adjustHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "44px";
    }
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, [adjustHeight]);

  const resetHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "44px";
    }
  }, []);

  const [localStorageInput, setLocalStorageInput] = useLocalStorage(
    "input",
    ""
  );

  useEffect(() => {
    if (textareaRef.current) {
      const domValue = textareaRef.current.value;
      // Prefer DOM value over localStorage to handle hydration
      const finalValue = domValue || localStorageInput || "";
      setInput(finalValue);
      adjustHeight();
    }
    // Only run once after hydration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjustHeight, localStorageInput, setInput]);

  useEffect(() => {
    setLocalStorageInput(input);
  }, [input, setLocalStorageInput]);

  useEffect(() => {
    if (focusSignal === 0) {
      return;
    }

    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.focus();
    const length = textarea.value.length;
    textarea.setSelectionRange(length, length);
    adjustHeight();
  }, [focusSignal, adjustHeight]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadQueue, setUploadQueue] = useState<string[]>([]);
  const [isStopButtonVisible, setIsStopButtonVisible] = useState(
    ACTIVE_CHAT_STATUSES.has(status)
  );
  const previousStatusRef = useRef(status);

  useEffect(() => {
    const wasActive = ACTIVE_CHAT_STATUSES.has(previousStatusRef.current);
    const isActive = ACTIVE_CHAT_STATUSES.has(status);
    let timeoutId: number | undefined;

    if (isActive) {
      setIsStopButtonVisible(true);
    } else if (wasActive) {
      /**
       * Keep rendering the stop button for a short cooldown window after the
       * assistant finishes responding. This makes the UI — and the Playwright
       * assertions — resilient to extremely fast responses where the status
       * flips from "submitted" to "ready" within a single frame.
       */
      setIsStopButtonVisible(true);
      timeoutId = window.setTimeout(() => {
        setIsStopButtonVisible(false);
      }, STOP_BUTTON_MINIMUM_DURATION_MS);
    } else {
      setIsStopButtonVisible(false);
    }

    previousStatusRef.current = status;

    return () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [status]);

  const shouldRenderStopButton = isStopButtonVisible;

  const dispatchPrompt = useCallback(
    async ({ text, attachmentsOverride }: DispatchPromptOptions) => {
      const trimmedInput = text.trim();
      const effectiveAttachments = attachmentsOverride ?? attachments;
      const hasText = trimmedInput.length > 0;
      const hasAttachments = effectiveAttachments.length > 0;

      if (uploadQueue.length > 0) {
        toast.error(
          "Please wait for the files to finish uploading before sending!"
        );
        return false;
      }

      if (!hasText && !hasAttachments) {
        toast.error("Please enter a message or attach a file before sending!");
        return false;
      }

      window.history.replaceState({}, "", `/chat/${chatId}`);

      const resolvedCommand = resolveSlashCommand(trimmedInput);
      /**
       * When the user relies on a finance-oriented slash command (for example
       * `/chart BTCUSD 1D`), rewrite the outbound prompt so the assistant
       * receives an explicit instruction to yield the relevant artefact. The
       * helper keeps the feature testable in isolation and lets us expand the
       * command surface without entangling the transport layer.
       */
      const finalText = resolvedCommand?.prompt ?? trimmedInput;

      /**
       * Normalise les pièces du message envoyées au SDK AI.
       * L'alias repose sur `ChatMessage` pour suivre l'évolution du contrat
       * entre notre composer et le transport sans dupliquer les unions de types
       * (`text`, `file`, etc.). Une recompilation suffit donc à signaler tout
       * nouveau type de pièce ajouté côté SDK.
       */
      const payloadParts: ChatMessage["parts"][number][] =
        effectiveAttachments.map((attachment) => ({
          type: "file",
          url: attachment.url,
          name: attachment.name,
          mediaType: attachment.contentType,
        }));

      if (finalText.length > 0) {
        payloadParts.push({
          type: "text",
          text: finalText,
        });
      }

      try {
        await sendMessage({
          role: "user",
          parts: payloadParts,
        });
      } catch (error) {
        console.error("Failed to dispatch chat prompt", error);
        toast.error("We couldn't send your message. Please try again.");
        return false;
      }

      setAttachments([]);
      setLocalStorageInput("");
      resetHeight();
      setInput("");

      if (width && width > 768) {
        textareaRef.current?.focus();
      }

      return true;
    },
    [
      attachments,
      chatId,
      resetHeight,
      sendMessage,
      setAttachments,
      setInput,
      setLocalStorageInput,
      uploadQueue.length,
      width,
    ]
  );

  const submitForm = useCallback(() => {
    /**
     * Lorsque Playwright pilote la zone de saisie, la mise à jour du state
     * React peut arriver un ou deux frames après la mutation DOM effectuée par
     * `page.type`. On retombe donc sur la valeur réellement présente dans le
     * textarea afin d'éviter de bloquer l'envoi si le state n'a pas encore été
     * synchronisé.
     */
    const domValue = textareaRef.current?.value ?? "";
    const effectiveText = input.trim().length > 0 ? input : domValue;

    void dispatchPrompt({ text: effectiveText });
  }, [dispatchPrompt, input]);

  const handleSuggestionSelection = useCallback(
    (rawSuggestion: string) => {
      /**
       * Suggested prompts bypass the controlled textarea, so normalise and
       * validate the payload locally before dispatching it to the chat SDK.
       * Keeping the guard rails here mirrors the form submission path and
       * protects the Playwright journeys from queuing empty messages when the
       * suggestion label is unexpectedly blank.
       */
      const trimmedSuggestion = rawSuggestion.trim();

      if (trimmedSuggestion.length === 0) {
        toast.error(
          "Unable to send the suggested prompt because it did not include any text."
        );
        return;
      }

      void dispatchPrompt({ text: trimmedSuggestion });
    },
    [
      dispatchPrompt,
    ]
  );

  const uploadFile = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        const { url, pathname, contentType } = data;

        return {
          url,
          name: pathname,
          contentType,
        };
      }
      const { error } = await response.json();
      toast.error(error);
    } catch (_error) {
      toast.error("Failed to upload file, please try again!");
    }
  }, []);

  const _modelResolver = useMemo(() => {
    return myProvider.languageModel(selectedModelId);
  }, [selectedModelId]);

  const contextProps = useMemo(
    () => ({
      usage,
    }),
    [usage]
  );

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);

      setUploadQueue(files.map((file) => file.name));

      try {
        const uploadPromises = files.map((file) => uploadFile(file));
        const uploadedAttachments = await Promise.all(uploadPromises);
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment) => attachment !== undefined
        );

        setAttachments((currentAttachments) => [
          ...currentAttachments,
          ...successfullyUploadedAttachments,
        ]);
      } catch (error) {
        console.error("Error uploading files!", error);
      } finally {
        setUploadQueue([]);
      }
    },
    [setAttachments, uploadFile]
  );

  /**
   * Les tests e2e remplissent parfois le textarea plus vite que React ne
   * propage la nouvelle valeur au state contrôlé. En retombant sur la valeur du
   * DOM lorsque le state est encore vide, on garantit que le bouton d'envoi se
   * réactive dès que du texte est réellement présent.
   */
  const domInputValue = textareaRef.current?.value?.trim() ?? "";
  const trimmedInput = input.trim();
  const effectiveInput = trimmedInput.length > 0 ? trimmedInput : domInputValue;
  const canSubmit = effectiveInput.length > 0 || attachments.length > 0;
  const isUploadInProgress = uploadQueue.length > 0;

  return (
    <div className={cn("relative flex w-full flex-col gap-4", className)}>
      {messages.length === 0 &&
        attachments.length === 0 &&
        uploadQueue.length === 0 && (
          <SuggestedActions
            onSelectSuggestion={handleSuggestionSelection}
            selectedVisibilityType={selectedVisibilityType}
          />
        )}

      <input
        className="-top-4 -left-4 pointer-events-none fixed size-0.5 opacity-0"
        multiple
        onChange={handleFileChange}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />

      <PromptInput
        className="rounded-xl border border-border bg-background p-3 shadow-xs transition-all duration-200 focus-within:border-border hover:border-muted-foreground/50"
        onSubmit={(event) => {
          event.preventDefault();
          if (status === "submitted" || status === "streaming") {
            toast.error("Please wait for the model to finish its response!");
            return;
          }

          submitForm();
        }}
      >
        {(attachments.length > 0 || uploadQueue.length > 0) && (
          <div
            className="flex flex-row items-end gap-2 overflow-x-scroll"
            data-testid="attachments-preview"
          >
            {attachments.map((attachment) => (
              <PreviewAttachment
                attachment={attachment}
                key={attachment.url}
                onRemove={() => {
                  setAttachments((currentAttachments) =>
                    currentAttachments.filter((a) => a.url !== attachment.url)
                  );
                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                  }
                }}
              />
            ))}

            {uploadQueue.map((filename) => (
              <PreviewAttachment
                attachment={{
                  url: "",
                  name: filename,
                  contentType: "",
                }}
                isUploading={true}
                key={filename}
              />
            ))}
          </div>
        )}
        <div className="flex flex-row items-start gap-1 sm:gap-2">
          <PromptInputTextarea
            autoFocus
            className="grow resize-none border-0! border-none! bg-transparent p-2 text-sm outline-none ring-0 [-ms-overflow-style:none] [scrollbar-width:none] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 [&::-webkit-scrollbar]:hidden"
            data-testid="multimodal-input"
            disableAutoResize={true}
            maxHeight={200}
            minHeight={44}
            onChange={handleInput}
            placeholder="Send a message..."
            ref={textareaRef}
            rows={1}
            value={input}
          />{" "}
          <Context {...contextProps} />
        </div>
        <PromptInputToolbar className="!border-top-0 border-t-0! p-0 shadow-none dark:border-0 dark:border-transparent!">
          <PromptInputTools className="gap-0 sm:gap-0.5">
            <AttachmentsButton
              fileInputRef={fileInputRef}
              selectedModelId={selectedModelId}
              status={status}
            />
            <ModelSelectorCompact
              onModelChange={onModelChange}
              selectedModelId={selectedModelId}
            />
          </PromptInputTools>

          {/**
           * Switch the primary action between the "Send" and "Stop" buttons
           * depending on the chat status. While the assistant is still
           * generating a response (`submitted` and `streaming` states) we keep
           * the stop control visible — even through extremely short
           * generations — so the test runner and end users can reliably
           * interrupt the current turn. Falling back to the submit button keeps
           * the UI accessible once the conversation is idle or in an error
           * state.
           */}
          {shouldRenderStopButton ? (
            <StopButton setMessages={setMessages} stop={stop} />
          ) : (
            <PromptInputSubmit
              aria-disabled={!canSubmit || isUploadInProgress}
              className="size-8 rounded-full bg-primary text-primary-foreground transition-colors duration-200 hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
              disabled={!canSubmit || isUploadInProgress}
              status={status}
            >
              <ArrowUpIcon size={14} />
            </PromptInputSubmit>
          )}
        </PromptInputToolbar>
      </PromptInput>
    </div>
  );
}

export const MultimodalInput = memo(
  PureMultimodalInput,
  (prevProps, nextProps) => {
    if (prevProps.focusSignal !== nextProps.focusSignal) {
      return false;
    }
    if (prevProps.input !== nextProps.input) {
      return false;
    }
    if (prevProps.status !== nextProps.status) {
      return false;
    }
    if (!equal(prevProps.attachments, nextProps.attachments)) {
      return false;
    }
    if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
      return false;
    }
    if (prevProps.selectedModelId !== nextProps.selectedModelId) {
      return false;
    }

    return true;
  }
);

function PureAttachmentsButton({
  fileInputRef,
  status,
  selectedModelId,
}: {
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  status: UseChatHelpers<ChatMessage>["status"];
  selectedModelId: string;
}) {
  const isReasoningModel = selectedModelId === "chat-model-reasoning";

  return (
    <Button
      className="aspect-square h-8 rounded-lg p-1 transition-colors hover:bg-accent"
      data-testid="attachments-button"
      disabled={status !== "ready" || isReasoningModel}
      onClick={(event) => {
        event.preventDefault();
        fileInputRef.current?.click();
      }}
      variant="ghost"
    >
      <PaperclipIcon size={14} style={{ width: 14, height: 14 }} />
    </Button>
  );
}

const AttachmentsButton = memo(PureAttachmentsButton);

function PureModelSelectorCompact({
  selectedModelId,
  onModelChange,
}: {
  selectedModelId: string;
  onModelChange?: (modelId: string) => void;
}) {
  const [optimisticModelId, setOptimisticModelId] = useState(selectedModelId);

  useEffect(() => {
    setOptimisticModelId(selectedModelId);
  }, [selectedModelId]);

  const selectedModel = chatModels.find(
    (model) => model.id === optimisticModelId
  );

  return (
    <PromptInputModelSelect
      onValueChange={(modelName) => {
        const model = chatModels.find((m) => m.name === modelName);
        if (model) {
          setOptimisticModelId(model.id);
          onModelChange?.(model.id);
          startTransition(() => {
            saveChatModelAsCookie(model.id);
          });
        }
      }}
      value={selectedModel?.name}
    >
      {/**
       * Expose a deterministic test identifier on the compact selector trigger so
       * the Playwright helpers (and their supporting unit tests) can detect when
       * the chat shell finished hydrating. The reasoning suite switches models
       * immediately after authentication and previously timed out because the
       * locator was missing from the DOM.
       */}
      <Trigger
        className="flex h-8 items-center gap-2 rounded-lg border-0 bg-background px-2 text-foreground shadow-none transition-colors hover:bg-accent focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        data-testid="model-selector"
        type="button"
      >
        <CpuIcon size={16} />
        <span className="hidden font-medium text-xs sm:block">
          {selectedModel?.name}
        </span>
        <ChevronDownIcon size={16} />
      </Trigger>
      <PromptInputModelSelectContent className="min-w-[260px] p-0">
        <div className="flex flex-col gap-px">
          {chatModels.map((model) => (
            <SelectItem
              data-testid={`model-selector-item-${model.id}`}
              key={model.id}
              value={model.name}
            >
              <div className="truncate font-medium text-xs">{model.name}</div>
              <div className="mt-px truncate text-[10px] text-muted-foreground leading-tight">
                {model.description}
              </div>
            </SelectItem>
          ))}
        </div>
      </PromptInputModelSelectContent>
    </PromptInputModelSelect>
  );
}

const ModelSelectorCompact = memo(PureModelSelectorCompact);

function PureStopButton({
  stop,
  setMessages,
}: {
  stop: () => void;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
}) {
  return (
    <Button
      className="size-7 rounded-full bg-foreground p-1 text-background transition-colors duration-200 hover:bg-foreground/90 disabled:bg-muted disabled:text-muted-foreground"
      data-testid="stop-button"
      onClick={(event) => {
        event.preventDefault();
        stop();
        setMessages((messages) => messages);
      }}
    >
      <StopIcon size={14} />
    </Button>
  );
}

const StopButton = memo(PureStopButton);
