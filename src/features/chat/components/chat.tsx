"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { CircleAlertIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Markdown } from "@/components/markdown";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { chatLabel } from "@/features/chat/domain/chat-label";
import { useChatList } from "@/features/chat/hooks/use-chat-list";
import {
  MAX_MESSAGE_LENGTH,
  messageTooLongMessage,
} from "@/features/chat/schemas";
import type { ChatUIMessage } from "@/features/chat/types";

type ChatProps = {
  chatId: string;
  /** The stored messages, empty for a new Chat. */
  initialMessages: ChatUIMessage[];
  /** True on `/chat`: the first message creates the Chat with `chatId`. */
  isNew: boolean;
};

function messageText(message: ChatUIMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

/**
 * A Chat with the AI: the messages, streamed replies and the message input.
 * Only the new message is sent; the server loads the stored history.
 */
export function Chat({ chatId, initialMessages, isNew }: ChatProps) {
  const [inputError, setInputError] = useState<string | null>(null);
  const { messages, sendMessage, regenerate, status, error, clearError } =
    useChat<ChatUIMessage>({
      id: chatId,
      messages: initialMessages,
      // The database stores message ids as uuids.
      generateId: () => crypto.randomUUID(),
      transport: new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { chatId, newChat: isNew, message: messages.at(-1) },
        }),
      }),
    });

  // Once the reply streams, the message is stored: a new Chat gets its own
  // address without remounting, so reloading or bookmarking it works, and the
  // Chat moves to the top of the sidebar.
  const path = `/chat/${chatId}`;
  const firstMessage = messages[0] ? messageText(messages[0]) : null;
  const { noteChatActivity } = useChatList();
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
    if (text.trim() === "" || isBusy) throw new Error("Nothing to send.");
    if (text.length > MAX_MESSAGE_LENGTH) {
      setInputError(messageTooLongMessage);
      // Rejecting keeps the text in the input.
      throw new Error(messageTooLongMessage);
    }
    setInputError(null);
    clearError();
    void sendMessage({ text });
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
            messages.map((message) => (
              <Message from={message.role} key={message.id}>
                <MessageContent>
                  {message.role === "assistant" ? (
                    <Markdown
                      streaming={
                        status === "streaming" && message === lastMessage
                      }
                    >
                      {messageText(message)}
                    </Markdown>
                  ) : (
                    <p className="whitespace-pre-wrap">
                      {messageText(message)}
                    </p>
                  )}
                </MessageContent>
              </Message>
            ))
          )}
          {status === "submitted" && (
            <Shimmer className="text-sm">Thinking…</Shimmer>
          )}
          {error && (
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

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
        {/* Controlled, so a refused message stays in the input. */}
        <PromptInputProvider>
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputBody>
              <PromptInputTextarea
                aria-label="Message"
                aria-invalid={inputError !== null}
                aria-describedby={inputError ? "chat-input-error" : undefined}
                placeholder="Ask about your studies…"
                onChange={() => setInputError(null)}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools />
              <PromptInputSubmit status={status} disabled={isBusy} />
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
