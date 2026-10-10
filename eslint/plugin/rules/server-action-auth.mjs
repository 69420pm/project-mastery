import { exportedFunctions, ownNodes } from "../ast.mjs";
import { hasDirective } from "../paths.mjs";

/**
 * Every exported function in a "use server" file is a public HTTP endpoint,
 * so it checks the user before it does anything else: its first `await` is
 * the auth call (docs/ARCHITECTURE.md, How data moves). Actions that run
 * before sign-in, such as the auth forms, are exempt in the config.
 */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "Server Actions check the user first" },
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
        "Server Action `{{name}}` is a public endpoint: make `await {{calls}}()` its first await, before any other work, so no request runs without a signed-in user.",
    },
  },
  create(context) {
    const [{ calls }] = context.options;
    const isAuthCall = (node) =>
      node.argument?.type === "CallExpression" &&
      node.argument.callee.type === "Identifier" &&
      calls.includes(node.argument.callee.name);

    return {
      Program(program) {
        if (!hasDirective(program, "use server")) return;
        for (const { name, fn } of exportedFunctions(program)) {
          const firstAwait = ownNodes(fn.body, context.sourceCode.visitorKeys)
            .filter((node) => node.type === "AwaitExpression")
            .sort((a, b) => a.range[0] - b.range[0])[0];
          if (!firstAwait || !isAuthCall(firstAwait)) {
            context.report({
              node: fn,
              messageId: "missing",
              data: { name, calls: calls.join("()` or `await ") },
            });
          }
        }
      },
    };
  },
};

export default rule;
