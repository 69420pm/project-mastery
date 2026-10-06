import { hasDirective, matchesAny, projectPath } from "../paths.mjs";

/**
 * Requires `import "server-only"` in server code, so importing it into a
 * Client Component fails the build instead of leaking server code (and
 * secrets) to the browser. Server Action files ("use server") are exempt:
 * clients may import them by design.
 */
const rule = {
  meta: {
    type: "problem",
    docs: { description: 'Require `import "server-only"` in server modules' },
    schema: [
      {
        type: "object",
        properties: { files: { type: "array", items: { type: "string" } } },
        required: ["files"],
        additionalProperties: false,
      },
    ],
    messages: {
      missing:
        'Server modules must start with `import "server-only";` so they can never be bundled for the browser.',
    },
  },
  create(context) {
    const file = projectPath(context);
    const [{ files }] = context.options;
    if (!matchesAny(file, files) || /\.test\.tsx?$/.test(file)) return {};
    return {
      Program(node) {
        if (hasDirective(node, "use server")) return;
        const imported = node.body.some(
          (statement) =>
            statement.type === "ImportDeclaration" &&
            statement.source.value === "server-only",
        );
        if (!imported) context.report({ node, messageId: "missing" });
      },
    };
  },
};

export default rule;
