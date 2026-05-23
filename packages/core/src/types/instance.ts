import type { BirrJSMethod } from "../api/endpoint";
import type { BirrJSContext } from "../context";
import type { BirrJSPlan } from "../plans";
import type { PlanIdFromOptions, FeatureIdFromOptions } from "../plans/schema";

export interface BirrJSClientApiCarrier<TClientApi> {
  readonly $clientApi?: TClientApi;
}

export type ClientMethodKeys<TMethods extends Record<string, { client?: boolean }>> = {
  [K in keyof TMethods]-?: TMethods[K] extends { client: true } ? K : never;
}[keyof TMethods];

export type BirrJSInput<M> = M extends BirrJSMethod<infer TInput, unknown> ? TInput : never;

export type BirrJSOutput<M> = M extends BirrJSMethod<unknown, infer TOutput> ? TOutput : never;

// Type-level refinement utils

type OmitCustomerId<T> = T extends object ? Omit<T, "customerId"> : T;

type NarrowPlanId<T, TOptions extends { plans?: readonly BirrJSPlan[] }> = T extends {
  planId: string;
}
  ? Omit<T, "planId"> & { planId: PlanIdFromOptions<TOptions> }
  : T;

type NarrowFeatureId<T, TOptions extends { plans?: readonly BirrJSPlan[] }> = T extends {
  featureId: string;
}
  ? Omit<T, "featureId"> & { featureId: FeatureIdFromOptions<TOptions> }
  : T;

type RefineServerInput<T, TOptions extends { plans?: readonly BirrJSPlan[] }> = NarrowFeatureId<
  NarrowPlanId<T, TOptions>,
  TOptions
>;

type RefineClientInput<T, TOptions extends { plans?: readonly BirrJSPlan[] }> = OmitCustomerId<
  NarrowFeatureId<NarrowPlanId<T, TOptions>, TOptions>
>;

// Client methods

export type BirrJSClientMethods<
  TMethods extends Record<string, { client?: boolean }>,
  TOptions extends { plans?: readonly BirrJSPlan[] } = { plans?: readonly BirrJSPlan[] },
> = {
  [K in ClientMethodKeys<TMethods>]: (
    input: RefineClientInput<BirrJSInput<TMethods[K]>, TOptions>,
  ) => Promise<BirrJSOutput<TMethods[K]>>;
};

// Server API (all methods, planId/featureId narrowed)

type BirrJSMethodInput<T> = T extends (birrjs: BirrJSContext, input: infer I) => unknown
  ? I
  : never;

type BirrJSMethodResult<T> = T extends (...args: unknown[]) => Promise<infer R> ? R : never;

export type GenerateBirrJSAPI<
  TMethods extends Record<string, unknown>,
  TOptions extends { plans?: readonly BirrJSPlan[] } = { plans?: readonly BirrJSPlan[] },
> = {
  [K in keyof TMethods]: [BirrJSMethodInput<TMethods[K]>] extends [void] | [never]
    ? () => Promise<BirrJSMethodResult<TMethods[K]>>
    : (
        input: RefineServerInput<BirrJSMethodInput<TMethods[K]>, TOptions>,
      ) => Promise<BirrJSMethodResult<TMethods[K]>>;
};
