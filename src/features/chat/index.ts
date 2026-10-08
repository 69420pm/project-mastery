// Public API of the chat feature for any code, client or server. Server-only
// exports live in `server.ts`.
export { Chat } from "./components/chat";
export { MAX_MESSAGE_LENGTH } from "./schemas";
export type {
  ChatMessageMetadata,
  ChatUIMessage,
  ChatWithMessages,
} from "./types";
