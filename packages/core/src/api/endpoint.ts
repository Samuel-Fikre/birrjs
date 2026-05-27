import { createEndpoint, createMiddleware } from "better-call";
import type { Middleware, StandardSchemaV1 } from "better-call";
import type * as z from "zod";

import type { BirrJSContext } from "../context";
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

export type BirrJSMethodRouteConfig = Omit<BetterCallOptions, "body" | "method"> & {
  method: NonNullable<BetterCallOptions["method"]>;
  path: string;
  client?: boolean;
  requireHeaders?: boolean;
  requireRequest?: boolean;
  disableBody?: boolean;
  use?: Middleware[];
  resolveInput?: (ctx: {
    request?: Request;
    headers?: Headers;
    params: Record<string, string>;
    context: BirrJSContext;
  }) => Promise<unknown> | unknown;
};

export interface BirrJSMethodConfig {
  input?: z.ZodType;
  route?: BirrJSMethodRouteConfig;
  requireCustomer?: boolean;
  resolveServerCustomerId?: (input: unknown) => string | undefined;
}

type InferInput<TInput> = TInput extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<TInput>
  : TInput;

type InferSchemaInput<TSchema> = TSchema extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<TSchema>
  : never;

type InferMethodInput<TConfig extends BirrJSMethodConfig> =
  TConfig["input"] extends StandardSchemaV1
    ? InferSchemaInput<TConfig["input"]>
    : TConfig["route"] extends { resolveInput: (...args: unknown[]) => infer TResolved }
      ? Awaited<TResolved>
      : void;

type AddCustomerId<TInput> = TInput extends undefined
  ? { customerId: string }
  : TInput extends object
    ? TInput & { customerId: string }
    : TInput;

type ServerMethodInput<TConfig extends BirrJSMethodConfig> =
  InferRequireCustomer<TConfig> extends true
    ? AddCustomerId<InferMethodInput<TConfig>>
    : InferMethodInput<TConfig>;

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

function getInputCustomerId(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  return "customerId" in input && typeof (input as Record<string, unknown>).customerId === "string"
    ? (input as Record<string, string>).customerId
    : undefined;
}

function stripCustomerId<TInput>(input: TInput): TInput {
  if (!input || typeof input !== "object") return input;
  const { customerId: _, ...rest } = input as Record<string, unknown>;
  return rest as TInput;
}

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

export type BirrJSMethod<TServerInput, TResult> = {
  (birrjs: BirrJSContext, input: TServerInput): Promise<TResult>;
  client?: boolean;
  endpoint?: { options: unknown; path: string } & Record<string, unknown>;
};

export function defineBirrJSMethod<const TConfig extends BirrJSMethodConfig, TResult>(
  config: TConfig,
  handler: (
    ctx: BirrJSMethodContext<TConfig["input"], InferRequireCustomer<TConfig>>,
  ) => Promise<TResult>,
): BirrJSMethod<ServerMethodInput<TConfig>, TResult> {
  const call = async (
    birrjs: BirrJSContext,
    input: ServerMethodInput<TConfig>,
    request?: Request,
  ): Promise<TResult> => {
    const cleaned = config.requireCustomer ? stripCustomerId(input) : input;
    const validatedInput = config.input
      ? (config.input.parse(cleaned) as InferInput<TConfig["input"]>)
      : (cleaned as InferInput<TConfig["input"]>);

    const customer = config.requireCustomer
      ? await resolveCustomer(
          birrjs,
          request,
          config.resolveServerCustomerId?.(input) ?? getInputCustomerId(input),
        )
      : undefined;

    return handler({
      birrjs,
      input: validatedInput,
      ...(customer ? { customerId: customer.customerId } : {}),
      params: {} as Record<string, string>,
    } as BirrJSMethodContext<TConfig["input"], InferRequireCustomer<TConfig>>);
  };

  if (config.route) {
    const routeConfig = config.route;
    const isGetMethod = routeConfig.method === "GET" || routeConfig.method === "HEAD";
    const endpoint = createBirrJSEndpoint(
      routeConfig.path,
      {
        ...(isGetMethod && config.input && !routeConfig.disableBody ? { query: config.input } : {}),
        ...(!isGetMethod && config.input && !routeConfig.disableBody ? { body: config.input } : {}),
        method: routeConfig.method,
        requireHeaders: routeConfig.requireHeaders,
        requireRequest: routeConfig.requireRequest,
        disableBody: routeConfig.disableBody,
        use: routeConfig.use,
      },
      async (ctx) => {
        const rawInput = routeConfig.resolveInput
          ? await routeConfig.resolveInput({
              request: ctx.request,
              headers: ctx.headers,
              params: ctx.params as Record<string, string>,
              context: ctx.context,
            })
          : isGetMethod
            ? ctx.query
            : ctx.body;

        const cleaned = config.requireCustomer ? stripCustomerId(rawInput) : rawInput;

        const customer = config.requireCustomer
          ? await resolveCustomer(ctx.context, ctx.request)
          : undefined;

        return handler({
          birrjs: ctx.context,
          input: cleaned as InferInput<TConfig["input"]>,
          headers: ctx.headers,
          request: ctx.request,
          ...(customer ? { customerId: customer.customerId } : {}),
          params: ctx.params,
        } as BirrJSMethodContext<TConfig["input"], InferRequireCustomer<TConfig>>);
      },
    );

    call.client = routeConfig.client === true;
    call.endpoint = endpoint as unknown as { options: unknown; path: string };
  }

  return call as unknown as BirrJSMethod<ServerMethodInput<TConfig>, TResult> & {
    client?: boolean;
    endpoint?: { options: unknown; path: string };
  };
}
