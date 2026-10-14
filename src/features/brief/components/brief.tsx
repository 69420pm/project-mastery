"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { CircleAlertIcon, RotateCcwIcon } from "lucide-react";
import { useState } from "react";
import {
  Conversation,
  ConversationContent,
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
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Markdown } from "@/components/markdown";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { messageText } from "@/features/brief/domain/message-text";
import {
  MAX_BRIEF_MESSAGE_LENGTH,
  briefMessageTooLongMessage,
} from "@/features/brief/schemas";
import type { BriefUIMessage, BriefWithMessages } from "@/features/brief/types";
import {
  DailyLimitNotice,
  refreshDailyLimitStatus,
  type DailyLimitStatus,
} from "@/features/usage";

type BriefProps = {
  /** The stored Brief conversation (`getBrief`). */
  brief: BriefWithMessages;
  /** The Student's Daily limit status when the page loaded. */
  dailyLimit: DailyLimitStatus;
};

/**
 * A Course's Brief: the conversation in which the AI asks about the exam.
 * Only the new message is sent; the server loads the stored history.
 */
export function Brief({ brief, dailyLimit: initialDailyLimit }: BriefProps) {
  const { courseId } = brief;
  const [inputError, setInputError] = useState<string | null>(null);
  const [dailyLimit, setDailyLimit] = useState(initialDailyLimit);
  const limitReached = dailyLimit.level === "reached";
  const { messages, sendMessage, regenerate, status, error, clearError } =
    useChat<BriefUIMessage>({
      onFinish: () => {
        // Every reply, or a refusal at the limit, can change the status.
        refreshDailyLimitStatus().then(setDailyLimit, () => {});
      },
      id: `brief-${courseId}`,
      messages: brief.messages,
      // The database stores message ids as uuids.
      generateId: () => crypto.randomUUID(),
      transport: new DefaultChatTransport({
        api: "/api/brief",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { courseId, message: messages.at(-1) },
        }),
      }),
    });
  const isBusy = status === "submitted" || status === "streaming";
  const lastMessage = messages.at(-1);

  async function handleSubmit({ text }: { text: string }) {
    if (text.trim() === "" || isBusy || limitReached) {
      throw new Error("Nothing to send.");
    }
    if (text.length > MAX_BRIEF_MESSAGE_LENGTH) {
      setInputError(briefMessageTooLongMessage);
      // Rejecting keeps the text in the input.
      throw new Error(briefMessageTooLongMessage);
    }
    setInputError(null);
    clearError();
    void sendMessage({ text });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4">
      <Conversation className="min-h-0">
        <ConversationContent className="mx-auto w-full max-w-3xl px-0">
          {messages.map((message) => (
            <Message from={message.role} key={message.id}>
              <MessageContent data-testid="message-text">
                {message.role === "assistant" ? (
                  <Markdown
                    streaming={
                      status === "streaming" && message === lastMessage
                    }
                  >
                    {messageText(message.parts)}
                  </Markdown>
                ) : (
                  <p className="whitespace-pre-wrap">
                    {messageText(message.parts)}
                  </p>
                )}
              </MessageContent>
            </Message>
          ))}
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
        <DailyLimitNotice status={dailyLimit} />
        {/* Controlled, so a refused message stays in the input. */}
        <PromptInputProvider>
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputBody>
              <PromptInputTextarea
                aria-label="Message"
                aria-invalid={inputError !== null}
                aria-describedby={inputError ? "brief-input-error" : undefined}
                placeholder="Tell the AI about your exam…"
                disabled={limitReached}
                onChange={() => setInputError(null)}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <span />
              <PromptInputSubmit status={status} disabled={limitReached} />
            </PromptInputFooter>
          </PromptInput>
        </PromptInputProvider>
        {inputError && (
          <p
            id="brief-input-error"
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
