import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

import fs from "node:fs";
import path from "node:path";

import * as p from "@clack/prompts";
import { Command } from "@commander-js/extra-typings";
import picocolors from "picocolors";

import {
  detectPackageManager,
  getExecPrefix,
  getInstallCommand,
  isPackageInstalled,
} from "../utils/detect";

const GITHUB_RAW = "https://raw.githubusercontent.com/Samuel-fikre/birrjs/main";

interface RegistryFile {
  path: string;
  type: string;
  target?: string;
}

interface RegistryItem {
  name: string;
  type: string;
  dependencies?: string[];
  registryDependencies?: string[];
  files: RegistryFile[];
}

interface Registry {
  name: string;
  items: RegistryItem[];
}

interface ResolvedFile {
  path: string;
  type: string;
  target?: string;
}

interface RegistrySource {
  getRegistry(): Promise<Registry>;
  getFile(filePath: string): Promise<string>;
}

function createLocalSource(): RegistrySource {
  return {
    async getRegistry() {
      const localPath = path.join(process.cwd(), "registry.json");
      return JSON.parse(fs.readFileSync(localPath, "utf-8")) as Registry;
    },
    async getFile(filePath) {
      return fs.readFileSync(path.join(process.cwd(), filePath), "utf-8");
    },
  };
}

function createGitHubSource(): RegistrySource {
  return {
    async getRegistry() {
      const res = await fetch(`${GITHUB_RAW}/registry.json`);
      if (!res.ok) throw new Error(`Failed to fetch registry: ${res.status}`);
      return res.json() as Promise<Registry>;
    },
    async getFile(filePath) {
      const res = await fetch(`${GITHUB_RAW}/${filePath}`);
      if (!res.ok) throw new Error(`Failed to fetch ${filePath}: ${res.status}`);
      return res.text();
    },
  };
}

function resolveItemDeps(
  itemName: string,
  registry: Registry,
  visited: Set<string>,
): { files: ResolvedFile[]; npm: Set<string> } {
  const result: { files: ResolvedFile[]; npm: Set<string> } = {
    files: [],
    npm: new Set(),
  };

  function walk(name: string) {
    if (visited.has(name)) return;
    visited.add(name);

    const item = registry.items.find((i) => i.name === name);
    if (!item) {
      p.log.warn(`Component "${name}" not found in registry`);
      return;
    }

    for (const dep of item.registryDependencies ?? []) {
      walk(dep);
    }

    for (const dep of item.dependencies ?? []) {
      result.npm.add(dep);
    }

    for (const file of item.files) {
      result.files.push({ path: file.path, type: file.type, target: file.target });
    }
  }

  walk(itemName);
  return result;
}

