"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  CheckIcon,
  CircleAlertIcon,
  CopyIcon,
  FolderOpenIcon,
  PaperclipIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  UploadIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputProvider,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Markdown } from "@/components/markdown";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { chatLabel } from "@/features/chat/domain/chat-label";
import { chatPath } from "@/features/chat/domain/chat-paths";
import { messageText } from "@/features/chat/domain/message-text";
import { useChatList } from "@/features/chat/hooks/use-chat-list";
import {
  MAX_ATTACHED_MATERIALS,
  MAX_MESSAGE_LENGTH,
  tooManyMaterialsMessage,
  messageTooLongMessage,
} from "@/features/chat/schemas";
import { getChatTitle } from "@/features/chat/server/actions";
import type {
  ChatUIMessage,
  ChatWithMessages,
  ModelOption,
} from "@/features/chat/types";
import {
  MATERIAL_MEDIA_TYPES,
  MaterialChip,
  MaterialPicker,
  MaterialViewer,
  useMaterialUploads,
  type MaterialListItem,
  type MaterialReference,
} from "@/features/courses";
import {
  DailyLimitNotice,
  refreshDailyLimitStatus,
  type DailyLimitStatus,
} from "@/features/usage";

type ChatProps = {
  /**
   * The stored Chat (`getChat`), or an unsaved one without messages
   * (`newChat`). Without a title, it gets one after a reply.
   */
  chat: ChatWithMessages;
  /**
   * True on a Course's new Chat page: the first message creates the Chat
   * with its id, in its Course.
   */
  isNew: boolean;
  /** The model choices to offer, in display order. */
  modelOptions: ModelOption[];
  /**
   * The Course's Materials, to attach to messages and to show attached ones
   * under their current names.
   */
  materials: MaterialListItem[];
  /** The signed-in Student, whose Storage folder uploads go to. */
  ownerId: string;
  /** The Student's Daily limit status when the page loaded. */
  dailyLimit: DailyLimitStatus;
};

/** Copies a message's text, confirming it briefly with a check mark. */
function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timeout);
  }, [copied]);

  return (
    <MessageAction
      tooltip={copied ? "Copied" : "Copy"}
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => {},
        );
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </MessageAction>
  );
}

/**
 * A Chat with the AI: the messages, streamed replies and the message input.
 * Only the new message is sent; the server loads the stored history.
 */
