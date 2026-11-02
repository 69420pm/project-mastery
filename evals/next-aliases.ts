import { registerHooks } from "node:module";

/**
 * Resolves Next.js modules the way Next.js resolves them for server code, so
 * smoke checks and scripts can import features' `server.ts`, whose modules use them. Next.js
 * aliases `next/navigation` to its react-server variant when bundling; the
 * client variant fails outside Next.js (React has no `createContext` under
 * the `react-server` condition). `smoke.ts` imports this before any check.
 */
const ALIASES: Record<string, string> = {
  // The Chat feature's schemas, which client code shares, import the courses
  // feature's `index.ts`, whose React components cannot load outside Next.js.
  // `server.ts` exports the schemas they need without the components.
  "@/features/courses": "@/features/courses/server",
  "next/navigation": "next/dist/api/navigation.react-server",
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(ALIASES[specifier] ?? specifier, context);
  },
});
