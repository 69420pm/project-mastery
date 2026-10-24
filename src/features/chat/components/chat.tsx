"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  CircleAlertIcon,
  FolderOpenIcon,
  GraduationCapIcon,
  PaperclipIcon,
  RotateCcwIcon,
  UploadIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
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
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AttachedMaterials } from "@/features/chat/components/attached-materials";
import { ContextAction } from "@/features/chat/components/context-action";
import { MessageActionRow } from "@/features/chat/components/message-action-row";
import { ReplyFooter } from "@/features/chat/components/reply-footer";
import { ReplyParts } from "@/features/chat/components/reply-parts";
import { chatLabel } from "@/features/chat/domain/chat-label";
import { chatPath } from "@/features/chat/domain/chat-paths";
import { messageText } from "@/lib/ai/reply";
import { cn } from "@/lib/utils";
import { replyActivity, THINKING } from "@/features/chat/domain/reply-activity";
import { questionStates } from "@/features/chat/domain/reply-steps";
import { useChatList } from "@/features/chat/hooks/use-chat-list";
import { useMessageAttachments } from "@/features/chat/hooks/use-message-attachments";
import {
  MAX_ATTACHED_MATERIALS,
  MAX_MESSAGE_LENGTH,
  messageTooLongMessage,
} from "@/features/chat/schemas";
import { getChatTitle } from "@/features/chat/server/actions";
import type { ChatUIMessage, ChatWithMessages } from "@/features/chat/types";
import {
  MATERIAL_MEDIA_TYPES,
  MaterialChip,
  MaterialPicker,
  MaterialViewer,
  type MaterialListItem,
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
  /**
   * The Course's Materials, to attach to messages and to show attached ones
   * under their current names.
   */
  materials: MaterialListItem[];
  /** The signed-in Student, whose Storage folder uploads go to. */
  ownerId: string;
  /** The empty state's description, computed by the page. */
  emptyDescription?: string;
  /** The Student's Daily limit status when the page loaded. */
  dailyLimit: DailyLimitStatus;
};

const DEFAULT_EMPTY_DESCRIPTION =
  "Say hi and the AI picks up with what's next on your map, or ask about anything.";

/**
 * A Chat with the AI: the messages, streamed replies and the message input.
 * Only the new message is sent; the server loads the stored history.
 */
export function Chat({
  chat,
  isNew,
  materials: courseMaterials,
  ownerId,
  emptyDescription = DEFAULT_EMPTY_DESCRIPTION,
  dailyLimit: initialDailyLimit,
}: ChatProps) {
  const chatId = chat.id;
  const [inputError, setInputError] = useState<string | null>(null);
  const [dailyLimit, setDailyLimit] = useState(initialDailyLimit);
  const [opened, setOpened] = useState<MaterialListItem | null>(null);
  const limitReached = dailyLimit.level === "reached";
  const {
    attached,
    clearAttached,
    toggleAttached,
    detach,
    materials,
    materialsById,
    pickerOpen,
    setPickerOpen,
    fileInput,
    dropZone,
    uploadFiles,
    uploads,
    uploading,
    retryUpload,
    removeUpload,
  } = useMessageAttachments({
    ownerId,
    courseId: chat.courseId,
    courseMaterials,
    limitReached,
    onInputError: setInputError,
  });
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
  const questions = useMemo(() => questionStates(messages), [messages]);
  const canAnswer = !isBusy && !limitReached;

  /** Sends an answer from a question card as the next message. */
  function sendAnswer(questionId: string, text: string) {
    if (!canAnswer) return;
    setInputError(null);
    clearError();
    void sendMessage({ text, metadata: { questionId } });
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
    void sendMessage({
      parts: [
        ...(text.trim() === "" ? [] : [{ type: "text" as const, text }]),
        ...attached.map((data) => ({ type: "data-material" as const, data })),
      ],
    });
    clearAttached();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4">
      <Conversation className="min-h-0">
        <ConversationContent
          className={cn(
            "mx-auto w-full max-w-3xl px-0",
            messages.length === 0 && "h-full",
          )}
        >
          {messages.length === 0 ? (
            <ConversationEmptyState>
              <div
                aria-hidden
                className="flex size-11 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground"
              >
                <GraduationCapIcon className="size-5" />
              </div>
              <div className="flex flex-col gap-1.5">
                <h2 className="text-xl font-semibold tracking-tight">
                  Ready to study?
                </h2>
                {emptyDescription && (
                  <p className="max-w-md text-sm text-balance text-muted-foreground">
                    {emptyDescription}
                  </p>
                )}
              </div>
            </ConversationEmptyState>
          ) : (
            messages.map((message) => {
              const isLast = message === lastMessage;
              const isStreaming = isBusy && isLast;
              // Until the reply has text, a line says what the AI is doing in
              // its place, in the same box the text then fills.
              const activity =
                isStreaming && message.role === "assistant"
                  ? replyActivity(message.parts)
                  : null;
              return (
                <Message from={message.role} key={message.id}>
                  <MessageContent data-testid="message-text">
                    {message.role === "assistant" ? (
                      <>
                        <ReplyParts
                          parts={message.parts}
                          streaming={status === "streaming" && isLast}
                          inProgress={isStreaming}
                          questions={questions}
                          canAnswer={canAnswer}
                          onAnswer={sendAnswer}
                        />
                        {activity !== null && (
                          <Shimmer className="text-sm">{activity}</Shimmer>
                        )}
                      </>
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
                  <MessageActionRow
                    from={message.role === "user" ? "user" : "assistant"}
                    text={messageText(message.parts)}
                    stopped={message.metadata?.stopped}
                    hidden={isStreaming && message.role === "assistant"}
                    onRegenerate={
                      message.role === "assistant" && isLast && !limitReached
                        ? () => {
                            clearError();
                            void regenerate();
                          }
                        : undefined
                    }
                  >
                    {message.role === "assistant" && (
                      <>
                        <ContextAction
                          context={message.metadata?.tutorContext}
                        />
                        <ReplyFooter metadata={message.metadata} />
                      </>
                    )}
                  </MessageActionRow>
                </Message>
              );
            })
          )}
          {/* Before the reply's message exists: the same box it fills. */}
          {status === "submitted" && lastMessage?.role === "user" && (
            <Message from="assistant">
              <MessageContent>
                <Shimmer className="text-sm">{THINKING}</Shimmer>
              </MessageContent>
              <MessageActionRow from="assistant" text="" hidden />
            </Message>
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
                  onClick={() => void regenerate()}
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
                    onRemove={() => detach(material.materialId)}
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
