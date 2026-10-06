import path from "node:path";

/** The linted file's path relative to the project root, with `/` separators. */
export function projectPath(context) {
  return path.relative(context.cwd, context.filename).split(path.sep).join("/");
}

/** Whether a project-relative path matches any of the glob patterns. */
export function matchesAny(file, patterns) {
  return patterns.some((pattern) => path.matchesGlob(file, pattern));
}

/** Whether the module starts with the given directive, e.g. "use client". */
export function hasDirective(program, directive) {
  return program.body.some(
    (node) =>
      node.type === "ExpressionStatement" && node.directive === directive,
  );
}
