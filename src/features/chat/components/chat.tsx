"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { FolderOpenIcon, PaperclipIcon, UploadIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { ChatEmptyState } from "@/features/chat/components/chat-empty-state";
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
import { ReplyError } from "@/features/chat/components/reply-error";
import { AttachedMaterials } from "@/features/chat/components/attached-materials";
import { ContextAction } from "@/features/chat/components/context-action";
import { MessageActionRow } from "@/features/chat/components/message-action-row";
import { ReplyFooter } from "@/features/chat/components/reply-footer";
import { ReplyParts } from "@/features/chat/components/reply-parts";
import { chatLabel } from "@/features/chat/domain/chat-label";
import { chatPath, newChatPath } from "@/features/chat/domain/chat-paths";
import { CloseCard, sessionEndedMessage } from "@/features/study";
import { TopicGraph } from "@/features/chat/components/topic-graph";
import { SessionBar } from "@/features/chat/components/session-bar";
import { messageText } from "@/lib/ai/reply";
import { cn } from "@/lib/utils";
import { replyActivity, THINKING } from "@/features/chat/domain/reply-activity";
import {
  questionStates,
  rebuildQuestions,
  sessionStage,
  sessionTopic,
} from "@/features/chat/domain/reply-steps";
import { useChatList } from "@/features/chat/hooks/use-chat-list";
import { useReadings } from "@/features/chat/hooks/use-readings";
import { useMessageAttachments } from "@/features/chat/hooks/use-message-attachments";
import {
  MAX_ATTACHED_MATERIALS,
  MAX_MESSAGE_LENGTH,
  messageTooLongMessage,
} from "@/features/chat/schemas";
import { getChatTitle } from "@/features/chat/server/actions";
import type { ChatUIMessage, ChatWithMessages } from "@/features/chat/types";
import { WithSourcePane } from "@/features/chat/components/source-pane";
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
  /**
   * What the empty state shows under its heading, such as the study
   * feature's Today card, which the page passes in.
   */
  emptyState?: ReactNode;
  /** The Student's Daily limit status when the page loaded. */
  dailyLimit: DailyLimitStatus;
};

/**
 * A Chat with the AI: the messages, streamed replies and the message input.
 * Only the new message is sent; the server loads the stored history.
 */
export function Chat({
  chat,
  isNew,
  materials: courseMaterials,
  ownerId,
  emptyState,
  dailyLimit: initialDailyLimit,
}: ChatProps) {
  const chatId = chat.id;
  const [inputError, setInputError] = useState<string | null>(null);
  const [endedHere, setEndedHere] = useState(false);
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
  // Ended on the server, here with End session, or found idle by the
  // handler, which refuses the message.
  const ended =
    chat.ended || endedHere || error?.message === sessionEndedMessage;
  const lastMessage = messages.at(-1);
  const questions = useMemo(() => questionStates(messages), [messages]);
  const stage = useMemo(() => sessionStage(messages), [messages]);
  const rebuilds = useMemo(() => rebuildQuestions(messages), [messages]);
  const topicId = useMemo(() => sessionTopic(messages), [messages]);
  // At close, or once ended, the close card takes the composer's place.
  const closing = ended || stage === "close";
  const readings = useReadings(messages, chat.messages);
  const canAnswer = !isBusy && !limitReached && !closing;

  /** Sends Done from a reading card or the pane opened from it. */
  function sendDone(readingSectionId: string) {
    if (!canAnswer) return;
    setInputError(null);
    clearError();
    void sendMessage({ text: "Done reading.", metadata: { readingSectionId } });
  }

  /** Sends an answer from a question card as the next message. */
  function sendAnswer(
    questionId: string,
    text: string,
    confidence: number | undefined,
  ) {
    if (!canAnswer) return;
    setInputError(null);
    clearError();
    void sendMessage({
      text,
      metadata: { questionId, ...(confidence && { confidence }) },
    });
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
    <WithSourcePane
      courseId={chat.courseId}
      reading={{ done: readings.done, canDone: canAnswer, onDone: sendDone }}
      topicGraph={(id) => <TopicGraph courseId={chat.courseId} topicId={id} />}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 px-4 pb-4">
        <SessionBar
          chatId={chatId}
          stage={stage}
          // Once the first message is sent, the Chat's session can be ended.
          canEnd={messages.length > 0 && !ended}
          busy={isBusy}
          onEnded={() => {
            setInputError(null);
            setEndedHere(true);
          }}
          onError={setInputError}
        />
        <Conversation className="min-h-0">
          <ConversationContent
            className={cn(
              "mx-auto w-full max-w-3xl px-0",
              messages.length === 0 && "h-full",
            )}
          >
            {messages.length === 0 ? (
              <ChatEmptyState>{emptyState}</ChatEmptyState>
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
                            problemFlags={chat.problemFlags}
                            canAnswer={canAnswer}
                            onAnswer={sendAnswer}
                            doneReadings={readings.done}
                            arrived={readings.arrived(message.id)}
                            onDoneReading={sendDone}
                            rebuilds={rebuilds}
                            topicId={topicId}
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
                        message.role === "assistant" &&
                        isLast &&
                        !limitReached &&
                        !ended
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
            {/* At the limit or once ended, the notice below explains the
              refusal. */}
            {error && !limitReached && !ended && (
              <ReplyError
                message={error.message}
                onRetry={() => void regenerate()}
              />
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {closing ? (
          <CloseCard
            chatId={chatId}
            busy={isBusy}
            newSessionHref={newChatPath(chat.courseId)}
            onRated={() => {
              setInputError(null);
              setEndedHere(true);
            }}
          />
        ) : (
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
                          upload.status === "failed"
                            ? undefined
                            : upload.progress
                        }
                        error={
                          upload.status === "failed"
                            ? upload.message
                            : undefined
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
                    aria-describedby={
                      inputError ? "chat-input-error" : undefined
                    }
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
        )}
      </div>
    </WithSourcePane>
  );
}
