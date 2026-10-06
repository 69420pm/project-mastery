import { hasDirective } from "../paths.mjs";

// Local modules that run only on the server: a feature's server.ts and
// server/ folder, and lib modules such as @/lib/supabase/server.
const SERVER_MODULE = /^(@\/|\.).*(^|\/)server(\/|$)/;
// Server Actions are the one server module Client Components may import.
const SERVER_ACTIONS = /\/server\/actions$/;

/**
 * Reports server-only imports in Client Components while editing, instead of
 * at build time.
 */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow server modules in Client Components" },
    schema: [],
    messages: {
      serverImport:
        '"{{source}}" is server-only and cannot be imported into a Client Component ("use client"). Load the data in a Server Component (page or server component) and pass it down as props, or call a Server Action.',
    },
  },
  create(context) {
    let isClient = false;
    return {
      Program(node) {
        isClient = hasDirective(node, "use client");
      },
      ImportDeclaration(node) {
        const source = node.source.value;
        if (!isClient || node.importKind === "type") return;
        if (
          source === "server-only" ||
          source === "@/lib/supabase/admin" ||
          (SERVER_MODULE.test(source) && !SERVER_ACTIONS.test(source))
        ) {
          context.report({ node, messageId: "serverImport", data: { source } });
        }
      },
    };
  },
};

export default rule;
