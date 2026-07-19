import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function slash(value) {
  return value.replaceAll("\\", "/");
}

export function walkFiles(root, extensions = new Set([".ts", ".tsx", ".js", ".mjs"])) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "coverage") continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(absolute, extensions));
    else if (extensions.has(path.extname(entry.name))) files.push(absolute);
  }
  return files.sort();
}

export function sourceFile(file) {
  const text = fs.readFileSync(file, "utf8");
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

export function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

export function unwrap(node) {
  let current = node;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isSatisfiesExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

export function property(object, name) {
  if (!object || !ts.isObjectLiteralExpression(unwrap(object))) return undefined;
  return unwrap(object).properties.find(
    (item) =>
      ts.isPropertyAssignment(item) &&
      ((ts.isIdentifier(item.name) && item.name.text === name) ||
        (ts.isStringLiteralLike(item.name) && item.name.text === name))
  )?.initializer;
}

export function constMap(files) {
  const values = new Map();
  for (const file of files) {
    const source = sourceFile(file);
    visit(source, (node) => {
      if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return;
      const list = node.parent;
      if (!ts.isVariableDeclarationList(list) || !(list.flags & ts.NodeFlags.Const)) return;
      const previous = values.get(node.name.text);
      if (!previous) values.set(node.name.text, node.initializer);
      else values.set(node.name.text, null);
    });
  }
  return values;
}

export function staticText(node, constants = new Map(), seen = new Set()) {
  const value = unwrap(node);
  if (!value) return null;
  if (ts.isStringLiteralLike(value) || ts.isNumericLiteral(value)) return value.text;
  if (ts.isIdentifier(value)) {
    if (seen.has(value.text)) return null;
    const resolved = constants.get(value.text);
    if (!resolved) return null;
    return staticText(resolved, constants, new Set([...seen, value.text]));
  }
  if (ts.isTemplateExpression(value)) {
    return (
      value.head.text +
      value.templateSpans
        .map((span) => {
          const resolved = staticText(span.expression, constants, seen);
          const querySuffix =
            !resolved &&
            ts.isIdentifier(span.expression) &&
            /^(?:q|qs|query|queryString|search)$/.test(span.expression.text);
          return `${querySuffix ? "" : (resolved ?? ":param")}${span.literal.text}`;
        })
        .join("")
    );
  }
  if (ts.isConditionalExpression(value)) {
    const whenTrue = staticText(value.whenTrue, constants, seen);
    const whenFalse = staticText(value.whenFalse, constants, seen);
    if (whenTrue && whenFalse && normalizePath(whenTrue) === normalizePath(whenFalse)) return whenTrue;
  }
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticText(value.left, constants, seen);
    const right = staticText(value.right, constants, seen);
    return left == null || right == null ? null : left + right;
  }
  return null;
}

export function staticArray(node, constants, seen = new Set()) {
  const value = unwrap(node);
  if (!value) return [];
  if (ts.isIdentifier(value)) {
    if (seen.has(value.text)) return [];
    const resolved = constants.get(value.text);
    return resolved ? staticArray(resolved, constants, new Set([...seen, value.text])) : [];
  }
  if (ts.isPropertyAccessExpression(value)) {
    const base = unwrap(value.expression);
    if (!ts.isIdentifier(base)) return [];
    const resolved = constants.get(base.text);
    return resolved ? staticArray(property(resolved, value.name.text), constants, seen) : [];
  }
  if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression)) {
    return staticArray(value.expression.expression, constants, seen);
  }
  if (!ts.isArrayLiteralExpression(value)) return [];
  const result = [];
  for (const item of value.elements) {
    if (ts.isSpreadElement(item)) result.push(...staticArray(item.expression, constants, seen));
    else result.push(unwrap(item));
  }
  return result;
}

