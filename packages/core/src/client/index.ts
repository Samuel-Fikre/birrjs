import { createFetch } from "@better-fetch/fetch";

export interface BirrJSClientOptions {
  baseURL?: string;
}

export function createBirrJSClient(options?: BirrJSClientOptions) {
  const baseURL = options?.baseURL ?? "/api";
  const isCredentialsSupported =
    typeof globalThis.Request !== "undefined" && "credentials" in Request.prototype;

  const $fetch = createFetch({
    baseURL,
    throw: true,
    ...(isCredentialsSupported ? { credentials: "include" as const } : {}),
  });

  function createProxy(path: string[] = []): unknown {
    return new Proxy(function () {}, {
      get(_, prop) {
        if (typeof prop !== "string") return undefined;
        if (prop === "then" || prop === "catch" || prop === "finally") return undefined;
        return createProxy([...path, prop]);
      },
      apply: async (_, __, args) => {
        const routePath =
          "/" + path.map((s) => s.replace(/[A-Z]/g, (l) => `-${l.toLowerCase()}`)).join("/");
        const body = (args[0] as Record<string, unknown>) ?? {};

        return $fetch(routePath, {
          method: "POST",
          body,
        });
      },
    });
  }

  return createProxy();
}
