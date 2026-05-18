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
    const content = fs.readFileSync(file, "utf-8");
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
    let content = fs.readFileSync(file, "utf-8");
    if (content.length > 0 && !content.endsWith("\n")) {
      content += "\n";
    }
    content += lines.join("\n") + "\n";
    fs.writeFileSync(file, content);
  }
}

export function createEnvFile(cwd: string, lines: string[]): void {
  const envFile = path.join(cwd, ".env");
  fs.writeFileSync(envFile, lines.join("\n") + "\n");
}
