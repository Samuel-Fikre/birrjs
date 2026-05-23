import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

import fs from "node:fs";
import path from "node:path";

import * as p from "@clack/prompts";
import { Command } from "@commander-js/extra-typings";
import picocolors from "picocolors";

import type { Framework } from "../configs/frameworks.config";
import { FRAMEWORKS } from "../configs/frameworks.config";
import { templates } from "../templates/index";
import {
  defaultConfigPath,
  detectFramework,
  detectNextJsRouterPath,
  detectPackageManager,
  getExecPrefix,
  getInstallCommand,
  isPackageInstalled,
  resolveImportPath,
} from "../utils/detect";
import {
  createEnvFile,
  getEnvFiles,
  getMissingEnvVars,
  parseEnvFiles,
  updateEnvFiles,
} from "../utils/env";

const POSSIBLE_CONFIG_PATHS = buildPossiblePaths(["birrjs.ts", "birrjs.config.ts"]);
const POSSIBLE_CLIENT_PATHS = buildPossiblePaths(["birrjs-client.ts"]);

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function buildPossiblePaths(basePaths: string[]): string[] {
  const dirs = ["", "lib/", "server/", "utils/"];
  const withDirs = dirs.flatMap((dir) => basePaths.map((p) => `${dir}${p}`));
  return [...withDirs, ...withDirs.map((p) => `src/${p}`)];
}

function findExistingFile(cwd: string, candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(cwd, candidate))) {
      return candidate;
    }
  }
  return null;
}

function generateConfigFile(templateId: string, includeIdentify: boolean): string {
  const planImports =
    templateId === "saas-starter" || templateId === "usage-based" ? "free, pro" : "";

  const plansLine = planImports ? `\n  plans: [${planImports}],` : "\n  plans: [],";
  const importLine = planImports ? `\nimport { ${planImports} } from "./birrjs-plans";` : "";

  const identifyBlock = includeIdentify
    ? `
  identify: async (request) => {
    // Replace with your auth logic, for example:
    // const session = await auth.api.getSession({ headers: request.headers });
    // if (!session) return null;
    // return {
    //   customerId: session.user.id,
    //   email: session.user.email,
    //   name: session.user.name,
    // };
    return null;
  },`
    : "";

  return `import { chapa } from "@birrjs/chapa";
import { createBirr } from "@birrjs/core";${importLine}

export const birrjs = createBirr({
  database: process.env.DATABASE_URL!,
  callbackUrl: process.env.CALLBACK_URL!,
  provider: chapa({
    secretKey: process.env.CHAPA_SECRET_KEY!,
    webhookSecret: process.env.CHAPA_WEBHOOK_SECRET!,
  }),${plansLine}${identifyBlock}
});
`;
}

function generateRouteHandler(
  configPath: string,
  routePath: string,
  cwd: string,
  framework: Framework,
): string {
  if (!framework.routeHandler) return "";

  const importPath = resolveImportPath(routePath, configPath, cwd, framework);

  let code: string = framework.routeHandler.code;
  const importPatterns = [
    /from\s+["']@\/[^"']+["']/,
    /from\s+["']~\/[^"']+["']/,
    /from\s+["']\$lib\/[^"']+["']/,
    /from\s+["']\.\/[^"']+["']/,
    /from\s+["']\.\.\/[^"']+["']/,
  ];

  for (const pattern of importPatterns) {
    const replaced = code.replace(pattern, `from "${importPath}"`);
    if (replaced !== code) {
      code = replaced;
      break;
    }
  }

  return code + "\n";
}

function generateClientFile(
  configPath: string,
  clientPath: string,
  cwd: string,
  framework: Framework,
): string {
  const importPath = resolveImportPath(clientPath, configPath, cwd, framework);

  return `import { createBirrJSClient } from "@birrjs/core";
import type { birrjs } from "${importPath}";

export const birrjsClient = createBirrJSClient<typeof birrjs>();
`;
}

