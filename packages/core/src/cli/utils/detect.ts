import { resolveCommand } from "package-manager-detector/commands";
import { detect } from "package-manager-detector/detect";

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
