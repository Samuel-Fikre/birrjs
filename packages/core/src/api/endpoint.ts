import { createEndpoint, createMiddleware } from "better-call";
import type { BirrJSContext } from "../context";
import type { z } from "zod";

const birrjsMiddleware = createMiddleware(async () => {
  return {} as BirrJSContext;
});

export const createBirrJSEndpoint: ReturnType<
  typeof createEndpoint.create<{ use: [typeof birrjsMiddleware] }>
> = createEndpoint.create({
  use: [birrjsMiddleware],
});

type BetterCallOptions = Parameters<typeof createBirrJSEndpoint>[1];

export interface BirrJSMethodRouteConfig {
  method: NonNullable<BetterCallOptions["method"]>;
  path: string;
}

export interface BirrJSMethodConfig {
  input?: z.ZodType;
  route?: BirrJSMethodRouteConfig;
}

type InferInput<TInput> = TInput extends z.ZodType ? z.infer<TInput> : TInput;

export type BirrJSMethodContext<TInput> = {
  birrjs: BirrJSContext;
  input: InferInput<TInput>;
};

export type BirrJSMethod<TInput, TResult> = {
  (birrjs: BirrJSContext, input: InferInput<TInput>): Promise<TResult>;
  endpoint?: { options: unknown; path: string };
};

export function defineBirrJSMethod<const TConfig extends BirrJSMethodConfig, TResult>(
  config: TConfig,
  handler: (ctx: BirrJSMethodContext<TConfig["input"]>) => Promise<TResult>,
): BirrJSMethod<TConfig["input"], TResult> {
  const call = async (
    birrjs: BirrJSContext,
    input: InferInput<TConfig["input"]>,
  ): Promise<TResult> => {
    const validatedInput = config.input
      ? (config.input.parse(input) as InferInput<TConfig["input"]>)
      : input;
    return handler({ birrjs, input: validatedInput });
  };

  if (config.route) {
    const endpoint = createBirrJSEndpoint(
      config.route.path,
      {
        body: config.input,
        method: config.route.method,
      },
      async (ctx) => {
        const input = ctx.body as InferInput<TConfig["input"]>;
        return handler({ birrjs: ctx.context, input });
      },
    );

    call.endpoint = endpoint as unknown as { options: unknown; path: string };
  }

  return call as unknown as BirrJSMethod<TConfig["input"], TResult> & {
    endpoint?: { options: unknown; path: string };
  };
}
