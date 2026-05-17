import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";
import { createJiti } from "jiti";
import * as ts from "typescript";

import { isBirrInstance } from "../../core/create-birr";
import type { BirrJSOptions } from "../../types/options";

const CONFIG_FILENAMES = [
  "birrjs.ts",
  "birrjs.tsx",
  "birrjs.config.ts",
  "birrjs.config.tsx",
  "birrjs/index.ts",
  "birrjs/index.tsx",
  "birrjs.js",
  "birrjs.jsx",
  "birrjs.config.js",
  "birrjs.config.jsx",
  "birrjs/index.js",
  "birrjs/index.jsx",
];

const CONFIG_DIRS = [
  "",
  "birrjs",
  "lib/server",
  "server/birrjs",
  "server",
  "lib",
  "src",
  "src/lib",
  "src/server",
  "app",
];

const possibleBirrJSConfigPaths = CONFIG_DIRS.flatMap((dir) =>
  CONFIG_FILENAMES.map((name) => (dir ? `${dir}/${name}` : name)),
);

function resolveReferencePath(configDir: string, refPath: string): string {
  const resolvedPath = path.resolve(configDir, refPath);
  if (refPath.endsWith(".json")) {
    return resolvedPath;
  }

  if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
    return resolvedPath;
  }

  return path.resolve(configDir, refPath, "tsconfig.json");
}

function getPathAliasesRecursive(
  tsconfigPath: string,
  visited = new Set<string>(),
): Record<string, string> {
  if (visited.has(tsconfigPath) || !fs.existsSync(tsconfigPath)) {
    return {};
  }

  visited.add(tsconfigPath);
  const readResult = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (readResult.error) {
    throw new Error(ts.flattenDiagnosticMessageText(readResult.error.messageText, "\n"));
  }

  const parsed = ts.parseJsonConfigFileContent(
    readResult.config,
    ts.sys,
    path.dirname(tsconfigPath),
  );
  const result: Record<string, string> = {};
  const paths = parsed.options.paths ?? {};
  const baseUrl = parsed.options.baseUrl ?? path.dirname(tsconfigPath);

  for (const [alias, aliasPaths] of Object.entries(paths)) {
    for (const aliasPath of aliasPaths) {
      const finalAlias = alias.endsWith("*") ? alias.slice(0, -1) : alias;
      const finalAliasPath = aliasPath.endsWith("*") ? aliasPath.slice(0, -1) : aliasPath;
      result[finalAlias] = path.resolve(baseUrl, finalAliasPath);
    }
  }

  const references = readResult.config.references as Array<{ path: string }> | undefined;
  if (!references) {
    return result;
  }

  for (const reference of references) {
    const nextPath = resolveReferencePath(path.dirname(tsconfigPath), reference.path);
    const referencedAliases = getPathAliasesRecursive(nextPath, visited);
    for (const [alias, aliasPath] of Object.entries(referencedAliases)) {
      result[alias] ??= aliasPath;
    }
  }

  return result;
}

function getPathAliases(cwd: string): Record<string, string> {
  const tsconfigPath = path.join(cwd, "tsconfig.json");
  if (fs.existsSync(tsconfigPath)) {
    return getPathAliasesRecursive(tsconfigPath);
  }

  const jsconfigPath = path.join(cwd, "jsconfig.json");
  if (fs.existsSync(jsconfigPath)) {
    return getPathAliasesRecursive(jsconfigPath);
  }

  return {};
}

function loadDotEnv(cwd: string): void {
  dotenv.config({ path: path.join(cwd, ".env"), quiet: true });
  dotenv.config({ override: true, path: path.join(cwd, ".env.local"), quiet: true });
}

async function loadModule(cwd: string, configPath: string): Promise<unknown> {
  loadDotEnv(cwd);

  const jiti = createJiti(configPath, {
    alias: getPathAliases(cwd),
    interopDefault: false,
    jsx: true,
    moduleCache: false,
  });

  return jiti.import(configPath);
}

function getBirrJS(moduleValue: unknown) {
  if (!moduleValue || typeof moduleValue !== "object") return null;

  const moduleObject = moduleValue as Record<string, unknown>;
  return (
    [moduleObject.birrjs, moduleObject.default].find(
      (value): value is { options: BirrJSOptions } => isBirrInstance(value) || isBirrJSLike(value),
    ) ?? null
  );
}

function isBirrJSLike(value: unknown): value is { options: BirrJSOptions } {
  if (!value || typeof value !== "object") return false;

  const birrjs = value as Record<string, unknown>;
  return (
    typeof birrjs.handler === "function" &&
    typeof birrjs.subscribe === "function" &&
    typeof birrjs.handleWebhook === "function" &&
    "options" in birrjs
  );
}

export interface LoadedConfig {
  path: string;
  options: BirrJSOptions;
}

export async function getBirrJSConfig({
  cwd,
  configPath,
}: {
  cwd: string;
  configPath?: string;
}): Promise<LoadedConfig> {
  if (configPath) {
    const resolvedPath = path.isAbsolute(configPath) ? configPath : path.resolve(cwd, configPath);
    return loadConfiguredBirrJS(cwd, resolvedPath);
  }

  for (const possiblePath of possibleBirrJSConfigPaths) {
    const resolvedPath = path.join(cwd, possiblePath);
    if (!fs.existsSync(resolvedPath)) {
      continue;
    }

    return loadConfiguredBirrJS(cwd, resolvedPath);
  }

  throw new Error(
    "No BirrJS configuration file found. Add a `birrjs.ts` file to your project or pass the path with `--config`.",
  );
}

async function loadConfiguredBirrJS(cwd: string, resolvedPath: string) {
  const loadedModule = await loadModule(cwd, resolvedPath);
  const birrjs = getBirrJS(loadedModule);
  if (!birrjs) {
    throw new Error(
      `Couldn't read your BirrJS instance in ${resolvedPath}. Export your BirrJS instance as \`birrjs\` or default export the result of \`createBirr(...)\`.`,
    );
  }

  return {
    path: resolvedPath,
    options: birrjs.options,
  };
}
