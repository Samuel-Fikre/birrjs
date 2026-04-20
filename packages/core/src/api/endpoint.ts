import { createEndpoint, createMiddleware } from "better-call";
import type { BirrJSContext } from "../context";
import type { z } from "zod";
import { BirrJSError, BIRRJS_ERROR_CODES } from "../core/error-codes";

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
  requireHeaders?: boolean;
  use?: ReturnType<typeof createMiddleware>[];
}

export interface BirrJSMethodConfig {
  input?: z.ZodType;
  route?: BirrJSMethodRouteConfig;
  requireCustomer?: boolean;
  resolveServerCustomerId?: (input: unknown) => string | undefined;
}

type InferInput<TInput> = TInput extends z.ZodType ? z.infer<TInput> : TInput;

type InferRequireCustomer<TConfig extends BirrJSMethodConfig> = TConfig extends {
  requireCustomer: true;
}
  ? true
  : false;

type OptionalCustomer<TRequireCustomer extends boolean> = TRequireCustomer extends true
  ? { customerId: string }
  : { customerId?: undefined };

export type BirrJSMethodContext<
  TInput,
  TRequireCustomer extends boolean = false,
  TParams = Record<string, string> | undefined,
> = {
  birrjs: BirrJSContext;
  input: InferInput<TInput>;
  headers?: Headers;
  request?: Request;
  params: TParams;
} & OptionalCustomer<TRequireCustomer>;

async function resolveCustomer(
  ctx: BirrJSContext,
  request: Request | undefined,
  explicitCustomerId?: string,
): Promise<{ customerId: string }> {
  if (ctx.options.identify && request) {
    const identity = await ctx.options.identify(request);

    if (!identity || !identity.customerId) {
      throw BirrJSError.from("UNAUTHORIZED", BIRRJS_ERROR_CODES.IDENTIFY_REQUIRED);
    }

    if (explicitCustomerId && explicitCustomerId !== identity.customerId) {
      throw BirrJSError.from("FORBIDDEN", BIRRJS_ERROR_CODES.CUSTOMER_ID_MISMATCH);
    }

    return { customerId: identity.customerId };
  }

  if (request) {
    throw BirrJSError.from("UNAUTHORIZED", BIRRJS_ERROR_CODES.IDENTIFY_REQUIRED);
  }

  if (explicitCustomerId) {
    return { customerId: explicitCustomerId };
  }

  throw BirrJSError.from("UNAUTHORIZED", BIRRJS_ERROR_CODES.IDENTIFY_REQUIRED);
}

export type BirrJSMethod<TInput, TResult> = {
  (birrjs: BirrJSContext, input: InferInput<TInput>): Promise<TResult>;
  endpoint?: { options: unknown; path: string };
};

export function defineBirrJSMethod<const TConfig extends BirrJSMethodConfig, TResult>(
  config: TConfig,
  handler: (
    ctx: BirrJSMethodContext<TConfig["input"], InferRequireCustomer<TConfig>>,
  ) => Promise<TResult>,
): BirrJSMethod<TConfig["input"], TResult> {
  const call = async (
    birrjs: BirrJSContext,
    input: InferInput<TConfig["input"]>,
    request?: Request,
  ): Promise<TResult> => {
    const validatedInput = config.input
      ? (config.input.parse(input) as InferInput<TConfig["input"]>)
      : input;

    const customer = config.requireCustomer
      ? await resolveCustomer(birrjs, request, config.resolveServerCustomerId?.(input))
      : undefined;

    return handler({
      birrjs,
      input: validatedInput,
      ...(customer ? { customerId: customer.customerId } : {}),
      params: {} as Record<string, string>,
    } as BirrJSMethodContext<TConfig["input"], InferRequireCustomer<TConfig>>);
  };

  if (config.route) {
    const endpoint = createBirrJSEndpoint(
      config.route.path,
      {
        body: config.input,
        method: config.route.method,
        requireHeaders: config.route.requireHeaders,
        use: config.route.use,
      },
      async (ctx) => {
        const input = ctx.body as InferInput<TConfig["input"]>;

        const customer = config.requireCustomer
          ? await resolveCustomer(
              ctx.context,
              ctx.request,
              config.resolveServerCustomerId?.(ctx.body),
            )
          : undefined;

        return handler({
          birrjs: ctx.context,
          input,
          headers: ctx.headers,
          request: ctx.request,
          ...(customer ? { customerId: customer.customerId } : {}),
          params: ctx.params,
        } as BirrJSMethodContext<TConfig["input"], InferRequireCustomer<TConfig>>);
      },
    );

    call.endpoint = endpoint as unknown as { options: unknown; path: string };
  }

  return call as unknown as BirrJSMethod<TConfig["input"], TResult> & {
    endpoint?: { options: unknown; path: string };
  };
}
