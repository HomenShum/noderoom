import * as ts from "typescript";

export type ConvexFunctionKind = "query" | "mutation" | "action";

export type ConvexBoundaryViolation = {
  kind: ConvexFunctionKind;
  constructorName: string;
  functionName?: string;
  index: number;
  message: string;
};

const constructors: Record<string, ConvexFunctionKind> = {
  query: "query",
  internalQuery: "query",
  mutation: "mutation",
  internalMutation: "mutation",
  action: "action",
  internalAction: "action",
};

const domainReceiptTables = new Set([
  "artifacts",
  "elements",
  "notebooks",
  "nodes",
  "relations",
  "relationTypes",
  "wikiPages",
  "wikiRevisions",
]);

const externalCallNames = new Set(["fetch", "generateText", "generateObject", "streamText", "streamObject", "embed", "embedMany"]);

export function scanConvexBoundarySource(source: string): ConvexBoundaryViolation[] {
  const sourceFile = ts.createSourceFile("convex-function.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const localFunctions = collectLocalFunctions(sourceFile);
  const externalImports = collectExternalImports(sourceFile);
  return findConvexFunctions(sourceFile, localFunctions).flatMap((fn) => {
    const reachableBodies = reachableFunctionBodies(fn.handler, localFunctions);
    const violations: ConvexBoundaryViolation[] = [];
    const violation = (message: string): ConvexBoundaryViolation => ({
      kind: fn.kind,
      constructorName: fn.constructorName,
      functionName: fn.functionName,
      index: fn.index,
      message,
    });

    if (fn.kind === "query" && reachableBodies.some((body) => hasCtxDbWrite(body) || hasConsoleCall(body))) {
      violations.push(violation("queries must be read-only; move writes/logging to a mutation"));
    }
    if (fn.kind === "action" && reachableBodies.some(hasCtxDbAccess)) {
      violations.push(violation("actions should persist by calling runMutation/runQuery, not ctx.db directly"));
    }
    if (fn.kind === "mutation" && reachableBodies.some((body) => hasExternalWorkCall(body, externalImports))) {
      violations.push(violation("mutations should not call external networks; move provider work to an action"));
    }
    if (fn.kind === "mutation" && hasJobIdArg(fn.wrapper) && writesDomainTables(reachableBodies) && !writesMutationReceipt(reachableBodies)) {
      violations.push(violation("agent domain mutations with jobId must write an agentMutationReceipts row"));
    }
    return violations;
  });
}

type LocalFunctionMap = Map<string, ts.Node>;

type ExternalImports = {
  names: Set<string>;
  namespaces: Set<string>;
};

type ConvexFunction = {
  kind: ConvexFunctionKind;
  constructorName: string;
  functionName?: string;
  index: number;
  wrapper: ts.ObjectLiteralExpression;
  handler: ts.Node;
};

function findConvexFunctions(sourceFile: ts.SourceFile, localFunctions: LocalFunctionMap): ConvexFunction[] {
  const functions: ConvexFunction[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node) && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue;
        const call = declaration.initializer;
        if (!ts.isIdentifier(call.expression)) continue;
        const kind = constructors[call.expression.text];
        const wrapper = call.arguments[0];
        if (!kind || !wrapper || !ts.isObjectLiteralExpression(wrapper)) continue;
        const handler = findObjectProperty(wrapper, "handler");
        if (!handler) continue;
        functions.push({
          kind,
          constructorName: call.expression.text,
          functionName: declaration.name.text,
          index: call.getStart(sourceFile),
          wrapper,
          handler: ts.isIdentifier(handler) ? localFunctions.get(handler.text) ?? handler : handler,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return functions.sort((left, right) => left.index - right.index);
}

function collectLocalFunctions(sourceFile: ts.SourceFile): LocalFunctionMap {
  const functions: LocalFunctionMap = new Map();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      functions.set(statement.name.text, statement.body);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) {
          functions.set(declaration.name.text, declaration.initializer.body);
        }
      }
    }
  }
  return functions;
}

function collectExternalImports(sourceFile: ts.SourceFile): ExternalImports {
  const names = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!isExternalProviderModule(statement.moduleSpecifier.text)) continue;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) names.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    } else {
      for (const item of bindings.elements) names.add((item.propertyName ?? item.name).text);
    }
  }
  return { names, namespaces };
}

