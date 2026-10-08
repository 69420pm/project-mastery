import { registerHooks } from "node:module";

/**
 * Resolves Next.js modules the way Next.js resolves them for server code, so
 * evals can import features' `server.ts`, whose modules use them. Next.js
 * aliases `next/navigation` to its react-server variant when bundling; the
 * client variant fails outside Next.js (React has no `createContext` under
 * the `react-server` condition). `run.ts` imports this before any eval.
 */
const ALIASES: Record<string, string> = {
  "next/navigation": "next/dist/api/navigation.react-server",
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(ALIASES[specifier] ?? specifier, context);
  },
});
