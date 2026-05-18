import fs from "node:fs";
import path from "node:path";

export function getEnvFiles(cwd: string): string[] {
  try {
    const files = fs.readdirSync(cwd);
    return files
      .filter((file) => file.startsWith(".env") && file !== ".env.example")
      .map((file) => path.join(cwd, file));
  } catch {
    return [];
  }
}

export function parseEnvFiles(envFiles: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const file of envFiles) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const existingVars = content
      .split("\n")
      .filter((line) => line.trim())
      .map((x) => x.split("=")[0])
      .filter((x): x is string => Boolean(x?.trim()))
      .filter((x) => !x.includes(" "))
      .filter((x) => !x.startsWith("#"));
    result.set(file, existingVars);
  }
  return result;
}

export function getMissingEnvVars(
  envFiles: Map<string, string[]>,
  vars: string[],
): { file: string; missing: string[] }[] {
  const result: { file: string; missing: string[] }[] = [];
  for (const [file, existingVars] of envFiles) {
    const missing = vars.filter((v) => !existingVars.includes(v));
    if (missing.length > 0) {
      result.push({ file, missing });
    }
  }
  return result;
}

export function updateEnvFiles(envFiles: string[], lines: string[]): void {
  for (const file of envFiles) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    if (content.length > 0 && !content.endsWith("\n")) {
      content += "\n";
    }
    content += lines.join("\n") + "\n";
    try {
      fs.writeFileSync(file, content);
    } catch {
      // Skip files we can't write to
    }
  }
}

export function createEnvFile(cwd: string, lines: string[]): void {
  const envFile = path.join(cwd, ".env");
  try {
    fs.writeFileSync(envFile, lines.join("\n") + "\n");
  } catch (error) {
    throw new Error(`Failed to create .env file at ${envFile}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}