interface FileToWrite {
  path: string;
  content: string;
}

const ENV_VARS = [
  { key: "DATABASE_URL", line: "DATABASE_URL=" },
  { key: "CHAPA_SECRET_KEY", line: "CHAPA_SECRET_KEY=" },
  { key: "CHAPA_WEBHOOK_SECRET", line: "CHAPA_WEBHOOK_SECRET=" },
  { key: "CALLBACK_URL", line: "CALLBACK_URL=" },
];

function frameworksList(): string {
  const c = picocolors.cyan;
  const dot = picocolors.dim(" · ");
  const row1 = ["Next.js", "Tanstack Start", "Hono", "Express", "Elysia"].map(c).join(dot);
  const row2 = [
    "Remix",
    "Astro",
    "SvelteKit",
    "Nuxt",
    "Solid Start",
    "React Router",
    "Fastify",
    "Nitro",
  ]
    .map(c)
    .join(dot);
  return [`   ${picocolors.bold("Supported frameworks:")}`, `     ${row1}`, `     ${row2}`].join(
    "\n",
  );
}

function checkFileConflict(
  cwd: string,
  filePath: string,
  force: boolean,
): "overwrite" | "skip" | "abort" {
  const fullPath = path.join(cwd, filePath);
  if (!fs.existsSync(fullPath)) return "overwrite";

  if (force) return "overwrite";

  p.log.warn(`${picocolors.dim(filePath)} already exists`);
  return "skip";
}