export function lineOf(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

export function normalizePath(value) {
  const withoutQuery = value.split(/[?#]/, 1)[0] || "/";
  const normalized = withoutQuery
    .replace(/:param/g, ":")
    .replace(/:[A-Za-z_$][\w$]*/g, ":")
    .replace(/\/+/g, "/");
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

export function routeMatches(routePath, callerPath) {
  const route = normalizePath(routePath).split("/");
  const caller = normalizePath(callerPath).split("/");
  if (route.length !== caller.length) return false;
  return route.every((segment, index) => segment === ":" || segment === "*" || segment === caller[index]);
}

export function patternMatches(pattern, routePath) {
  const expected = normalizePath(pattern).split("/");
  const actual = normalizePath(routePath).split("/");
  if (expected.length !== actual.length) return false;
  return expected.every(
    (segment, index) => segment === ":" || segment === actual[index]
  );
}

export function protocolPatternError(pattern) {
  if (typeof pattern !== "string" || !pattern.startsWith("/")) {
    return "pathPattern must be an absolute path";
  }
  if (/[?#]/.test(pattern)) return "pathPattern must not contain a query or fragment";
  if (/[*()[\]{}|+^$\\]/.test(pattern)) {
    return "pathPattern must use literal segments or ':' placeholders only";
  }
  if (pattern.includes("::") || pattern.split("/").some((segment) => segment.includes(":") && segment !== ":")) {
    return "dynamic path segments must be exactly ':'";
  }
  return null;
}

export function validateProtocolExceptions(exceptions, routes) {
  const errors = [];
  const ids = new Set();
  for (const exception of exceptions) {
    if (
      !exception.id ||
      !exception.methods?.length ||
      !exception.rationale ||
      !["none", "kernel-delegated"].includes(exception.delegated)
    ) {
      errors.push(`Malformed protocol exception ${exception.id ?? "<missing id>"}`);
      continue;
    }
    if (ids.has(exception.id)) {
      errors.push(`Duplicate protocol exception id ${exception.id}`);
    }
    ids.add(exception.id);
    const patternError = protocolPatternError(exception.pathPattern);
    if (patternError) {
      errors.push(`Malformed protocol exception ${exception.id}: ${patternError}`);
      continue;
    }
    if (
      exception.methods.some(
        (method) =>
          typeof method !== "string" ||
          method !== method.toUpperCase() ||
          !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)
      )
    ) {
      errors.push(`Malformed protocol exception ${exception.id}: invalid method`);
      continue;
    }
    const matches = routes.filter(
      (route) =>
        exception.methods.includes(route.method) &&
        patternMatches(exception.pathPattern, route.fullPath)
    );
    if (!matches.length) {
      errors.push(`Stale protocol exception ${exception.id}: matches no route`);
    }
  }
  return errors;
}

function nearestFunctionName(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (
      (ts.isFunctionDeclaration(current) ||
        ts.isFunctionExpression(current) ||
        ts.isArrowFunction(current)) &&
      current.name &&
      ts.isIdentifier(current.name)
    ) {
      return current.name.text;
    }
    if (
      (ts.isFunctionExpression(current) || ts.isArrowFunction(current)) &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      return current.parent.name.text;
    }
  }
  return null;
}

function resolveFactory(expression, variables, seen = new Set()) {
  const value = unwrap(expression);
  if (ts.isCallExpression(value)) return resolveFactory(value.expression, variables, seen);
  if (!ts.isIdentifier(value)) return null;
  if (seen.has(value.text)) return null;
  const initializer = variables.get(value.text);
  return initializer
    ? resolveFactory(initializer, variables, new Set([...seen, value.text]))
    : value.text;
}

export function discoverMounts(repoRoot) {
  const file = path.join(repoRoot, "apps", "bridge", "src", "bootstrap.ts");
  const source = sourceFile(file);
  const imports = new Map();
  const variables = new Map();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause?.namedBindings;
      if (clause && ts.isNamedImports(clause)) {
        for (const item of clause.elements) {
          imports.set(item.name.text, {
            imported: item.propertyName?.text ?? item.name.text,
            module: statement.moduleSpecifier.text,
          });
        }
      }
    }
  }
  visit(source, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      variables.set(node.name.text, node.initializer);
    }
  });

  const mounts = new Map();
  visit(source, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      node.expression.name.text !== "use"
    ) return;
    const prefix = staticText(node.arguments[0]);
    if (!prefix?.startsWith("/")) return;
    for (const argument of node.arguments.slice(1)) {
      const localFactory = resolveFactory(argument, variables);
      const imported = localFactory ? imports.get(localFactory) : null;
      if (!imported || !imported.module.startsWith(".")) continue;
      const absolute = path.resolve(path.dirname(file), imported.module.replace(/\.js$/, ".ts"));
      const key = `${slash(path.relative(repoRoot, absolute))}#${imported.imported}`;
      mounts.set(key, prefix);
    }
  });

  const edges = [];
  for (const routeFile of [...new Set(routeRoots(repoRoot))].filter(fs.existsSync)) {
    const routeSource = sourceFile(routeFile);
    const relative = slash(path.relative(repoRoot, routeFile));
    const routeImports = new Map();
    const routeVariables = new Map();
    for (const statement of routeSource.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const item of bindings.elements) {
        routeImports.set(item.name.text, {
          imported: item.propertyName?.text ?? item.name.text,
          module: statement.moduleSpecifier.text,
        });
      }
    }
    visit(routeSource, (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        routeVariables.set(node.name.text, node.initializer);
      }
      if (
        !ts.isCallExpression(node) ||
        !ts.isPropertyAccessExpression(node.expression) ||
        node.expression.name.text !== "use"
      ) return;
      const subpath = staticText(node.arguments[0]);
      if (!subpath?.startsWith("/")) return;
      const childLocal = resolveFactory(node.arguments[node.arguments.length - 1], routeVariables);
      if (!childLocal) return;
      const imported = routeImports.get(childLocal);
      const childFile =
        imported?.module.startsWith(".")
          ? slash(
              path.relative(
                repoRoot,
                path.resolve(path.dirname(routeFile), imported.module.replace(/\.js$/, ".ts"))
              )
            )
          : relative;
      edges.push({
        parent: `${relative}#${nearestFunctionName(node)}`,
        child: `${childFile}#${imported?.imported ?? childLocal}`,
        subpath,
      });
    });
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      const parentPrefix = mounts.get(edge.parent);
      if (!parentPrefix || mounts.has(edge.child)) continue;
      mounts.set(edge.child, normalizePath(`${parentPrefix}/${edge.subpath}`));
      changed = true;
    }
  }
  return mounts;
}

