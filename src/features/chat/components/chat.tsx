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
import {
  DEFAULT_MODEL_CHOICE,
  MAX_MESSAGE_LENGTH,
  messageTooLongMessage,
} from "@/features/chat/schemas";
import type { ChatUIMessage, ModelOption } from "@/features/chat/types";

type ChatProps = {
  chatId: string;
  /** The stored messages, empty for a new Chat. */
  initialMessages: ChatUIMessage[];
  /** True on `/chat`: the first message creates the Chat with `chatId`. */
  isNew: boolean;
  /** The model choices to offer, in display order. */
  modelOptions: ModelOption[];
  /** The Chat's last model choice; a new Chat starts on the default. */
  initialModelChoice?: string;
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
export function Chat({
  chatId,
  initialMessages,
  isNew,
  modelOptions,
  initialModelChoice = DEFAULT_MODEL_CHOICE,
}: ChatProps) {
  const [inputError, setInputError] = useState<string | null>(null);
  // A stored choice that is no longer offered shows the default, as the
  // server then answers with it.
  const [modelChoice, setModelChoice] = useState(() =>
    modelOptions.some(({ key }) => key === initialModelChoice)
      ? initialModelChoice
      : DEFAULT_MODEL_CHOICE,
  );
  const { messages, sendMessage, regenerate, status, error, clearError } =
    useChat<ChatUIMessage>({
      id: chatId,
      messages: initialMessages,
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

  // Once the reply streams, the Chat exists: give it its own address without
  // remounting, so reloading or bookmarking it works.
  const path = `/chat/${chatId}`;
  useEffect(() => {
    if (isNew && status === "streaming" && window.location.pathname !== path) {
      window.history.replaceState(null, "", path);
    }
  }, [isNew, status, path]);

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
    void sendMessage({ text }, { body: { modelChoice } });
  }

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] min-h-80 flex-col gap-4">
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
