import { exportedFunctions, ownNodes } from "../ast.mjs";
import { hasDirective } from "../paths.mjs";

/**
 * A Server Action receives whatever a client sends, whatever its TypeScript
 * type says, so an action that takes input validates it with a Zod schema
 * through the validation helper (docs/ARCHITECTURE.md, How data moves).
 */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "Server Actions that take input validate it" },
    schema: [
      {
        type: "object",
        properties: { calls: { type: "array", items: { type: "string" } } },
        required: ["calls"],
        additionalProperties: false,
      },
    ],
    messages: {
      missing:
        "Server Action `{{name}}` takes input from the client: validate it with a Zod schema through `{{calls}}(...)` before using it.",
    },
  },
  create(context) {
    const [{ calls }] = context.options;
    const isValidation = (node) =>
      node.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      calls.includes(node.callee.name);

    return {
      Program(program) {
        if (!hasDirective(program, "use server")) return;
        for (const { name, fn } of exportedFunctions(program)) {
          if (fn.params.length === 0) continue;
          const nodes = ownNodes(fn.body, context.sourceCode.visitorKeys);
          if (!nodes.some(isValidation)) {
            context.report({
              node: fn,
              messageId: "missing",
              data: { name, calls: calls.join("` or `") },
            });
          }
        }
      },
    };
  },
};

export default rule;