function routeRoots(repoRoot) {
  return [
    ...walkFiles(path.join(repoRoot, "apps", "bridge", "src", "routes"), new Set([".ts"])),
    path.join(repoRoot, "apps", "bridge", "src", "kernel", "routes.ts"),
    ...walkFiles(path.join(repoRoot, "apps", "bridge", "src", "plugins"), new Set([".ts"])),
  ];
}

const KERNEL_CALLS = new Set([
  "createRecord",
  "updateRecord",
  "deleteRecord",
  "executeCollectionAction",
  "executeRecordAction",
]);

function kernelCallsIn(node, constants) {
  const calls = [];
  visit(node, (candidate) => {
    if (!ts.isCallExpression(candidate) || !ts.isIdentifier(candidate.expression)) return;
    const operation = candidate.expression.text;
    if (!KERNEL_CALLS.has(operation)) return;
    const target = staticText(candidate.arguments[1], constants);
    const action =
      operation === "executeRecordAction"
        ? staticText(candidate.arguments[3], constants)
        : operation === "executeCollectionAction"
          ? staticText(candidate.arguments[2], constants)
          : null;
    calls.push({ operation, target, action });
  });
  return calls;
}

export function discoverMutationRoutes(repoRoot) {
  const mounts = discoverMounts(repoRoot);
  const routes = [];
  const allRoutes = [];
  const errors = [];
  for (const file of [...new Set(routeRoots(repoRoot))].filter(fs.existsSync)) {
    const source = sourceFile(file);
    const relative = slash(path.relative(repoRoot, file));
    const constants = constMap([file]);
    const routerNames = new Set();
    visit(source, (node) => {
      if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return;
      const initializer = unwrap(node.initializer);
      if (
        ts.isCallExpression(initializer) &&
        ((ts.isIdentifier(initializer.expression) && initializer.expression.text === "Router") ||
          (ts.isPropertyAccessExpression(initializer.expression) &&
            initializer.expression.name.text === "Router"))
      ) {
        routerNames.add(node.name.text);
      }
    });
    visit(source, (node) => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
      if (!ts.isIdentifier(node.expression.expression) || !routerNames.has(node.expression.expression.text)) return;
      const method = node.expression.name.text.toUpperCase();
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) return;
      const routePath = staticText(node.arguments[0], constants);
      if (!routePath?.startsWith("/")) {
        if (MUTATION_METHODS.has(method)) {
          errors.push(`${relative}:${lineOf(source, node)} mutation route must use a static path`);
        }
        return;
      }
      const factory = nearestFunctionName(node);
      const prefix = mounts.get(`${relative}#${factory}`) ?? (relative.endsWith("/kernel/routes.ts") ? "/api" : null);
      if (!prefix && relative.includes("/routes/") && MUTATION_METHODS.has(method)) {
        errors.push(`${relative}:${lineOf(source, node)} router factory ${factory ?? "<unknown>"} is not mounted in bootstrap.ts`);
      }
      const fullPath = normalizePath(`${prefix ?? ""}/${routePath}`);
      allRoutes.push({
        file: relative,
        line: lineOf(source, node),
        factory,
        method,
        localPath: routePath,
        fullPath,
      });
      if (!MUTATION_METHODS.has(method)) return;
      const handler = node.arguments[node.arguments.length - 1];
      routes.push({
        file: relative,
        line: lineOf(source, node),
        factory,
        method,
        localPath: routePath,
        fullPath,
        kernelCalls: handler ? kernelCallsIn(handler, constants) : [],
      });
    });
  }
  const bootstrap = path.join(repoRoot, "apps", "bridge", "src", "bootstrap.ts");
  if (fs.existsSync(bootstrap)) {
    const source = sourceFile(bootstrap);
    const constants = constMap([bootstrap]);
    visit(source, (node) => {
      if (
        !ts.isNewExpression(node) ||
        !ts.isIdentifier(node.expression) ||
        node.expression.text !== "WebSocketServer"
      ) return;
      const options = node.arguments?.[0];
      const wsPath = staticText(property(options, "path"), constants);
      if (wsPath?.startsWith("/")) {
        allRoutes.push({
          file: slash(path.relative(repoRoot, bootstrap)),
          line: lineOf(source, node),
          factory: null,
          method: "GET",
          localPath: wsPath,
          fullPath: normalizePath(wsPath),
        });
      }
    });
  }
  return { routes, allRoutes, errors };
}

