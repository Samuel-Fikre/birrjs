export const FRAMEWORKS = [
  {
    name: "Next.js",
    id: "next",
    dependency: "next",
    authClient: {
      importPath: "@birrjs/core",
    },
    routeHandler: {
      path: "api/birrjs/[...slug]/route.ts",
      code: `import { birrHandler } from "@birrjs/core";

import { birrjs } from "@/lib/birrjs";

export const { GET, POST } = birrHandler(birrjs);`,
    },
    configPaths: ["next.config.js", "next.config.ts", "next.config.mjs"],
  },
  {
    name: "Nuxt",
    id: "nuxt",
    dependency: "nuxt",
    authClient: {
      importPath: "@birrjs/core",
    },
    routeHandler: {
      path: "server/api/birrjs/[...slug].ts",
      code: `import { birrjs } from "~/lib/birrjs";

export default defineEventHandler((event) => {
  return birrjs.handler(toWebRequest(event));
});`,
    },
    configPaths: ["nuxt.config.js", "nuxt.config.ts", "nuxt.config.mjs", "nuxt.config.cjs"],
  },
  {
    name: "SvelteKit",
    id: "sveltekit",
    dependency: "@sveltejs/kit",
    authClient: {
      importPath: "@birrjs/core",
    },
    routeHandler: {
      path: "src/routes/api/birrjs/[...slug]/+server.ts",
      code: `import { birrjs } from "$lib/birrjs";

export const GET = ({ request }) => birrjs.handler(request);
export const POST = ({ request }) => birrjs.handler(request);`,
    },
    configPaths: ["svelte.config.js", "svelte.config.ts", "svelte.config.mjs", "svelte.config.cjs"],
  },
  {
    name: "Solid Start",
    id: "solid-start",
    dependency: "@solidjs/start",
    authClient: {
      importPath: "@birrjs/core",
    },
    routeHandler: {
      path: "src/routes/api/birrjs/*slug.ts",
      code: `import { birrjs } from "~/lib/birrjs";

export const GET = ({ request }) => birrjs.handler(request);
export const POST = ({ request }) => birrjs.handler(request);`,
    },
    configPaths: ["app.config.ts"],
  },
  {
    name: "Tanstack Start",
    id: "tanstack-start",
    dependency: "@tanstack/react-start",
    authClient: {
      importPath: "@birrjs/core",
    },
    routeHandler: {
      path: "src/routes/api/birrjs.$.ts",
      code: `import { birrjs } from "@/lib/birrjs";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/birrjs/$")({
  server: {
    handlers: {
      GET: ({ request }) => birrjs.handler(request),
      POST: ({ request }) => birrjs.handler(request),
    },
  },
});`,
    },
    configPaths: null,
  },
  {
    name: "Astro",
    id: "astro",
    dependency: "astro",
    authClient: {
      importPath: "@birrjs/core",
    },
    routeHandler: {
      path: "src/pages/api/birrjs/[...slug].ts",
      code: `import { birrjs } from "@/lib/birrjs";
import type { APIRoute } from "astro";

export const ALL: APIRoute = async (ctx) => {
  return birrjs.handler(ctx.request);
};`,
    },
    configPaths: ["astro.config.mjs", "astro.config.ts", "astro.config.js", "astro.config.cjs"],
  },
  {
    name: "Remix",
    id: "remix",
    dependency: "@remix-run/react",
    authClient: {
      importPath: "@birrjs/core",
    },
    routeHandler: {
      path: "app/routes/api.birrjs.$.ts",
      code: `import { birrjs } from "~/lib/birrjs";

export const loader = ({ request }) => birrjs.handler(request);
export const action = ({ request }) => birrjs.handler(request);`,
    },
    configPaths: ["remix.config.js"],
  },
  {
    name: "React Router v7",
    id: "react-router-v7",
    dependency: "react-router",
    authClient: {
      importPath: "@birrjs/core",
    },
    routeHandler: {
      path: "app/routes/api.birrjs.$.ts",
      code: `import { birrjs } from "~/lib/birrjs";

export const loader = ({ request }) => birrjs.handler(request);
export const action = ({ request }) => birrjs.handler(request);`,
    },
    configPaths: ["react-router.config.ts"],
  },
  {
    name: "Hono",
    id: "hono",
    dependency: "hono",
    authClient: null,
    routeHandler: null,
    configPaths: null,
  },
  {
    name: "Fastify",
    id: "fastify",
    dependency: "fastify",
    authClient: null,
    routeHandler: null,
    configPaths: null,
  },
  {
    name: "Express",
    id: "express",
    dependency: "express",
    authClient: null,
    routeHandler: null,
    configPaths: null,
  },
  {
    name: "Elysia",
    id: "elysia",
    dependency: "elysia",
    authClient: null,
    routeHandler: {
      path: "src/api/birrjs.ts",
      code: `import { Elysia } from "elysia";
import { birrjs } from "../lib/birrjs";

const app = new Elysia();

app.all("/api/birrjs/*", ({ request }) => birrjs.handler(request));

export { app };`,
    },
    configPaths: null,
  },
  {
    name: "Nitro",
    id: "nitro",
    dependency: "nitro",
    authClient: null,
    routeHandler: null,
    configPaths: ["nitro.config.ts"],
  },
] as const satisfies {
  name: string;
  id: string;
  dependency: string;
  authClient: {
    importPath: string;
  } | null;
  routeHandler: {
    path: string;
    code: string;
  } | null;
  configPaths: string[] | null;
}[];

export type Framework = (typeof FRAMEWORKS)[number];
