type PackageTsdownOptions = {
  entry: Record<string, string>;
  copy?: Array<{ from: string; flatten?: boolean }>;
};

export function createPackageTsdownConfig(options: PackageTsdownOptions) {
  return {
    clean: true,
    copy: options.copy,
    deps: {
      skipNodeModulesBundle: true,
    },
    dts: true,
    entry: options.entry,
    fixedExtension: false,
    format: "esm" as const,
    outDir: "dist",
    platform: "node" as const,
    target: "node24",
    unbundle: true,
  };
}
