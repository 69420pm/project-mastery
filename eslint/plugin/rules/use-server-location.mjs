import { matchesAny, projectPath } from "../paths.mjs";

/**
 * Keeps Server Actions in one place per feature, where they are easy to audit:
 * every exported function there is a public HTTP endpoint. Inline
 * "use server" functions are not allowed, because their closures are sent to
 * the client (encrypted) and they hide endpoints inside components.
 */
const rule = {
  meta: {
    type: "problem",
    docs: { description: 'Allow "use server" only in Server Action files' },
    schema: [
      {
        type: "object",
        properties: { allowed: { type: "array", items: { type: "string" } } },
        required: ["allowed"],
        additionalProperties: false,
      },
    ],
    messages: {
      moduleLevel:
        'Server Actions live in src/features/<feature>/server/actions.ts. Move these functions there instead of adding "use server" to {{file}}.',
      inline:
        'Define Server Actions as exported functions in src/features/<feature>/server/actions.ts instead of inline "use server" functions.',
    },
  },
  create(context) {
    const file = projectPath(context);
    const [{ allowed }] = context.options;
    const isUseServer = (node) =>
      node.type === "ExpressionStatement" && node.directive === "use server";

    function checkFunction(node) {
      if (node.body?.type !== "BlockStatement") return;
      const directive = node.body.body.find(isUseServer);
      if (directive) context.report({ node: directive, messageId: "inline" });
    }

    return {
      Program(node) {
        const directive = node.body.find(isUseServer);
        if (directive && !matchesAny(file, allowed)) {
          context.report({
            node: directive,
            messageId: "moduleLevel",
            data: { file },
          });
        }
      },
      FunctionDeclaration: checkFunction,
      FunctionExpression: checkFunction,
      ArrowFunctionExpression: checkFunction,
    };
  },
};

export default rule;
