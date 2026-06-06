import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();
const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");

/** @type {import("next").NextConfig} */
const config = {
  devIndicators: {
    position: "bottom-right",
  },
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
  },
  redirects: async () => [
    { source: "/github", destination: "https://github.com/Samuel-Fikre/birrjs", permanent: false },
    { source: "/telegram", destination: "https://t.me/birrjs", permanent: false },
  ],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default withMDX(config);
