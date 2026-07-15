#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverKernelSchema,
  discoverMutationCallers,
  discoverMutationRoutes,
  discoverProtocolExceptions,
  discoverToolInventory,
  duplicates,
  formatLocations,
  patternMatches,
  routeMatches,
  validateProtocolExceptions,
} from "./audit-kernel-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");
const verbose = process.argv.includes("--verbose");

// Freeze aggregate debt without claiming each legacy endpoint is compatible.
// Migration waves lower these ceilings; new debt must never raise them.
const PROGRESS_CEILINGS = {
  migrationDebt: 13,
  staticGeneratedCollisions: 0,
};

const errors = [];
const { routes, allRoutes, errors: routeErrors } = discoverMutationRoutes(repoRoot);
const { callers, errors: callerErrors } = discoverMutationCallers(repoRoot);
const objectTypes = discoverKernelSchema(repoRoot);
const exceptions = discoverProtocolExceptions(repoRoot);
errors.push(...routeErrors, ...callerErrors);
errors.push(...validateProtocolExceptions(exceptions, allRoutes));

for (const route of routes) {
  const matchingException = exceptions.find(
    (entry) =>
      entry.methods.includes(route.method) &&
      patternMatches(entry.pathPattern, route.fullPath)
  );
  const kernelNative = route.file.endsWith("/kernel/routes.ts");
  const verifiedKernelCalls = [];

  for (const call of route.kernelCalls) {
    if (kernelNative && call.target == null) continue;
    if (!call.target) {
      errors.push(`${route.file}:${route.line} ${call.operation} has a non-static ObjectType target`);
      continue;
    }
    const definition = objectTypes.get(call.target);
    if (!definition) {
      errors.push(`${route.file}:${route.line} references unknown ObjectType ${call.target}`);
      continue;
    }
    const expectedOperation = new Map([
      ["createRecord", "create"],
      ["updateRecord", "update"],
      ["deleteRecord", "delete"],
    ]).get(call.operation);
    if (expectedOperation && !definition.operations.has(expectedOperation)) {
      errors.push(`${route.file}:${route.line} ${call.target} does not declare ${expectedOperation}`);
    }
    if (call.operation.startsWith("execute")) {
      if (!call.action) {
        errors.push(`${route.file}:${route.line} ${call.operation} has a non-static action`);
      } else if (!definition.actions.has(call.action)) {
        errors.push(
          `${route.file}:${route.line} ${call.target} does not declare action ${call.action}`
        );
      }
    }
    verifiedKernelCalls.push(call);
  }

  route.classification = kernelNative
    ? route.localPath.includes("/actions/")
      ? "kernel-action"
      : "kernel-record"
    : verifiedKernelCalls.length
      ? "kernel-delegated"
      : matchingException?.delegated === "none"
        ? "protocol-exception"
        : "legacy";
}

const duplicateRoutes = duplicates(routes.map((route) => `${route.method} ${route.fullPath}`));
if (duplicateRoutes.length) {
  errors.push(`Duplicate mounted mutation routes: ${duplicateRoutes.join(", ")}`);
}

const legacyRoutes = routes.filter((route) => route.classification === "legacy");
const legacyCallers = [];
const unknownMutationCallers = [];
for (const caller of callers) {
  const matched = routes.filter(
    (route) => route.method === caller.method && routeMatches(route.fullPath, caller.path)
  );
  if (!matched.length) {
    const approvedTransport = exceptions.some(
      (entry) =>
        entry.methods.includes(caller.method) &&
        patternMatches(entry.pathPattern, caller.path)
    );
    if (!approvedTransport && !caller.path.startsWith("/api/records/")) {
      unknownMutationCallers.push(caller);
    }
    continue;
  }
  if (matched.some((route) => route.classification === "legacy")) legacyCallers.push(caller);
}

for (const caller of callers.filter((item) => item.path.startsWith("/api/records/"))) {
  const segments = caller.path.split("/");
  const target = segments[3];
  if (!target || target === ":" || target.includes(":")) continue;
  const definition = objectTypes.get(target);
  if (!definition) {
    errors.push(`${caller.file}:${caller.line} calls unknown ObjectType ${target}`);
    continue;
  }
  const actionIndex = segments.indexOf("actions");
  if (actionIndex >= 0) {
    const action = segments[actionIndex + 1];
    if (action && action !== ":" && !definition.actions.has(action)) {
      errors.push(`${caller.file}:${caller.line} ${target} does not declare action ${action}`);
    }
  }
}