function computeTargetPath(file: ResolvedFile, cwd: string): string {
  if (file.target) return path.join(cwd, file.target);

  if (file.path.startsWith("registry/ui/")) {
    const fileName = path.basename(file.path);
    return path.join(cwd, "components", "ui", fileName);
  }
  if (file.path.startsWith("registry/lib/")) {
    return path.join(cwd, "lib", "utils.ts");
  }
  return path.join(cwd, file.path);
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function addAction(
  componentArg: string | undefined,
  options: { cwd: string; force: boolean; skipInstall: boolean },
): Promise<void> {
  const cwd = path.resolve(options.cwd);
  let componentName = componentArg;

  if (!fs.existsSync(path.join(cwd, "package.json"))) {
    p.outro(picocolors.red("No package.json found. Run this inside your project."));
    process.exit(1);
  }

  const source: RegistrySource = process.env.BIRRJS_DEV
    ? createLocalSource()
    : createGitHubSource();

  const registry = await source.getRegistry();

  if (!componentName) {
    const selected = await p.select({
      message: "Which component would you like to add?",
      options: registry.items
        .filter((i) => i.type === "registry:ui")
        .map((i) => ({ value: i.name, label: i.name })),
    });

    if (p.isCancel(selected)) {
      p.cancel("Aborted");
      process.exit(0);
    }

    componentName = selected as string;
  }

  const found = registry.items.find((i) => i.name === componentName);
  if (!found) {
    p.log.error(
      `Component "${componentName}" not found.\nAvailable: ${registry.items
        .filter((i) => i.type === "registry:ui")
        .map((i) => i.name)
        .join(", ")}`,
    );
    process.exit(1);
  }

  p.intro(picocolors.cyan(`Adding ${componentName} component`));

  const deps = resolveItemDeps(componentName, registry, new Set());
  const filesToWrite: { dest: string; content?: string }[] = [];

  for (const file of deps.files) {
    try {
      const raw = await source.getFile(file.path);
      const dest = computeTargetPath(file, cwd);

      let content = raw;
      if (
        file.type === "registry:ui" &&
        (file.path.endsWith(".tsx") || file.path.endsWith(".ts"))
      ) {
        content = raw.replaceAll('"../lib/utils"', '"../../lib/utils"');
      }

      filesToWrite.push({ dest, content });
    } catch {
      p.log.warn(`  ${picocolors.dim(file.path)} not found, skipping`);
    }
  }

  if (!options.force) {
    const existing = filesToWrite.filter((f) => fs.existsSync(f.dest));
    if (existing.length > 0) {
      p.log.warn(
        `These files already exist:\n${existing.map((f) => `  ${picocolors.dim(path.relative(cwd, f.dest))}`).join("\n")}`,
      );
      const proceed = await p.confirm({
        message: "Overwrite existing files?",
      });
      if (p.isCancel(proceed)) {
        p.cancel("Aborted");
        process.exit(0);
      }
      if (!proceed) {
        p.outro("Skipped — no files written");
        process.exit(0);
      }
    }
  }

  const spinner = p.spinner();
  spinner.start("Copying files");

  for (const file of filesToWrite) {
    ensureDir(file.dest);
    fs.writeFileSync(file.dest, file.content ?? "", "utf-8");
  }

  spinner.stop(`Copied ${String(filesToWrite.length)} file${filesToWrite.length === 1 ? "" : "s"}`);

  if (!options.skipInstall && deps.npm.size > 0) {
    const depsToInstall = [...deps.npm].filter((pkg) => !isPackageInstalled(cwd, pkg));
    if (depsToInstall.length > 0) {
      const pm = await detectPackageManager(cwd);
      const installCmd = getInstallCommand(pm, depsToInstall);
      const installSpinner = p.spinner();
      installSpinner.start(`Installing ${depsToInstall.join(", ")} via ${pm}`);
      try {
        await execAsync(installCmd, {
          cwd,
          env: { ...process.env, NODE_ENV: "" },
        });
        installSpinner.stop(`Installed ${depsToInstall.join(", ")} via ${pm}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        installSpinner.stop(picocolors.yellow("Could not install dependencies"));
        p.log.message(`  ${picocolors.dim(msg)}\n  Run manually: ${picocolors.bold(installCmd)}`);
      }
    }
  }

  const createdList = filesToWrite
    .map((f) => `  ${picocolors.dim(path.relative(cwd, f.dest))}`)
    .join("\n");
  p.log.success(`Created files:\n${createdList}`);

  const b = picocolors.bold;
  const c = picocolors.cyan;
  const pm = await detectPackageManager(cwd);
  const exec = getExecPrefix(pm);
  p.outro(
    [
      `Added ${b(componentName)} to your project.`,
      "",
      `   ${c("Tip:")} Import from ${b(`@/components/ui/${componentName}`)}`,
      `      ${b(`${exec} birrjs add`)} to add more components`,
      "",
    ].join("\n"),
  );
}

export const addCommand = new Command("add")
  .description("Add a BirrJS React UI component to your project")
  .argument("[component]", "component name (bank-payment-card, reference-input, payment-block)")
  .option(
    "-c, --cwd <cwd>",
    "the working directory. defaults to the current directory.",
    process.cwd(),
  )
  .option("--force", "overwrite existing files without prompting", false)
  .option("--skip-install", "skip installing dependencies", false)
  .action(addAction);
