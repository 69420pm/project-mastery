const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

/**
 * The functions a module exports by declaration, with their exported names:
 * `export async function a() {}`, `export const b = async () => {}` and
 * `export default async function c() {}`.
 */
export function exportedFunctions(program) {
  const found = [];
  for (const node of program.body) {
    if (node.type === "ExportDefaultDeclaration") {
      if (FUNCTION_TYPES.has(node.declaration.type)) {
        found.push({ name: "default", fn: node.declaration });
      }
      continue;
    }
    if (node.type !== "ExportNamedDeclaration" || !node.declaration) continue;
    const { declaration } = node;
    if (declaration.type === "FunctionDeclaration") {
      found.push({ name: declaration.id.name, fn: declaration });
    } else if (declaration.type === "VariableDeclaration") {
      for (const { id, init } of declaration.declarations) {
        if (init && FUNCTION_TYPES.has(init.type) && id.type === "Identifier") {
          found.push({ name: id.name, fn: init });
        }
      }
    }
  }
  return found;
}

/**
 * Every node inside `root` that runs as part of it: nested functions are
 * skipped, since their code runs only when they are called.
 */
export function ownNodes(root, visitorKeys) {
  const nodes = [];
  const visit = (node) => {
    if (!node || typeof node.type !== "string") return;
    nodes.push(node);
    if (node !== root && FUNCTION_TYPES.has(node.type)) return;
    for (const key of visitorKeys[node.type] ?? []) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  visit(root);
  return nodes;
}