export function Chat({
  chat,
  isNew,
  modelOptions,
  materials: courseMaterials,
  ownerId,
  dailyLimit: initialDailyLimit,
}: ChatProps) {
  const chatId = chat.id;
  const [inputError, setInputError] = useState<string | null>(null);
  const [modelChoice, setModelChoice] = useState(chat.modelChoice);
  const [dailyLimit, setDailyLimit] = useState(initialDailyLimit);
  /** The Materials attached to the message being written. */
  const [attached, setAttached] = useState<MaterialReference[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [opened, setOpened] = useState<MaterialListItem | null>(null);
  /** Materials uploaded from this message box since the page loaded. */
  const [uploaded, setUploaded] = useState<MaterialListItem[]>([]);
  const materials = [...uploaded, ...courseMaterials];
  const materialsById = new Map(materials.map((m) => [m.id, m]));
  const fileInput = useRef<HTMLInputElement>(null);
  const dropZone = useRef<HTMLDivElement>(null);
  const {
    uploads,
    add: addUploads,
    retry: retryUpload,
    remove: removeUpload,
  } = useMaterialUploads({
    ownerId,
    courseId: chat.courseId,
    // A refresh would replace a new Chat and the message in it.
    refreshPage: false,
    onRegistered: (material) => {
      setUploaded((current) => [
        {
          id: material.materialId,
          name: material.name,
          mediaType: material.mediaType,
          sizeBytes: 0,
          createdAt: new Date().toISOString(),
        },
        ...current,
      ]);
      setAttached((current) => [...current, material]);
    },
  });
  const uploading = uploads.length > 0;
  const limitReached = dailyLimit.level === "reached";
  const { noteChatActivity, relabelChat } = useChatList();
  const titled = useRef(chat.title !== null);
  const {
    messages,
    sendMessage,
    regenerate,
    stop,
    setMessages,
    status,
    error,
    clearError,
  } = useChat<ChatUIMessage>({
    onFinish: ({ message, isAbort }) => {
      // The server stores a stopped reply as stopped; show it so now too.
      if (isAbort && message.role === "assistant") {
        setMessages((current) =>
          current.map((m) =>
            m.id === message.id
              ? { ...m, metadata: { ...m.metadata, stopped: true } }
              : m,
          ),
        );
      }
      // Every reply, or a refusal at the limit, can change the status.
      refreshDailyLimitStatus().then(setDailyLimit, () => {});
      // The server names an untitled Chat before the reply ends. After a
      // Stop it may not have yet; the next reply then picks the title up.
      if (!titled.current) {
        getChatTitle({ chatId }).then(
          (result) => {
            if (!result.ok || result.data === null) return;
            titled.current = true;
            relabelChat({ id: chatId, label: result.data });
          },
          () => {},
        );
      }
    },
    id: chatId,
    messages: chat.messages,
    // The database stores message ids as uuids.
    generateId: () => crypto.randomUUID(),
    transport: new DefaultChatTransport({
      api: "/api/chat",
      // `body` carries the model choice of each send and retry.
      prepareSendMessagesRequest: ({ messages, body }) => ({
        body: {
          ...body,
          chatId,
          ...(isNew && { courseId: chat.courseId }),
          message: messages.at(-1),
        },
      }),
    }),
  });
  const selectedOption = modelOptions.find(({ key }) => key === modelChoice);

  // Once the reply streams, the message is stored: a new Chat gets its own
  // address without remounting, so reloading or bookmarking it works, and the
  // Chat moves to the top of the sidebar.
  const path = chatPath(chat.courseId, chatId);
  const firstMessage = messages[0]?.parts ?? null;
  useEffect(() => {
    if (status !== "streaming") return;
    if (isNew && window.location.pathname !== path) {
      window.history.replaceState(null, "", path);
    }
    noteChatActivity({
      id: chatId,
      label: chatLabel({ title: null, firstMessage }),
    });
  }, [isNew, status, path, chatId, firstMessage, noteChatActivity]);

  const isBusy = status === "submitted" || status === "streaming";
  const lastMessage = messages.at(-1);

  /** Uploads picked, pasted or dropped files, within the message's limit. */
  function uploadFiles(files: Iterable<File>) {
    const picked = [...files];
    const room = Math.max(
      MAX_ATTACHED_MATERIALS - attached.length - uploads.length,
      0,
    );
    if (picked.length > room) setInputError(tooManyMaterialsMessage);
    else setInputError(null);
    addUploads(picked.slice(0, room));
  }

  // Files pasted or dropped on the message box are uploaded like the ones
  // "Upload file" picks, not left to the prompt input's own attachments.
  const uploadFilesRef = useRef(uploadFiles);
  useEffect(() => {
    uploadFilesRef.current = uploadFiles;
  });
  useEffect(() => {
    const zone = dropZone.current;
    if (!zone) return;
    const takeFiles = (event: Event, files: File[]) => {
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (!limitReached) uploadFilesRef.current(files);
    };
    const onPaste = (event: ClipboardEvent) =>
      takeFiles(
        event,
        [...(event.clipboardData?.items ?? [])].flatMap((item) => {
          const file = item.kind === "file" ? item.getAsFile() : null;
          return file ? [file] : [];
        }),
      );
    const onDrop = (event: DragEvent) =>
      takeFiles(event, [...(event.dataTransfer?.files ?? [])]);
    // Capture, to run before the prompt input's own handlers.
    zone.addEventListener("paste", onPaste, true);
    zone.addEventListener("drop", onDrop, true);
    return () => {
      zone.removeEventListener("paste", onPaste, true);
      zone.removeEventListener("drop", onDrop, true);
    };
  }, [limitReached]);

  function toggleAttached(material: MaterialListItem) {
    setAttached((current) =>
      current.some(({ materialId }) => materialId === material.id)
        ? current.filter(({ materialId }) => materialId !== material.id)
        : [
            ...current,
            {
              materialId: material.id,
              name: material.name,
              mediaType: material.mediaType as MaterialReference["mediaType"],
            },
          ],
    );
  }

  async function handleSubmit({ text }: { text: string }) {
    if (
      (text.trim() === "" && attached.length === 0) ||
      isBusy ||
      limitReached ||
      uploading
    ) {
      throw new Error("Nothing to send.");
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      setInputError(messageTooLongMessage);
      // Rejecting keeps the text in the input.
      throw new Error(messageTooLongMessage);
    }
    setInputError(null);
    clearError();
    void sendMessage(
      {
        parts: [
          ...(text.trim() === "" ? [] : [{ type: "text" as const, text }]),
          ...attached.map((data) => ({ type: "data-material" as const, data })),
        ],
      },
      { body: { modelChoice } },
    );
    setAttached([]);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4">
      <Conversation className="min-h-0">
        <ConversationContent className="mx-auto w-full max-w-3xl px-0">
          {messages.length === 0 ? (
            <ConversationEmptyState
              title="What are you studying?"
              description="Ask a question or share a problem you are working on."
            />
          ) : (
            messages.map((message) => {
              const isLast = message === lastMessage;
              const isStreaming = isBusy && isLast;
              return (
                <Message from={message.role} key={message.id}>
                  <MessageContent data-testid="message-text">
                    {message.role === "assistant" ? (
                      <Markdown streaming={status === "streaming" && isLast}>
                        {messageText(message.parts)}
                      </Markdown>
                    ) : (
                      <>
                        <AttachedMaterials
                          parts={message.parts}
                          materialsById={materialsById}
                          onOpen={setOpened}
                        />
                        {messageText(message.parts) !== "" && (
                          <p className="whitespace-pre-wrap">
                            {messageText(message.parts)}
                          </p>
                        )}
                      </>
                    )}
                  </MessageContent>
                  {!isStreaming && (
                    <MessageActions
                      className={
                        message.role === "user" ? "justify-end" : undefined
                      }
                    >
                      {message.metadata?.stopped && (
                        <span className="px-1 text-xs text-muted-foreground">
                          Stopped
                        </span>
                      )}
                      <CopyAction text={messageText(message.parts)} />
                      {message.role === "assistant" &&
                        isLast &&
                        !limitReached && (
                          <MessageAction
                            tooltip="Regenerate"
                            onClick={() => {
                              clearError();
                              void regenerate({ body: { modelChoice } });
                            }}
                          >
                            <RefreshCwIcon />
                          </MessageAction>
                        )}
                    </MessageActions>
                  )}
                </Message>
              );
            })
          )}
          {status === "submitted" && (
            <Shimmer className="text-sm">Thinking…</Shimmer>
          )}
          {/* At the limit, the notice below explains the refusal. */}
          {error && !limitReached && (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{error.message}</AlertDescription>
              <AlertAction>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void regenerate({ body: { modelChoice } })}
                >
                  <RotateCcwIcon />
                  Retry
                </Button>
              </AlertAction>
            </Alert>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div
        ref={dropZone}
        className="mx-auto flex w-full max-w-3xl flex-col gap-2"
      >
        <DailyLimitNotice status={dailyLimit} />
        <input
          ref={fileInput}
          type="file"
          multiple
          aria-label="Upload file"
          accept={MATERIAL_MEDIA_TYPES.join(",")}
          // Opened by "Upload file" in the attach menu.
          hidden
          onChange={(event) => {
            if (event.target.files) uploadFiles(event.target.files);
            event.target.value = "";
          }}
        />
        {/* Controlled, so a refused message stays in the input. */}
        <PromptInputProvider>
          <PromptInput onSubmit={handleSubmit}>
            {(attached.length > 0 || uploading) && (
              <PromptInputHeader aria-label="Attached materials">
                {attached.map((material) => (
                  <MaterialChip
                    key={material.materialId}
                    name={
                      materialsById.get(material.materialId)?.name ??
                      material.name
                    }
                    mediaType={material.mediaType}
                    onRemove={() =>
                      setAttached((current) =>
                        current.filter(
                          ({ materialId }) =>
                            materialId !== material.materialId,
                        ),
                      )
                    }
                  />
                ))}
                {uploads.map((upload) => (
                  <MaterialChip
                    key={upload.key}
                    name={upload.filename}
                    mediaType={upload.mediaType}
                    progress={
                      upload.status === "failed" ? undefined : upload.progress
                    }
                    error={
                      upload.status === "failed" ? upload.message : undefined
                    }
                    onRetry={
                      upload.canRetry
                        ? () => retryUpload(upload.key)
                        : undefined
                    }
                    onRemove={
                      upload.status === "registering"
                        ? undefined
                        : () => removeUpload(upload.key)
                    }
                  />
                ))}
              </PromptInputHeader>
            )}
            <PromptInputBody>
              <PromptInputTextarea
                aria-label="Message"
                aria-invalid={inputError !== null}
                aria-describedby={inputError ? "chat-input-error" : undefined}
                placeholder="Ask about your studies…"
                disabled={limitReached}
                onChange={() => setInputError(null)}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger
                    aria-label="Attach"
                    tooltip="Attach"
                    disabled={limitReached}
                  >
                    <PaperclipIcon className="size-4" />
                  </PromptInputActionMenuTrigger>
                  <PromptInputActionMenuContent>
                    <PromptInputActionMenuItem
                      onSelect={() => fileInput.current?.click()}
                    >
                      <UploadIcon />
                      Upload file
                    </PromptInputActionMenuItem>
                    <PromptInputActionMenuItem
                      onSelect={() => setPickerOpen(true)}
                    >
                      <FolderOpenIcon />
                      Choose from materials
                    </PromptInputActionMenuItem>
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
                {/* Applies from the next message on. */}
                <PromptInputSelect
                  value={modelChoice}
                  onValueChange={setModelChoice}
                >
                  <PromptInputSelectTrigger aria-label="Model" size="sm">
                    <PromptInputSelectValue>
                      {selectedOption?.label}
                    </PromptInputSelectValue>
                  </PromptInputSelectTrigger>
                  <PromptInputSelectContent position="popper" align="start">
                    {modelOptions.map((option) => (
                      <PromptInputSelectItem
                        key={option.key}
                        value={option.key}
                      >
                        <span className="flex flex-col items-start! gap-0!">
                          <span>{option.label}</span>
                          <span
                            data-testid="model-name"
                            className="text-xs text-muted-foreground"
                          >
                            {option.modelName}
                          </span>
                        </span>
                      </PromptInputSelectItem>
                    ))}
                  </PromptInputSelectContent>
                </PromptInputSelect>
              </PromptInputTools>
              {/* While a reply is on its way, the button is Stop. */}
              <PromptInputSubmit
                status={status}
                onStop={() => void stop()}
                disabled={!isBusy && (limitReached || uploading)}
              />
            </PromptInputFooter>
          </PromptInput>
        </PromptInputProvider>
        <MaterialPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          materials={materials}
          pickedIds={[
            ...attached.map(({ materialId }) => materialId),
            ...uploads.map(({ key }) => key),
          ]}
          max={MAX_ATTACHED_MATERIALS}
          onToggle={toggleAttached}
        />
        <MaterialViewer material={opened} onClose={() => setOpened(null)} />
        {inputError && (
          <p
            id="chat-input-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {inputError}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The Materials attached to a sent message, under their current names. A
 * deleted one shows the name it had when attached.
 */
function AttachedMaterials({
  parts,
  materialsById,
  onOpen,
}: {
  parts: ChatUIMessage["parts"];
  materialsById: Map<string, MaterialListItem>;
  onOpen: (material: MaterialListItem) => void;
}) {
  const references = parts.flatMap((part) =>
    part.type === "data-material" ? [part.data] : [],
  );
  if (references.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {references.map((reference, index) => {
        const material = materialsById.get(reference.materialId);
        return (
          <MaterialChip
            key={`${reference.materialId}-${index}`}
            name={material?.name ?? reference.name}
            mediaType={reference.mediaType}
            deleted={!material}
            onOpen={material && (() => onOpen(material))}
          />
        );
      })}
    </div>
  );
}