async function initAction(options: {
  cwd: string;
  defaults: boolean;
  skipInstall: boolean;
  force: boolean;
}): Promise<void> {
  const cwd = path.resolve(options.cwd);
  const useDefaults = options.defaults;
  const skipInstall = options.skipInstall;
  const force = options.force;

  if (!fs.existsSync(path.join(cwd, "package.json"))) {
    p.outro(
      [
        picocolors.red("BirrJS must be initialized inside a project."),
        "",
        "   No package.json found in this directory.",
        "",
        frameworksList(),
      ].join("\n"),
    );
    process.exit(1);
  }

  let detectedFramework = detectFramework(cwd);

  if (!detectedFramework) {
    const selected = await p.select({
      message: "Could not auto-detect your framework. Select manually:",
      options: [
        ...FRAMEWORKS.map((f) => ({ value: f.id, label: f.name })),
        { value: null, label: "None of the above" },
      ],
    });

    if (p.isCancel(selected)) {
      p.cancel("Aborted");
      process.exit(0);
    }

    if (!selected) {
      p.cancel(
        `BirrJS currently supports:\n  ${FRAMEWORKS.filter((f) => f.routeHandler)
          .map((f) => f.name)
          .join(", ")}`,
      );
      process.exit(1);
    }

    detectedFramework = FRAMEWORKS.find((f) => f.id === selected)!;
  }

  p.intro(picocolors.cyan("Welcome to BirrJS! Let's set up billing, one birr at a time."));

  let framework: Framework = detectedFramework;
  p.log.step(`Detected framework: ${picocolors.bold(framework.name)}`);

  const existingConfig = findExistingFile(cwd, POSSIBLE_CONFIG_PATHS);
  const existingClient = findExistingFile(cwd, POSSIBLE_CLIENT_PATHS);

  let provider: string | symbol = "chapa";
  if (!existingConfig && !useDefaults) {
    provider = await p.select({
      message: "Select payment provider",
      options: [
        { value: "chapa", label: "Chapa" },
        { value: "arifpay", label: "ArifPay", hint: "coming soon", disabled: true },
      ],
    });

    if (p.isCancel(provider)) {
      p.cancel("Aborted");
      process.exit(0);
    }
  }

  const envFiles = getEnvFiles(cwd);
  const envVarsToAdd = ENV_VARS.map((v) => v.key);

  if (envFiles.length > 0) {
    const parsed = parseEnvFiles(envFiles);
    const missingPerFile = getMissingEnvVars(parsed, envVarsToAdd);

    if (missingPerFile.length > 0) {
      for (const { file, missing } of missingPerFile) {
        if (missing.length === 0) continue;
        updateEnvFiles(
          [file],
          missing.map((key) => `${key}=`),
        );
      }

      const allMissing = [...new Set(missingPerFile.flatMap((f) => f.missing))];
      const varList = allMissing.map((v) => `  ${picocolors.dim(`${v}=`)}`).join("\n");
      p.log.success(`Added missing env vars:\n${varList}`);
    }
  } else {
    const lines = ENV_VARS.map((v) => v.line);
    createEnvFile(cwd, lines);
    p.log.success(`Created .env with ${String(ENV_VARS.length)} variables`);
  }

  if (framework.id === "next" && framework.routeHandler) {
    const routeHandlerPath = detectNextJsRouterPath(cwd);
    framework = {
      ...framework,
      routeHandler: {
        ...framework.routeHandler,
        path: routeHandlerPath,
      },
    } as Framework;
  }

  const configDefault = defaultConfigPath(cwd);
  let configPath: string;
  if (existingConfig) {
    configPath = existingConfig;
  } else if (useDefaults) {
    configPath = configDefault;
  } else {
    const result = await p.text({
      message: "Path for the BirrJS instance",
      defaultValue: configDefault,
      placeholder: configDefault,
      validate: (value) => {
        const v = value || configDefault;
        if (!v.endsWith("/birrjs.ts") && v !== "birrjs.ts") return "Filename must be birrjs.ts";
        if (v.startsWith("/")) return "Path must be relative";
        return undefined;
      },
    });

    if (p.isCancel(result)) {
      p.cancel("Aborted");
      process.exit(0);
    }
    configPath = result;
  }

  let routePath: string | null = null;
  if (framework.routeHandler) {
    const routeDefault = framework.routeHandler.path;
    const routeFullPath = path.join(cwd, routeDefault);

    if (!fs.existsSync(routeFullPath) || force) {
      if (useDefaults) {
        routePath = routeDefault;
      } else {
        const result = await p.text({
          message: "Path for the route handler",
          defaultValue: routeDefault,
          placeholder: routeDefault,
        });

        if (p.isCancel(result)) {
          p.cancel("Aborted");
          process.exit(0);
        }
        routePath = result;
      }
    }
  } else if (!existingConfig) {
    p.note(
      "See the docs for manual route handler setup:\nhttps://birrjs.dev/docs/setup",
      "Manual Setup",
    );
  }

  let clientPath: string | null = null;
  if (!existingClient && framework.authClient) {
    const configDir = path.dirname(configPath);
    const clientDefault = path.join(configDir, "birrjs-client.ts");

    if (useDefaults) {
      clientPath = clientDefault;
    } else {
      const generateClient = await p.confirm({
        message: "Wanna use BirrJS client caller?",
      });

      if (p.isCancel(generateClient)) {
        p.cancel("Aborted");
        process.exit(0);
      }

      if (generateClient) {
        const result = await p.text({
          message: "Path for the client instance",
          defaultValue: clientDefault,
          placeholder: clientDefault,
        });

        if (p.isCancel(result)) {
          p.cancel("Aborted");
          process.exit(0);
        }
        clientPath = result;
      }
    }
  }

  const plansPath = configPath.replace(/birrjs(\.config)?\.ts$/, "birrjs-plans.ts");
  const plansFullPath = path.join(cwd, plansPath);
  let templateId: string | symbol = "saas-starter";

  if (!fs.existsSync(plansFullPath) && !useDefaults) {
    templateId = await p.select({
      message: "Select pricing template",
      options: templates.map((t) => ({
        value: t.id,
        label: t.name,
        hint: t.hint,
      })),
    });

    if (p.isCancel(templateId)) {
      p.cancel("Aborted");
      process.exit(0);
    }
  }

  if (!skipInstall) {
    const packages = ["@birrjs/core", "@birrjs/chapa"];
    const toInstall = packages.filter((pkg) => !isPackageInstalled(cwd, pkg));

    if (toInstall.length > 0) {
      const pm = await detectPackageManager(cwd);
      const installCmd = getInstallCommand(pm, toInstall);
      const spinner = p.spinner();
      spinner.start(`Installing ${toInstall.join(", ")} via ${pm}`);
      try {
        await execAsync(installCmd, {
          cwd,
          env: { ...process.env, NODE_ENV: "" },
        });
        spinner.stop(`Installed ${toInstall.join(", ")} via ${pm}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        spinner.stop(picocolors.yellow("Could not install dependencies"));
        p.log.message(`  ${picocolors.dim(msg)}\n  Run manually: ${picocolors.bold(installCmd)}`);
      }
    }
  }

  const files: FileToWrite[] = [];

  if (!existingConfig) {
    const conflict = checkFileConflict(cwd, configPath, force);
    if (conflict === "overwrite") {
      files.push({
        path: configPath,
        content: generateConfigFile(templateId as string, clientPath !== null),
      });
    }
  }

  if (!fs.existsSync(plansFullPath) || force) {
    const template = templates.find((t) => t.id === templateId);
    if (template) {
      const conflict = checkFileConflict(cwd, plansPath, force);
      if (conflict === "overwrite") {
        files.push({ path: plansPath, content: template.content });
      }
    }
  }

  if (routePath) {
    const conflict = checkFileConflict(cwd, routePath, force);
    if (conflict === "overwrite") {
      files.push({
        path: routePath,
        content: generateRouteHandler(configPath, routePath, cwd, framework),
      });
    }
  }

  if (clientPath) {
    const conflict = checkFileConflict(cwd, clientPath, force);
    if (conflict === "overwrite") {
      files.push({
        path: clientPath,
        content: generateClientFile(configPath, clientPath, cwd, framework),
      });
    }
  }

  for (const file of files) {
    const fullPath = path.join(cwd, file.path);
    ensureDir(fullPath);
    fs.writeFileSync(fullPath, file.content);
  }

  if (files.length > 0) {
    const fileList = files.map((f) => `  ${picocolors.dim(f.path)}`).join("\n");
    p.log.success(
      `Created ${String(files.length)} file${files.length === 1 ? "" : "s"}:\n${fileList}`,
    );
  }

  const pm = await detectPackageManager(cwd);
  const exec = getExecPrefix(pm);
  const c = picocolors.cyan;
  const b = picocolors.bold;

  const isRerun = files.length === 0 && (existingConfig || existingClient);
  const heading = isRerun
    ? picocolors.green("BirrJS is already initialized!")
    : picocolors.green("BirrJS setup completed!");

  p.outro(
    [
      heading,
      "",
      `   ${b("Next steps")}`,
      `   ${c("1.")} Fill in .env variables`,
      `   ${c("2.")} Sync your products ${b(`${exec} birrjs push`)}`,
      "",
      `   You're good to use BirrJS!`,
      "",
      `   ${b("Commands")}`,
      `   ${c("•")} Check status: ${b(`${exec} birrjs status`)}`,
      `   ${c("•")} Sync updated products: ${b(`${exec} birrjs push`)}`,
      "",
    ].join("\n"),
  );
}

export const initCommand = new Command("init")
  .description("Initialize BirrJS in your project")
  .option(
    "-c, --cwd <cwd>",
    "the working directory. defaults to the current directory.",
    process.cwd(),
  )
  .option("-y, --defaults", "skip prompts and use defaults", false)
  .option("--skip-install", "skip installing dependencies", false)
  .option("--force", "overwrite existing files without prompting", false)
  .action(initAction);
