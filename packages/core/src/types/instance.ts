import type { BirrJSContext } from "../context";
import type { BirrJSPlan } from "../plans";
import type { PlanIdFromOptions, FeatureIdFromOptions } from "../plans/schema";

export interface BirrJSClientApiCarrier<TClientApi> {
  readonly $clientApi?: TClientApi;
}

export type ClientMethodKeys<TMethods extends Record<string, { client?: boolean }>> = {
  [K in keyof TMethods]-?: TMethods[K] extends { client: true } ? K : never;
}[keyof TMethods];

export type BirrJSInput<M> = M extends (
  birrjs: BirrJSContext,
  input: infer TInput,
) => Promise<unknown>
  ? TInput
  : never;

export type BirrJSOutput<M> = M extends (
  birrjs: BirrJSContext,
  input: infer _,
) => Promise<infer TOutput>
  ? TOutput
  : never;

// Type-level refinement utils

type OmitCustomerId<T> = T extends object ? Omit<T, "customerId"> : T;

type NarrowPlanId<
  T,
  TOptions extends { plans?: readonly BirrJSPlan[] },
> = TOptions["plans"] extends readonly [unknown, ...unknown[]]
  ? T extends { planId: string }
    ? Omit<T, "planId"> & { planId: PlanIdFromOptions<TOptions> }
    : T
  : T;

type NarrowFeatureId<
  T,
  TOptions extends { plans?: readonly BirrJSPlan[] },
> = TOptions["plans"] extends readonly [unknown, ...unknown[]]
  ? T extends { featureId: string }
    ? Omit<T, "featureId"> & { featureId: FeatureIdFromOptions<TOptions> }
    : T
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

export type GenerateBirrJSAPI<
  TMethods extends Record<string, unknown>,
  TOptions extends { plans?: readonly BirrJSPlan[] } = { plans?: readonly BirrJSPlan[] },
> = {
  [K in keyof TMethods]: TMethods[K] extends (birrjs: BirrJSContext, input: infer I) => infer R
    ? [I] extends [void] | [never]
      ? () => R
      : (input: RefineServerInput<I, TOptions>) => R
    : never;
};
