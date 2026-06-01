import fs from "node:fs";
import path from "node:path";

import { resolveCommand } from "package-manager-detector/commands";
import { detect } from "package-manager-detector/detect";

import type { Framework } from "../configs/frameworks.config";
import { FRAMEWORKS } from "../configs/frameworks.config";

export type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

export async function detectPackageManager(cwd: string): Promise<PackageManager> {
  const agent = await detect({ cwd });
  return (agent?.name as PackageManager) ?? "npm";
}

export function getInstallCommand(pm: PackageManager, packages: string[]): string {
  const r = resolveCommand(pm, "add", packages);
  return r ? [r.command, ...r.args].join(" ") : `${pm} add ${packages.join(" ")}`;
}

export function getRunCommand(pm: PackageManager, script: string): string {
  const r = resolveCommand(pm, "execute", [script]);
  if (r) return [r.command, ...r.args].join(" ");
  if (pm === "npm") return `npx ${script}`;
  if (pm === "bun") return `bunx ${script}`;
  if (pm === "yarn") return `yarn dlx ${script}`;
  return `pnpm dlx ${script}`;
}

export function getExecPrefix(pm: PackageManager): string {
  if (pm === "npm") return "npx";
  if (pm === "bun") return "bunx";
  if (pm === "yarn") return "yarn";
  return "pnpm";
}

export function getDlxPrefix(pm: PackageManager): string {
  if (pm === "npm") return "npx";
  if (pm === "bun") return "bunx";
  if (pm === "yarn") return "yarn dlx";
  return "pnpx";
}

export function isPackageInstalled(cwd: string, name: string): boolean {
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) return false;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
  } catch {
    return false;
  }
}

function readPackageJson(
  cwd: string,
): { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null {
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
  } catch {
    return null;
  }
}

function hasDependency(
  pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
  name: string,
): boolean {
  return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
}

export function detectFramework(cwd: string): Framework | null {
  const pkg = readPackageJson(cwd);

  if (pkg) {
    for (const framework of FRAMEWORKS) {
      if (hasDependency(pkg, framework.dependency)) {
        return framework;
      }
    }
  }

  let cwdFiles: string[];
  try {
    cwdFiles = fs.readdirSync(cwd);
  } catch {
    return null;
  }

  for (const framework of FRAMEWORKS) {
    if (!framework.configPaths?.length) continue;

    for (const configPath of framework.configPaths) {
      if (cwdFiles.includes(configPath)) {
        return framework;
      }
    }
  }

  return null;
}

export function detectNextJsRouterPath(cwd: string): string {
  const rootFiles = safeReaddir(cwd);
  const hasAppDir = rootFiles.includes("app");
  const hasPagesDir = rootFiles.includes("pages");
  const hasSrcDir = rootFiles.includes("src");

  if (hasSrcDir) {
    const srcFiles = safeReaddir(path.join(cwd, "src"));
    if (srcFiles.includes("pages")) return "src/pages/api/birrjs/[...slug].ts";
    if (srcFiles.includes("app")) return "src/app/api/birrjs/[...slug]/route.ts";
  }

  if (hasPagesDir) return "pages/api/birrjs/[...slug].ts";
  if (hasAppDir) return "app/api/birrjs/[...slug]/route.ts";

  return "src/app/api/birrjs/[...slug]/route.ts";
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function parseTsconfig(cwd: string): {
  paths?: Record<string, string[]>;
  baseUrl?: string;
} | null {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const configPath = path.join(cwd, name);
    if (!fs.existsSync(configPath)) continue;

    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      const noComments = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      const stripped = noComments.replace(/,\s*([}\]])/g, "$1");
      const config = JSON.parse(stripped) as {
        compilerOptions?: { paths?: Record<string, string[]>; baseUrl?: string };
      };
      return {
        paths: config.compilerOptions?.paths,
        baseUrl: config.compilerOptions?.baseUrl,
      };
    } catch {
      continue;
    }
  }
  return null;
}

export function resolveImportPath(
  fromFile: string,
  toFile: string,
  cwd: string,
  framework?: Framework,
): string {
  const absoluteTo = path.resolve(cwd, toFile);
  const absoluteFrom = path.resolve(cwd, fromFile);
  const fromDir = path.dirname(absoluteFrom);

  if (framework?.id === "sveltekit") {
    const relativeTo = path.relative(cwd, absoluteTo).replace(/\\/g, "/");
    if (relativeTo.startsWith("src/lib/")) {
      const after = relativeTo.slice("src/lib/".length).replace(/\.(ts|js|tsx|jsx)$/, "");
      return after ? `$lib/${after}` : "$lib/birrjs";
    }
  }

  if (framework?.id === "hono" || framework?.id === "elysia") {
    let rel = path.relative(fromDir, absoluteTo).replace(/\.(ts|js|tsx|jsx)$/, "");
    if (!rel.startsWith(".")) rel = `./${rel}`;
    return rel.replace(/\\/g, "/");
  }

  const tsconfig = parseTsconfig(cwd);
  if (tsconfig?.paths) {
    for (const [alias, targets] of Object.entries(tsconfig.paths)) {
      if (!alias.endsWith("/*") || !Array.isArray(targets) || targets.length === 0) continue;

      const target = targets[0]!;
      if (!target.endsWith("/*")) continue;

      const aliasPrefix = alias.slice(0, -2);
      let basePath = target.slice(0, -2);

      if (tsconfig.baseUrl && tsconfig.baseUrl !== ".") {
        basePath = path.join(tsconfig.baseUrl, basePath);
      }

      const normalizedBase = path.normalize(basePath).replace(/\\/g, "/");
      const relativeTo = path.relative(cwd, absoluteTo).replace(/\\/g, "/");

      if (normalizedBase === "." || normalizedBase === "" || normalizedBase === "./") {
        const withoutExt = relativeTo.replace(/\.(ts|js|tsx|jsx)$/, "");
        return `${aliasPrefix}/${withoutExt}`;
      }

      if (relativeTo.startsWith(normalizedBase + "/") || relativeTo === normalizedBase) {
        const after =
          relativeTo === normalizedBase ? "" : relativeTo.slice(normalizedBase.length + 1);
        const withoutExt = after.replace(/\.(ts|js|tsx|jsx)$/, "");
        return withoutExt ? `${aliasPrefix}/${withoutExt}` : aliasPrefix;
      }
    }
  }

  let relative = path.relative(fromDir, absoluteTo).replace(/\.(ts|js|tsx|jsx)$/, "");
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return relative.replace(/\\/g, "/");
}

export function defaultConfigPath(cwd: string): string {
  if (fs.existsSync(path.join(cwd, "src"))) return "src/lib/birrjs.ts";
  return "birrjs.ts";
}
