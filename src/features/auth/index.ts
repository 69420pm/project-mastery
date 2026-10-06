// Public API of the auth feature for any code, client or server. Server-only
// exports live in `server.ts`.
export { LoginForms } from "./components/login-forms";
export {
  getLoginMessage,
  type LoginMessageCode,
} from "./domain/login-messages";
export {
  signInWithMagicLink,
  signInWithPassword,
  signOut,
  signUp,
} from "./server/actions";