export function discoverProtocolExceptions(repoRoot) {
  const file = path.join(repoRoot, "apps", "bridge", "src", "kernel", "protocol-exceptions.ts");
  const source = sourceFile(file);
  const constants = constMap([file]);
  const declaration = constants.get("PROTOCOL_EXCEPTIONS");
  return staticArray(declaration, constants).map((entry) => ({
    id: staticText(property(entry, "id"), constants),
    methods: staticArray(property(entry, "methods"), constants)
      .map((item) => staticText(item, constants))
      .filter(Boolean),
    pathPattern: staticText(property(entry, "pathPattern"), constants),
    rationale: staticText(property(entry, "rationale"), constants),
    delegated: staticText(property(entry, "authenticatedDomainMutations"), constants),
  }));
}

function resolvedNode(node, constants, bindings = new Map(), seen = new Set()) {
  const value = unwrap(node);
  if (!value) return value;
  if (ts.isIdentifier(value)) {
    if (bindings.has(value.text)) return resolvedNode(bindings.get(value.text), constants, bindings, seen);
    if (seen.has(value.text)) return value;
    const constant = constants.get(value.text);
    return constant
      ? resolvedNode(constant, constants, bindings, new Set([...seen, value.text]))
      : value;
  }
  if (ts.isPropertyAccessExpression(value)) {
    const base = resolvedNode(value.expression, constants, bindings, seen);
    const selected = property(base, value.name.text);
    return selected ? resolvedNode(selected, constants, bindings, seen) : value;
  }
  if (ts.isElementAccessExpression(value) && value.argumentExpression) {
    const base = resolvedNode(value.expression, constants, bindings, seen);
    const key = resolvedText(value.argumentExpression, constants, bindings);
    if (key && base) {
      const selected = property(base, key);
      if (selected) return resolvedNode(selected, constants, bindings, seen);
    }
  }
  return value;
}

function resolvedText(node, constants, bindings = new Map()) {
  const resolved = resolvedNode(node, constants, bindings);
  return staticText(resolved, constants);
}

