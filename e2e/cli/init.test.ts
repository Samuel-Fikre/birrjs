import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect, afterEach } from "vitest";

const cliBin = path.resolve(import.meta.dirname, "../../packages/core/dist/cli/index.js");

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createInitFixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "birrjs-init-test-"));
  temporaryDirectories.push(cwd);

  fs.writeFileSync(
    path.join(cwd, "package.json"),
    JSON.stringify({ name: "test-app", dependencies: { next: "^15.0.0" } }, null, 2),
  );
  fs.mkdirSync(path.join(cwd, "src", "app", "api", "birrjs", "[...slug]"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "src", "lib"), { recursive: true });

  return { cwd };
}

function runInit(cwd: string, provider?: string) {
  const providerFlag = provider ? ` --provider ${provider}` : "";
  execSync(`node "${cliBin}" init --defaults --skip-install${providerFlag} --cwd "${cwd}"`, {
    cwd,
    stdio: "pipe",
    env: { ...process.env, NODE_ENV: "production" },
  });
}

describe("birrjs init scaffolding", () => {
  it("generates config, plans, route handler, and .env", async () => {
    const { cwd } = createInitFixture();

    runInit(cwd);

    // Config file
    const configPath = path.join(cwd, "src/lib/birrjs.ts");
    expect(fs.existsSync(configPath)).toBe(true);
    const configContent = fs.readFileSync(configPath, "utf-8");
    expect(configContent).toContain("createBirr");
    expect(configContent).toContain("chapa");
    expect(configContent).toContain("DATABASE_URL");
    expect(configContent).toContain("plans:");

    // Plans file
    const plansPath = path.join(cwd, "src/lib/birrjs-plans.ts");
    expect(fs.existsSync(plansPath)).toBe(true);
    const plansContent = fs.readFileSync(plansPath, "utf-8");
    expect(plansContent).toContain('id: "free"');
    expect(plansContent).toContain('id: "pro"');

    // Route handler
    const routePath = path.join(cwd, "src/app/api/birrjs/[...slug]/route.ts");
    expect(fs.existsSync(routePath)).toBe(true);
    const routeContent = fs.readFileSync(routePath, "utf-8");
    expect(routeContent).toContain("GET");
    expect(routeContent).toContain("POST");

    // .env file
    const envPath = path.join(cwd, ".env");
    expect(fs.existsSync(envPath)).toBe(true);
    const envContent = fs.readFileSync(envPath, "utf-8");
    expect(envContent).toContain("DATABASE_URL=");
    expect(envContent).toContain("CHAPA_SECRET_KEY=");
    expect(envContent).toContain("CHAPA_WEBHOOK_SECRET=");
    expect(envContent).toContain("CALLBACK_URL=");
  });

  it("generates Vodit config when --provider vodit", async () => {
    const { cwd } = createInitFixture();

    runInit(cwd, "vodit");

    // Config file — Vodit-specific
    const configPath = path.join(cwd, "src/lib/birrjs.ts");
    expect(fs.existsSync(configPath)).toBe(true);
    const configContent = fs.readFileSync(configPath, "utf-8");
    expect(configContent).toContain("vodit");
    expect(configContent).toContain("@birrjs/vodit");
    expect(configContent).toContain("VODIT_API_KEY");
    expect(configContent).not.toContain("chapa");
    expect(configContent).not.toContain("CHAPA_SECRET_KEY");

    // Plans file (provider-agnostic)
    const plansPath = path.join(cwd, "src/lib/birrjs-plans.ts");
    expect(fs.existsSync(plansPath)).toBe(true);
    const plansContent = fs.readFileSync(plansPath, "utf-8");
    expect(plansContent).toContain('id: "free"');
    expect(plansContent).toContain('id: "pro"');

    // Route handler (provider-agnostic)
    const routePath = path.join(cwd, "src/app/api/birrjs/[...slug]/route.ts");
    expect(fs.existsSync(routePath)).toBe(true);
    const routeContent = fs.readFileSync(routePath, "utf-8");
    expect(routeContent).toContain("GET");
    expect(routeContent).toContain("POST");

    // .env — Vodit-specific, no Chapa vars
    const envPath = path.join(cwd, ".env");
    expect(fs.existsSync(envPath)).toBe(true);
    const envContent = fs.readFileSync(envPath, "utf-8");
    expect(envContent).toContain("VODIT_API_KEY=");
    expect(envContent).not.toContain("CHAPA_SECRET_KEY=");
  });

  it("does not overwrite existing config files", async () => {
    const { cwd } = createInitFixture();

    const configPath = path.join(cwd, "src/lib/birrjs.ts");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, "// existing config\n");

    runInit(cwd);

    const content = fs.readFileSync(configPath, "utf-8");
    expect(content).toBe("// existing config\n");
  });

  it("does not duplicate env vars that already exist", async () => {
    const { cwd } = createInitFixture();

    const envPath = path.join(cwd, ".env");
    fs.writeFileSync(envPath, "DATABASE_URL=postgres://localhost/test\n");

    runInit(cwd);

    const content = fs.readFileSync(envPath, "utf-8");
    expect(content.split("DATABASE_URL=").length - 1).toBe(1);
  });
});
