"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  CheckIcon,
  CircleAlertIcon,
  CopyIcon,
  RefreshCwIcon,
  RotateCcwIcon,
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
  PromptInputBody,
  PromptInputFooter,
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
import { messageText } from "@/features/chat/domain/message-text";
import { useChatList } from "@/features/chat/hooks/use-chat-list";
import {
  MAX_MESSAGE_LENGTH,
  messageTooLongMessage,
} from "@/features/chat/schemas";
import { getChatTitle } from "@/features/chat/server/actions";
import type {
  ChatUIMessage,
  ChatWithMessages,
  ModelOption,
} from "@/features/chat/types";
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
  /** True on `/chat`: the first message creates the Chat with its id. */
  isNew: boolean;
  /** The model choices to offer, in display order. */
  modelOptions: ModelOption[];
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
  dailyLimit: initialDailyLimit,
}: ChatProps) {
  const chatId = chat.id;
  const [inputError, setInputError] = useState<string | null>(null);
  const [modelChoice, setModelChoice] = useState(chat.modelChoice);
  const [dailyLimit, setDailyLimit] = useState(initialDailyLimit);
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
          newChat: isNew,
          message: messages.at(-1),
        },
      }),
    }),
  });
  const selectedOption = modelOptions.find(({ key }) => key === modelChoice);

  // Once the reply streams, the message is stored: a new Chat gets its own
  // address without remounting, so reloading or bookmarking it works, and the
  // Chat moves to the top of the sidebar.
  const path = `/chat/${chatId}`;
  const firstMessage = messages[0] ? messageText(messages[0].parts) : null;
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

  async function handleSubmit({ text }: { text: string }) {
    if (text.trim() === "" || isBusy || limitReached) {
      throw new Error("Nothing to send.");
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      setInputError(messageTooLongMessage);
      // Rejecting keeps the text in the input.
      throw new Error(messageTooLongMessage);
    }
    setInputError(null);
    clearError();
    void sendMessage({ text }, { body: { modelChoice } });
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
                      <p className="whitespace-pre-wrap">
                        {messageText(message.parts)}
                      </p>
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

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
        <DailyLimitNotice status={dailyLimit} />
        {/* Controlled, so a refused message stays in the input. */}
        <PromptInputProvider>
          <PromptInput onSubmit={handleSubmit}>
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
                disabled={!isBusy && limitReached}
              />
            </PromptInputFooter>
          </PromptInput>
        </PromptInputProvider>
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