function resolvedArray(node, constants, bindings = new Map(), seen = new Set()) {
  const value = resolvedNode(node, constants, bindings, seen);
  if (!value) return [];
  if (ts.isCallExpression(value)) {
    if (
      ts.isPropertyAccessExpression(value.expression) &&
      ts.isIdentifier(value.expression.expression) &&
      value.expression.expression.text === "Object" &&
      (value.expression.name.text === "values" || value.expression.name.text === "entries")
    ) {
      const object = resolvedNode(value.arguments[0], constants, bindings, seen);
      if (!object || !ts.isObjectLiteralExpression(object)) return [];
      return object.properties.flatMap((item) => {
        if (!ts.isPropertyAssignment(item)) return [];
        if (value.expression.name.text === "values") return [item.initializer];
        const key =
          ts.isIdentifier(item.name) || ts.isStringLiteralLike(item.name)
            ? ts.factory.createStringLiteral(item.name.text)
            : null;
        return key ? [ts.factory.createArrayLiteralExpression([key, item.initializer])] : [];
      });
    }
    if (ts.isPropertyAccessExpression(value.expression)) {
      const method = value.expression.name.text;
      if (method === "filter") {
        return resolvedArray(value.expression.expression, constants, bindings, seen);
      }
      if (method === "map" || method === "flatMap") {
        const input = resolvedArray(value.expression.expression, constants, bindings, seen);
        const callback = unwrap(value.arguments[0]);
        if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) return [];
        const parameter = callback.parameters[0]?.name;
        if (!parameter || !ts.isIdentifier(parameter)) return [];
        let body = callback.body;
        if (ts.isBlock(body)) {
          const returned = body.statements.find(ts.isReturnStatement);
          body = returned?.expression;
        }
        if (!body) return [];
        return input.flatMap((item) => {
          const nextBindings = new Map(bindings);
          nextBindings.set(parameter.text, item);
          const resolved = resolvedNode(body, constants, nextBindings);
          return method === "flatMap" && ts.isArrayLiteralExpression(resolved)
            ? resolvedArray(resolved, constants, nextBindings, seen)
            : [resolved];
        });
      }
    }
  }
  if (!ts.isArrayLiteralExpression(value)) return [];
  const result = [];
  for (const item of value.elements) {
    if (ts.isSpreadElement(item)) {
      result.push(...resolvedArray(item.expression, constants, bindings, seen));
    } else {
      result.push(resolvedNode(item, constants, bindings, seen));
    }
  }
  return result;
}

function mappedObjectCandidates(files, constants) {
  const candidates = [];
  for (const file of files) {
    const source = sourceFile(file);
    visit(source, (node) => {
      if (
        !ts.isCallExpression(node) ||
        !ts.isPropertyAccessExpression(node.expression) ||
        !["map", "flatMap"].includes(node.expression.name.text)
      ) return;
      const callback = unwrap(node.arguments[0]);
      if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) return;
      const parameter = callback.parameters[0]?.name;
      if (!parameter || !ts.isIdentifier(parameter)) return;
      let body = callback.body;
      if (ts.isBlock(body)) {
        const returned = body.statements.find(ts.isReturnStatement);
        body = returned?.expression;
      }
      body = unwrap(body);
      if (!body || !ts.isObjectLiteralExpression(body)) return;
      for (const item of resolvedArray(node.expression.expression, constants)) {
        candidates.push({
          node: body,
          bindings: new Map([[parameter.text, item]]),
        });
      }
    });
  }
  return candidates;
}

/**
 * When ObjectTypes declare FieldDef objects (e.g. StructureNode builtins) instead of
 * a writable: string[] list, treat fields as writable unless inForm===false or ReadOnly.
 */
function writableFromFieldDefs(fieldsNode, constants, bindings) {
  const fields = resolvedArray(fieldsNode, constants, bindings);
  const writable = [];
  for (const field of fields) {
    const value = resolvedNode(field, constants, bindings);
    if (!value || !ts.isObjectLiteralExpression(value)) continue;
    const name = resolvedText(property(value, "name"), constants, bindings);
    if (!name) continue;
    const fieldType = resolvedText(property(value, "fieldType"), constants, bindings);
    if (fieldType === "ReadOnly") continue;
    const inFormNode = property(value, "inForm");
    if (inFormNode) {
      const inForm = resolvedNode(inFormNode, constants, bindings);
      if (inForm && inForm.kind === ts.SyntaxKind.FalseKeyword) continue;
    }
    writable.push(name);
  }
  return writable;
}