function reachableFunctionBodies(handler: ts.Node, localFunctions: LocalFunctionMap): ts.Node[] {
  const bodies: ts.Node[] = [];
  const seen = new Set<ts.Node>();
  const visitBody = (node: ts.Node) => {
    if (seen.has(node)) return;
    seen.add(node);
    bodies.push(node);
    const helperNames = new Set<string>();
    walk(node, (child) => {
      if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) helperNames.add(child.expression.text);
    });
    for (const helperName of helperNames) {
      const helper = localFunctions.get(helperName);
      if (helper) visitBody(helper);
    }
  };

  if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
    visitBody(handler.body);
  } else {
    visitBody(handler);
  }
  return bodies;
}

function hasCtxDbWrite(node: ts.Node): boolean {
  let found = false;
  walk(node, (child) => {
    if (found || !ts.isCallExpression(child) || !ts.isPropertyAccessExpression(child.expression)) return;
    if (!["insert", "patch", "replace", "delete"].includes(child.expression.name.text)) return;
    if (isCtxDbExpression(child.expression.expression)) found = true;
  });
  return found;
}

function hasCtxDbAccess(node: ts.Node): boolean {
  let found = false;
  walk(node, (child) => {
    if (!found && ts.isPropertyAccessExpression(child) && isCtxDbProperty(child)) found = true;
  });
  return found;
}

function hasConsoleCall(node: ts.Node): boolean {
  let found = false;
  walk(node, (child) => {
    if (found || !ts.isCallExpression(child) || !ts.isPropertyAccessExpression(child.expression)) return;
    if (ts.isIdentifier(child.expression.expression) && child.expression.expression.text === "console") found = true;
  });
  return found;
}

function hasExternalWorkCall(node: ts.Node, externalImports: ExternalImports): boolean {
  let found = false;
  walk(node, (child) => {
    if (found || !ts.isCallExpression(child)) return;
    const expression = child.expression;
    if (ts.isIdentifier(expression)) {
      found = externalCallNames.has(expression.text) || externalImports.names.has(expression.text);
    } else if (ts.isPropertyAccessExpression(expression)) {
      found =
        externalCallNames.has(expression.name.text) ||
        rootIdentifierIs(expression, externalImports.names) ||
        rootIdentifierIs(expression, externalImports.namespaces);
    }
  });
  return found;
}

function writesDomainTables(nodes: ts.Node[]): boolean {
  return nodes.some((node) => dbWriteTables(node).some((table) => domainReceiptTables.has(table)));
}

function writesMutationReceipt(nodes: ts.Node[]): boolean {
  let found = false;
  for (const node of nodes) {
    walk(node, (child) => {
      if (found) return;
      if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === "insertReceipt") {
        found = true;
      }
      if (!ts.isCallExpression(child) || !ts.isPropertyAccessExpression(child.expression)) return;
      if (child.expression.name.text !== "insert" || !isCtxDbExpression(child.expression.expression)) return;
      const [tableArg] = child.arguments;
      if (ts.isStringLiteral(tableArg) && tableArg.text === "agentMutationReceipts") found = true;
    });
  }
  return found;
}

function dbWriteTables(node: ts.Node): string[] {
  const tables: string[] = [];
  walk(node, (child) => {
    if (!ts.isCallExpression(child) || !ts.isPropertyAccessExpression(child.expression)) return;
    if (!["insert", "patch", "replace", "delete"].includes(child.expression.name.text)) return;
    if (!isCtxDbExpression(child.expression.expression)) return;
    const [tableArg] = child.arguments;
    if (ts.isStringLiteral(tableArg)) tables.push(tableArg.text);
  });
  return tables;
}

function hasJobIdArg(wrapper: ts.ObjectLiteralExpression): boolean {
  const args = findObjectProperty(wrapper, "args");
  return !!args && /\bjobId\b/.test(args.getText());
}

function findObjectProperty(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = property.name;
    const keyName = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : undefined;
    if (keyName === name) return property.initializer;
  }
  return undefined;
}

function isCtxDbExpression(node: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(node) && isCtxDbProperty(node);
}

function isCtxDbProperty(node: ts.PropertyAccessExpression): boolean {
  return ts.isIdentifier(node.expression) && node.expression.text === "ctx" && node.name.text === "db";
}

function rootIdentifierIs(node: ts.PropertyAccessExpression, identifiers: Set<string>): boolean {
  let current: ts.Expression = node.expression;
  while (ts.isPropertyAccessExpression(current)) current = current.expression;
  return ts.isIdentifier(current) && identifiers.has(current.text);
}

function isExternalProviderModule(moduleName: string): boolean {
  return /^@ai-sdk\//.test(moduleName) || moduleName === "ai" || moduleName === "undici" || /openai|anthropic/i.test(moduleName);
}

function walk(node: ts.Node, visitor: (node: ts.Node) => void): void {
  visitor(node);
  ts.forEachChild(node, (child) => walk(child, visitor));
}
