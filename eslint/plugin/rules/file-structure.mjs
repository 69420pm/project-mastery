import { matchesAny, projectPath } from "../paths.mjs";

/** Reports source files outside the allowed project structure. */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require every source file to match the project structure",
    },
    schema: [
      {
        type: "object",
        properties: {
          allowed: { type: "array", items: { type: "string" } },
          docs: { type: "string" },
        },
        required: ["allowed"],
        additionalProperties: false,
      },
    ],
    messages: {
      unknownFile:
        "{{file}} is outside the project structure. Routes in src/app/ contain only Next.js files (page.tsx, layout.tsx, route.ts, ...); feature code goes in src/features/<feature>/{components,hooks,server,ai,workflows,domain}/ or its index.ts, server.ts, schemas.ts, types.ts; shared code in src/components, src/hooks (use-*.ts) or src/lib. {{docs}}",
    },
  },
  create(context) {
    const [{ allowed, docs = "" }] = context.options;
    return {
      Program(node) {
        const file = projectPath(context);
        if (!matchesAny(file, allowed)) {
          context.report({
            node,
            messageId: "unknownFile",
            data: { file, docs },
          });
        }
      },
    };
  },
};

export default rule;