export function discoverKernelSchema(repoRoot) {
  const kernelFiles = walkFiles(
    path.join(repoRoot, "apps", "bridge", "src", "kernel"),
    new Set([".ts"])
  ).filter((file) => !file.includes(`${path.sep}__tests__${path.sep}`));
  const files = [
    ...kernelFiles,
    path.join(repoRoot, "packages", "kernel", "src", "builtins.ts"),
  ];
  const constants = constMap(files);
  const objectTypes = new Map();
  const candidates = [];
  for (const file of files) {
    const source = sourceFile(file);
    visit(source, (node) => {
      if (ts.isObjectLiteralExpression(node)) candidates.push({ node, bindings: new Map() });
    });
  }
  candidates.push(...mappedObjectCandidates(files, constants));
  for (const candidate of candidates) {
      const name = resolvedText(property(candidate.node, "name"), constants, candidate.bindings);
      const moduleName = resolvedText(property(candidate.node, "module"), constants, candidate.bindings);
      if (
        !name ||
        !moduleName ||
        (!property(candidate.node, "fields") && !property(candidate.node, "table"))
      ) continue;
      const operationsNode = property(candidate.node, "operations");
      const writable = resolvedNode(
        property(candidate.node, "writable"),
        constants,
        candidate.bindings
      );
      const operations = operationsNode
        ? resolvedArray(operationsNode, constants, candidate.bindings)
            .map((item) => resolvedText(item, constants, candidate.bindings))
            .filter(Boolean)
        : writable
          ? ["list", "get", "create", "update", "delete"]
          : ["list", "get"];
      const actions = resolvedArray(
        property(candidate.node, "actions"),
        constants,
        candidate.bindings
      )
        .map((item) => {
          const value = resolvedNode(item, constants, candidate.bindings);
          return (
            resolvedText(property(value, "name"), constants, candidate.bindings) ??
            (ts.isCallExpression(value) &&
            ts.isIdentifier(value.expression) &&
            value.expression.text === "action"
              ? resolvedText(value.arguments[0], constants, candidate.bindings)
              : null)
          );
        })
        .filter(Boolean);
      const writableFields = writable
        ? resolvedArray(writable, constants, candidate.bindings)
            .map((item) => resolvedText(item, constants, candidate.bindings))
            .filter(Boolean)
        : writableFromFieldDefs(property(candidate.node, "fields"), constants, candidate.bindings);
      const next = {
        operations: new Set(operations),
        actions: new Set(actions),
        writable: new Set(writableFields),
      };
      const previous = objectTypes.get(name);
      if (!previous) {
        objectTypes.set(name, next);
        continue;
      }
      // Prefer the richest writable set when the same ObjectType appears in
      // domain specs and adapter/registration maps.
      const mergedWritable = new Set([...previous.writable, ...next.writable]);
      const mergedOps = new Set([...previous.operations, ...next.operations]);
      const mergedActions = new Set([...previous.actions, ...next.actions]);
      objectTypes.set(name, {
        operations: mergedOps.size >= previous.operations.size ? mergedOps : previous.operations,
        actions: mergedActions.size >= previous.actions.size ? mergedActions : previous.actions,
        writable: mergedWritable,
      });
  }
  return objectTypes;
}

/** Adapter-local writable Sets (CARD_WRITABLE, CALENDAR_WRITABLE, etc.). */
export function discoverAdapterWritableSets(repoRoot) {
  const adapterDir = path.join(repoRoot, "apps", "bridge", "src", "kernel", "adapters");
  const files = walkFiles(adapterDir, new Set([".ts"])).filter(
    (file) => !file.includes(`${path.sep}__tests__${path.sep}`)
  );
  const constants = constMap(files);
  const sets = [];
  for (const file of files) {
    const source = sourceFile(file);
    visit(source, (node) => {
      if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) {
        return;
      }
      if (!/_WRITABLE$/.test(node.name.text) && node.name.text !== "writable") return;
      const init = unwrap(node.initializer);
      if (
        !ts.isNewExpression(init) ||
        !ts.isIdentifier(init.expression) ||
        init.expression.text !== "Set" ||
        !init.arguments[0]
      ) {
        return;
      }
      const fields = resolvedArray(init.arguments[0], constants, new Map())
        .map((item) => resolvedText(item, constants, new Map()))
        .filter(Boolean);
      // Skip tiny inline writable=new Set inside update handlers unless named *_WRITABLE.
      if (node.name.text === "writable" && fields.length === 0) return;
      sets.push({
        file: slash(path.relative(repoRoot, file)),
        name: node.name.text,
        fields: new Set(fields),
      });
    });
  }
  return sets;
}

