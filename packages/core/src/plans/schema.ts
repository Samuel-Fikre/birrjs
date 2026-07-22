import { createHash } from "node:crypto";

import * as z from "zod";

export const birrjsFeatureSymbol = Symbol.for("birrjs.feature");
export const birrjsFeatureIncludeSymbol = Symbol.for("birrjs.feature_include");
export const birrjsPlanSymbol = Symbol.for("birrjs.plan");

export type BirrJSBrandSymbol =
  | typeof birrjsFeatureSymbol
  | typeof birrjsFeatureIncludeSymbol
  | typeof birrjsPlanSymbol;

export function defineHiddenBrand<T>(obj: T, symbol: BirrJSBrandSymbol): void {
  Object.defineProperty(obj, symbol, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

/**
 * Plan schema validation
 */

export const planNameSchema = z
  .string()
  .min(1, "Plan name must not be empty")
  .max(100, "Plan name must not exceed 100 characters");
export const planGroupSchema = z.string().min(1, "Plan group must not be empty").max(64);
export const planIdSchema = z
  .string()
  .regex(/^[a-z0-9_-]+$/, "Plan ID must be lowercase alphanumeric with dashes or underscores");

export const priceSchema = z.object({
  amount: z
    .number()
    .positive("Price amount must be positive")
    .max(999_999.99, "Price amount must not exceed 999,999.99"),
  interval: z.enum(["daily", "weekly", "monthly", "yearly"]),
  currency: z.string().optional(),
});

export const meteredFeatureConfigSchema = z.object({
  limit: z.number().int().positive("Feature limit must be a positive integer"),
  reset: z.enum(["day", "week", "month", "year"]),
});

export const featureConfigSchema = z.object({
  id: z.string(),
  type: z.enum(["boolean", "metered"]),
});

export const planConfigSchema = z.object({
  id: planIdSchema,
  name: planNameSchema,
  group: planGroupSchema.optional(),
  default: z.boolean().optional(),
  price: priceSchema.optional(),
  trialDays: z.number().int().positive().optional(),
  resetOnTrialConversion: z.boolean().optional(),
  includes: z.array(z.unknown()).optional(),
});

export type FeatureType = z.infer<typeof featureConfigSchema>["type"];
export type ResetInterval = z.infer<typeof meteredFeatureConfigSchema>["reset"];
export type PriceInterval = z.infer<typeof priceSchema>["interval"];
export type MeteredFeatureConfig = z.infer<typeof meteredFeatureConfigSchema>;
export type PlanConfig = z.infer<typeof planConfigSchema>;

/**
 * Feature include types
 */
export interface FeatureDefinition<
  TId extends string = string,
  TType extends FeatureType = FeatureType,
> {
  id: TId;
  type: TType;
}

export type BooleanFeatureDefinition<TId extends string = string> = FeatureDefinition<
  TId,
  "boolean"
>;
export type MeteredFeatureDefinition<TId extends string = string> = FeatureDefinition<
  TId,
  "metered"
>;

export type BooleanFeatureInclude<
  TFeature extends BooleanFeatureDefinition = BooleanFeatureDefinition,
> = Readonly<{
  config: undefined;
  feature: TFeature;
}>;

export type MeteredFeatureInclude<
  TFeature extends MeteredFeatureDefinition = MeteredFeatureDefinition,
> = Readonly<{
  config: MeteredFeatureConfig;
  feature: TFeature;
}>;

export type FeatureInclude = BooleanFeatureInclude | MeteredFeatureInclude;

export interface NormalizedPlanFeature {
  config: Record<string, unknown> | null;
  id: string;
  limit: number | null;
  resetInterval: ResetInterval | null;
  type: FeatureType;
}

export interface NormalizedPlan {
  group: string | null;
  id: string;
  includes: readonly NormalizedPlanFeature[];
  isDefault: boolean;
  name: string;
  priceAmount: number | null;
  priceInterval: PriceInterval | null;
  trialDays: number | null;
  resetOnTrialConversion: boolean;
  currency: string;
  hash: string;
}

export function computePlanHash(plan: Omit<NormalizedPlan, "hash">): string {
  const payload = JSON.stringify({
    group: plan.group,
    isDefault: plan.isDefault,
    priceAmount: plan.priceAmount,
    priceInterval: plan.priceInterval,
    trialDays: plan.trialDays,
    resetOnTrialConversion: plan.resetOnTrialConversion,
    features: plan.includes.map((f) => ({
      id: f.id,
      limit: f.limit,
      resetInterval: f.resetInterval,
      config: f.config,
    })),
  });

  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function normalizeFeature(include: FeatureInclude): NormalizedPlanFeature {
  if (include.feature.type === "metered") {
    const config = include.config;
    if (!config) {
      throw new Error(`Metered feature "${include.feature.id}" requires config.`);
    }

    return {
      config,
      id: include.feature.id,
      limit: config.limit,
      resetInterval: config.reset,
      type: include.feature.type,
    } satisfies NormalizedPlanFeature;
  }

  return {
    config: null,
    id: include.feature.id,
    limit: null,
    resetInterval: null,
    type: include.feature.type,
  } satisfies NormalizedPlanFeature;
}

export function normalizePlan(plan: BirrJSPlan, currency: string): NormalizedPlan {
  const includes = plan.includes ?? [];
  const normalizedIncludes = includes.map(normalizeFeature);
  const sortedIncludes = [...normalizedIncludes].sort((left, right) =>
    left.id.localeCompare(right.id),
  );

  const planData = {
    group: plan.group ?? null,
    id: plan.id,
    includes: sortedIncludes,
    isDefault: plan.default ?? false,
    name: plan.name,
    priceAmount: plan.price?.amount != null ? plan.price.amount * 100 : null,
    priceInterval: plan.price?.interval ?? null,
    trialDays: plan.trialDays ?? null,
    resetOnTrialConversion: plan.resetOnTrialConversion ?? false,
    currency: plan.price?.currency ?? currency,
  };

  return { ...planData, hash: computePlanHash(planData) };
}

type BooleanFeatureCallable<TFeature extends BooleanFeatureDefinition> =
  (() => BooleanFeatureInclude<TFeature>) & Readonly<TFeature>;

type MeteredFeatureCallable<TFeature extends MeteredFeatureDefinition> = ((
  config: MeteredFeatureConfig,
) => MeteredFeatureInclude<TFeature>) &
  Readonly<TFeature>;

export type Feature<TFeature extends FeatureDefinition = FeatureDefinition> =
  TFeature extends BooleanFeatureDefinition
    ? BooleanFeatureCallable<TFeature>
    : TFeature extends MeteredFeatureDefinition
      ? MeteredFeatureCallable<TFeature>
      : never;

/**
 * Plan type (returned by plan() builder)
 */
export type BirrJSPlan<TConfig extends PlanConfig = PlanConfig> = Readonly<
  Omit<TConfig, "includes"> & {
    includes: TConfig["includes"] extends readonly FeatureInclude[]
      ? TConfig["includes"]
      : readonly FeatureInclude[];
  }
>;

export function isBirrJSFeature(value: unknown): value is (...args: unknown[]) => unknown {
  return (
    typeof value === "function" &&
    (value as unknown as Record<PropertyKey, unknown>)[birrjsFeatureSymbol] === true
  );
}

export function isBirrJSFeatureInclude(value: unknown): value is FeatureInclude {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as Record<PropertyKey, unknown>)[birrjsFeatureIncludeSymbol] === true
  );
}

export function isBirrJSPlan(value: unknown): value is BirrJSPlan {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as Record<PropertyKey, unknown>)[birrjsPlanSymbol] === true
  );
}

export type PlanIdFromPlans<TPlans> = TPlans extends readonly (infer TItem)[]
  ? TItem extends BirrJSPlan
    ? TItem["id"]
    : never
  : never;

type ExtractFeatureIds<TPlan> = TPlan extends {
  includes: readonly (infer TInclude)[];
}
  ? TInclude extends { feature: { id: infer TId extends string } }
    ? TId
    : never
  : never;

export type FeatureIdFromPlans<TPlans> = TPlans extends readonly (infer TItem)[]
  ? ExtractFeatureIds<TItem>
  : never;

export type PlanIdFromOptions<TOptions extends { plans?: readonly BirrJSPlan[] }> = [
  PlanIdFromPlans<TOptions["plans"]>,
] extends [never]
  ? string
  : PlanIdFromPlans<TOptions["plans"]>;

export type FeatureIdFromOptions<TOptions extends { plans?: readonly BirrJSPlan[] }> = [
  FeatureIdFromPlans<TOptions["plans"]>,
] extends [never]
  ? string
  : FeatureIdFromPlans<TOptions["plans"]>;
