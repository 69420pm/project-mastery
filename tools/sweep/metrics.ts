/**
 * Size and coupling per unit, read with the TypeScript compiler API: lines of
 * code, public exports and how many of them other units import, and fan-in
 * and fan-out between units.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { isExcluded, listFiles, unitOf, type Unit } from "./units";

export type UnitMetrics = {
  unit: string;
  files: number;
  loc: number;
  /** Exports of a feature's index.ts and server.ts, or of every file elsewhere. */
  publicExports: number;
  /** Public exports that code in another unit imports. */
  usedOutside: number;
  /** Units that import this one. */
  fanIn: string[];
  /** Units this one imports. */
  fanOut: string[];
};

export type FileMetrics = { file: string; unit: string; loc: number };

export type Metrics = { units: UnitMetrics[]; files: FileMetrics[] };

type ParsedFile = {
  loc: number;
  exports: string[];
  /** Repo-relative target file and the names imported from it, "*" for all. */
  imports: { target: string; names: string[] }[];
};

export function computeMetrics(root: string, units: Unit[]): Metrics {
  const options = compilerOptions(root);
  const parsed = new Map<string, ParsedFile>();
  for (const unit of units) {
    for (const file of unit.paths.flatMap((p) => listFiles(root, p))) {
      if (!isExcluded(file)) parsed.set(file, parseFile(root, file, options));
    }
  }

  const fanIn = new Map(units.map((u) => [u.name, new Set<string>()]));
  const fanOut = new Map(units.map((u) => [u.name, new Set<string>()]));
  /** "file#name" of exports imported from another unit; "file#*" for all. */
  const usedOutside = new Set<string>();
  for (const [file, { imports }] of parsed) {
    const from = unitOf(units, file)!.name;
    for (const { target, names } of imports) {
      const to = unitOf(units, target)?.name;
      if (!to || to === from) continue;
      fanOut.get(from)!.add(to);
      fanIn.get(to)!.add(from);
      for (const name of names) usedOutside.add(`${target}#${name}`);
    }
  }

  const files: FileMetrics[] = [];
  const result: UnitMetrics[] = units.map((unit) => {
    const own = [...parsed].filter(([file]) => unitOf(units, file) === unit);
    let publicExports = 0;
    let used = 0;
    for (const [file, { exports }] of own) {
      files.push({ file, unit: unit.name, loc: parsed.get(file)!.loc });
      if (!isPublic(file)) continue;
      publicExports += exports.length;
      used += exports.filter(
        (name) =>
          usedOutside.has(`${file}#${name}`) || usedOutside.has(`${file}#*`),
      ).length;
    }
    return {
      unit: unit.name,
      files: own.length,
      loc: own.reduce((sum, [, f]) => sum + f.loc, 0),
      publicExports,
      usedOutside: used,
      fanIn: [...fanIn.get(unit.name)!].sort(),
      fanOut: [...fanOut.get(unit.name)!].sort(),
    };
  });
  return { units: result, files };
}

/** A feature's public API is its entry files; elsewhere every file is. */
function isPublic(file: string): boolean {
  const feature = /^src\/features\/[^/]+\/(.+)$/.exec(file);
  return !feature || /^(index|server)\.ts$/.test(feature[1]!);
}

export function formatMetrics({ units, files }: Metrics): string {
  const rows = units.map(
    (u) =>
      `| ${u.unit} | ${u.files} | ${u.loc} | ${u.publicExports} | ${u.usedOutside} | ${u.fanIn.length} | ${u.fanOut.length} |`,
  );
  const deps = units.map(
    (u) =>
      `- ${u.unit}: imports ${u.fanOut.join(", ") || "none"}; imported by ${u.fanIn.join(", ") || "none"}`,
  );
  const byFile = [...files]
    .sort((a, b) => a.unit.localeCompare(b.unit) || b.loc - a.loc)
    .map((f) => `| ${f.unit} | ${f.file} | ${f.loc} |`);
  return [
    "# Metrics",
    "",
    "Lines of code exclude blank and comment lines. Public exports are a feature's index.ts and server.ts exports, and every export elsewhere. The app unit holds src/app and the root files; tools holds tools, evals, e2e and eslint.",
    "",
    "| Unit | Files | LOC | Public exports | Used outside | Fan-in | Fan-out |",
    "| --- | --: | --: | --: | --: | --: | --: |",
    ...rows,
    "",
    "## Dependencies",
    "",
    ...deps,
    "",
    "## Files",
    "",
    "| Unit | File | LOC |",
    "| --- | --- | --: |",
    ...byFile,
    "",
  ].join("\n");
}