/**
 * Static createDto/updateDto object-literal payloads in apps/web/src/api.ts.
 * Keys present in the AST are checked even when runtime JSON.stringify drops undefined.
 */
export function discoverClientRecordPayloads(repoRoot) {
  const file = path.join(repoRoot, "apps", "web", "src", "api.ts");
  if (!fs.existsSync(file)) return [];
  const source = sourceFile(file);
  const payloads = [];
  visit(source, (node) => {
    if (!ts.isCallExpression(node) || node.arguments.length < 2) return;
    const callee = unwrap(node.expression);
    if (!ts.isIdentifier(callee)) return;
    if (callee.text !== "createDto" && callee.text !== "updateDto") return;
    const objectType = staticText(node.arguments[0]);
    if (!objectType) return;
    const dataArg =
      callee.text === "createDto" ? node.arguments[1] : node.arguments[2];
    const data = unwrap(dataArg);
    if (!data || !ts.isObjectLiteralExpression(data)) return;
    const fields = [];
    for (const prop of data.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      if (ts.isIdentifier(prop.name)) fields.push(prop.name.text);
      else if (ts.isStringLiteralLike(prop.name)) fields.push(prop.name.text);
    }
    payloads.push({
      file: slash(path.relative(repoRoot, file)),
      kind: callee.text,
      objectType,
      fields,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    });
  });
  return payloads;
}

/** Map adapter WRITABLE const names onto ObjectType names when unambiguous. */
export const ADAPTER_WRITABLE_OBJECT_TYPES = {
  CARD_WRITABLE: "TaskCard",
  CALENDAR_WRITABLE: "CalendarEvent",
};

function methodFromOptions(node, constants) {
  const method = staticText(property(node, "method"), constants);
  return method?.toUpperCase() ?? null;
}

export function discoverMutationCallers(repoRoot) {
  const scopes = [
    ["web", path.join(repoRoot, "apps", "web", "src")],
    ["scripts", path.join(repoRoot, "scripts")],
    ["connectors", path.join(repoRoot, "apps", "connector", "src")],
    ["plugins", path.join(repoRoot, "apps", "bridge", "src", "plugins")],
    ["plugins", path.join(repoRoot, "packages", "plugin-api", "src")],
    ["plugins", path.join(repoRoot, "packages", "plugin-host", "src")],
  ];
  const callers = [];
  const errors = [];
  for (const [scope, root] of scopes) {
    for (const file of walkFiles(root)) {
      const relative = slash(path.relative(repoRoot, file));
      if (/(__tests__|\.test\.|audit-kernel|scripts\/(?:release|update|backup)\/)/.test(relative)) continue;
      const source = sourceFile(file);
      const constants = constMap([file]);
      visit(source, (node) => {
        if (!ts.isCallExpression(node)) return;
        const callee = ts.isIdentifier(node.expression)
          ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression)
            ? node.expression.name.text
            : "";
        if (!["api", "fetch", "request", "bridgeFetch"].includes(callee)) return;
        let rawPath = staticText(node.arguments[0], constants);
        let method = null;
        if (callee === "request") method = staticText(node.arguments[1], constants)?.toUpperCase() ?? null;
        else method = methodFromOptions(node.arguments[1], constants);
        if (!method || !MUTATION_METHODS.has(method)) return;
        if (
          !rawPath &&
          relative.endsWith("apps/web/src/lib/object-types-api.ts") &&
          node.arguments[0]?.getText(source).includes("target")
        ) {
          rawPath = "/records/:param";
        }
        if (!rawPath) {
          errors.push(`${relative}:${lineOf(source, node)} ${callee} mutation uses a dynamic path`);
          return;
        }
        let apiPath = rawPath;
        if (callee === "api" || callee === "request") apiPath = `/api/${rawPath}`;
        const apiIndex = apiPath.indexOf("/api/");
        if (apiIndex >= 0) apiPath = apiPath.slice(apiIndex);
        callers.push({
          scope: relative.includes("/plugins/") ? "plugins" : scope,
          file: relative,
          line: lineOf(source, node),
          method,
          path: normalizePath(apiPath),
          callee,
        });
      });
    }
  }
  return { callers, errors };
}