const tools = discoverToolInventory(repoRoot, objectTypes);
const duplicateStaticTools = duplicates(tools.staticNames);
const duplicateGeneratedTools = duplicates(tools.generatedCandidates);
if (duplicateStaticTools.length) {
  errors.push(`Duplicate static AI tools: ${duplicateStaticTools.join(", ")}`);
}
if (duplicateGeneratedTools.length) {
  errors.push(`Duplicate generated AI tools: ${duplicateGeneratedTools.join(", ")}`);
}
const staticSet = new Set(tools.staticNames);
const staticGeneratedCollisions = [
  ...new Set(
    [...tools.genericNames, ...tools.generatedCandidates].filter((name) => staticSet.has(name))
  ),
].sort();

const counts = {
  totalRoutes: routes.length,
  kernelRecordRoutes: routes.filter((route) => route.classification === "kernel-record").length,
  kernelActionRoutes: routes.filter((route) => route.classification === "kernel-action").length,
  kernelDelegatedRoutes: routes.filter((route) => route.classification === "kernel-delegated").length,
  protocolExceptions: routes.filter((route) => route.classification === "protocol-exception").length,
  legacyRoutes: legacyRoutes.length,
  legacyCallers: legacyCallers.length,
  unknownMutationCallers: unknownMutationCallers.length,
  objectTypes: objectTypes.size,
  staticTools: tools.staticNames.length,
  generatedToolCandidates: tools.generatedCandidates.length,
  staticGeneratedCollisions: staticGeneratedCollisions.length,
  legacyCallersByScope: Object.fromEntries(
    ["web", "scripts", "connectors", "plugins"].map((scope) => [
      scope,
      legacyCallers.filter((caller) => caller.scope === scope).length,
    ])
  ),
  unknownMutationCallersByScope: Object.fromEntries(
    ["web", "scripts", "connectors", "plugins"].map((scope) => [
      scope,
      unknownMutationCallers.filter((caller) => caller.scope === scope).length,
    ])
  ),
};
counts.migrationDebt =
  counts.legacyRoutes + counts.legacyCallers + counts.unknownMutationCallers;

for (const [name, ceiling] of Object.entries(PROGRESS_CEILINGS)) {
  if (counts[name] > ceiling) {
    errors.push(`${name} regressed: ${counts[name]} exceeds migration ceiling ${ceiling}`);
  }
}
if (strict) {
  for (const name of [
    "legacyRoutes",
    "legacyCallers",
    "unknownMutationCallers",
    "staticGeneratedCollisions",
  ]) {
    if (counts[name]) errors.push(`strict completion requires ${name}=0 (found ${counts[name]})`);
  }
}

console.log(`Kernel migration coverage (${strict ? "strict" : "progress"})`);
console.log(JSON.stringify(counts, null, 2));
if (verbose && legacyRoutes.length) {
  console.log(
    `\nLegacy mutation routes:\n${formatLocations(
      legacyRoutes,
      (route) => `${route.method} ${route.fullPath}`
    )}`
  );
}
if (verbose && legacyCallers.length) {
  console.log(
    `\nLegacy mutation callers:\n${formatLocations(
      legacyCallers,
      (caller) => `${caller.method} ${caller.path}`
    )}`
  );
}
if (verbose && unknownMutationCallers.length) {
  console.log(
    `\nUnmatched mutation callers:\n${formatLocations(
      unknownMutationCallers,
      (caller) => `${caller.method} ${caller.path}`
    )}`
  );
}
if (verbose && staticGeneratedCollisions.length) {
  console.log(`\nStatic/generated tool collisions:\n  ${staticGeneratedCollisions.join("\n  ")}`);
}

if (errors.length) {
  console.error("\nKernel migration coverage audit FAILED");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    strict
      ? "\nKernel migration strict completion audit passed."
      : "\nKernel migration progress audit passed; debt ceilings did not regress."
  );
}