function compilerOptions(root: string): ts.CompilerOptions {
  const configPath = path.join(root, "tsconfig.json");
  if (!existsSync(configPath)) return {};
  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  return ts.parseJsonConfigFileContent(config, ts.sys, root).options;
}

function parseFile(
  root: string,
  file: string,
  options: ts.CompilerOptions,
): ParsedFile {
  const text = readFileSync(path.join(root, file), "utf8");
  if (file.endsWith(".sql")) {
    const loc = text
      .split("\n")
      .filter((line) => line.trim() && !line.trim().startsWith("--")).length;
    return { loc, exports: [], imports: [] };
  }
  const tsx = file.endsWith(".tsx");
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const exports: string[] = [];
  const imports: ParsedFile["imports"] = [];
  const addImport = (specifier: string, names: string[]) => {
    const resolved = ts.resolveModuleName(
      specifier,
      path.join(root, file),
      options,
      ts.sys,
    ).resolvedModule;
    if (!resolved || resolved.isExternalLibraryImport) return;
    const target = path.relative(root, resolved.resolvedFileName);
    if (!target.startsWith("..")) imports.push({ target, names });
  };

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const names: string[] = [];
      if (clause?.name) names.push("default");
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) names.push("*");
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          names.push((el.propertyName ?? el.name).getText(source));
        }
      }
      addImport(moduleText(statement.moduleSpecifier), names);
    } else if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      const named = clause && ts.isNamedExports(clause) ? clause.elements : [];
      exports.push(...named.map((el) => el.name.getText(source)));
      if (clause && ts.isNamespaceExport(clause)) {
        exports.push(clause.name.getText(source));
      }
      if (statement.moduleSpecifier) {
        addImport(
          moduleText(statement.moduleSpecifier),
          clause && ts.isNamedExports(clause)
            ? named.map((el) => (el.propertyName ?? el.name).getText(source))
            : ["*"],
        );
      }
    } else if (ts.isExportAssignment(statement)) {
      exports.push("default");
    } else if (
      ts.canHaveModifiers(statement) &&
      ts
        .getModifiers(statement)
        ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      exports.push(...declaredNames(statement, source));
    }
  }
  source.forEachChild(function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      addImport(node.arguments[0].text, ["*"]);
    }
    node.forEachChild(visit);
  });

  return { loc: linesOfCode(text, tsx), exports, imports };
}

function moduleText(specifier: ts.Expression): string {
  return ts.isStringLiteral(specifier) ? specifier.text : "";
}

function declaredNames(statement: ts.Statement, source: ts.SourceFile) {
  const isDefault = ts
    .getModifiers(statement as ts.HasModifiers)
    ?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
  if (isDefault) return ["default"];
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.map((d) =>
      d.name.getText(source),
    );
  }
  const name = (statement as { name?: ts.Node }).name;
  return name ? [name.getText(source)] : [];
}

/** Lines that hold at least one token: neither blank nor only comments. */
function linesOfCode(text: string, tsx: boolean): number {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    tsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    text,
  );
  const starts = [0];
  for (let i = 0; i < text.length; i++)
    if (text[i] === "\n") starts.push(i + 1);
  const lineOf = (pos: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const lines = new Set<number>();
  // One entry per open brace: true when it is a template's `${`, whose `}`
  // the scanner must rescan as the rest of the template.
  const braces: boolean[] = [];
  for (
    let token = scanner.scan();
    token !== ts.SyntaxKind.EndOfFileToken;
    token = scanner.scan()
  ) {
    if (token === ts.SyntaxKind.CloseBraceToken && braces.pop()) {
      token = scanner.reScanTemplateToken(false);
    }
    if (
      token === ts.SyntaxKind.TemplateHead ||
      token === ts.SyntaxKind.TemplateMiddle
    ) {
      braces.push(true);
    } else if (token === ts.SyntaxKind.OpenBraceToken) {
      braces.push(false);
    }
    const last = lineOf(Math.max(scanner.getTokenEnd() - 1, 0));
    for (let line = lineOf(scanner.getTokenStart()); line <= last; line++) {
      lines.add(line);
    }
  }
  return lines.size;
}