function collectRegistryArray(repoRoot) {
  const file = path.join(repoRoot, "apps", "bridge", "src", "services", "ai-tools-registry.ts");
  const source = sourceFile(file);
  const constants = constMap([file]);
  const namesFromArray = (node) => {
    const array = unwrap(node);
    const names = [];
    if (!array || !ts.isArrayLiteralExpression(array)) return names;
    for (const item of array.elements) {
      if (ts.isSpreadElement(item)) continue;
      const name = staticText(property(item, "name"), constants);
      if (name) names.push(name);
    }
    return names;
  };

  const registry = unwrap(constants.get("AI_TOOL_REGISTRY"));
  const namedExclusion = unwrap(constants.get("STATIC_GENERATED_COLLISION_NAMES"));
  const namedExcluded =
    namedExclusion &&
    ts.isNewExpression(namedExclusion) &&
    namedExclusion.arguments?.[0]
      ? new Set(
          staticArray(namedExclusion.arguments[0], constants)
            .map((item) => staticText(item, constants))
            .filter(Boolean)
        )
      : new Set();
  if (registry && ts.isArrayLiteralExpression(registry)) {
    return namesFromArray(registry).filter((name) => !namedExcluded.has(name));
  }
  if (
    registry &&
    ts.isCallExpression(registry) &&
    ts.isPropertyAccessExpression(registry.expression) &&
    registry.expression.name.text === "filter" &&
    ts.isIdentifier(registry.expression.expression)
  ) {
    const baseNames = namesFromArray(constants.get(registry.expression.expression.text));
    let exclusionSet = null;
    visit(registry.arguments[0], (node) => {
      if (
        !exclusionSet &&
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "has" &&
        ts.isIdentifier(node.expression.expression)
      ) {
        exclusionSet = node.expression.expression.text;
      }
    });
    const setExpression = exclusionSet ? unwrap(constants.get(exclusionSet)) : null;
    const excluded =
      setExpression &&
      ts.isNewExpression(setExpression) &&
      setExpression.arguments?.[0]
        ? new Set(
            staticArray(setExpression.arguments[0], constants)
              .map((item) => staticText(item, constants))
              .filter(Boolean)
          )
        : new Set();
    return baseNames.filter((name) => !excluded.has(name) && !namedExcluded.has(name));
  }
  return [];
}

function toolBase(objectType) {
  return objectType.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function toolPlural(base) {
  if (base.endsWith("s") || base.endsWith("x") || base.endsWith("ch") || base.endsWith("sh")) {
    return `${base}es`;
  }
  if (base.endsWith("y") && !/[aeiou]y$/.test(base)) return `${base.slice(0, -1)}ies`;
  return `${base}s`;
}

export function discoverToolInventory(repoRoot, objectTypes) {
  const staticNames = collectRegistryArray(repoRoot);
  const genericNames = [
    "list_object_types",
    "list_records",
    "get_record",
    "create_record",
    "update_record",
    "delete_record",
    "run_record_action",
  ];
  const generatedCandidates = [];
  for (const [name, definition] of objectTypes) {
    const base = toolBase(name);
    for (const operation of definition.operations) {
      const prefix = operation === "list" ? "list" : operation === "get" ? "get" : operation;
      generatedCandidates.push(`${prefix}_${operation === "list" ? toolPlural(base) : base}`);
    }
    for (const action of definition.actions) generatedCandidates.push(`${base}_${action}`);
  }
  return { staticNames, genericNames, generatedCandidates };
}

export function duplicates(values) {
  const seen = new Set();
  const duplicate = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate].sort();
}

export function formatLocations(items, render) {
  return items.map((item) => `  ${item.file}:${item.line} ${render(item)}`).join("\n");
}
