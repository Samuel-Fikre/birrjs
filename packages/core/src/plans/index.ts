import type {
  FeatureType,
  BirrJSPlan,
  FeatureInclude,
  PlanConfig,
  Feature,
  FeatureDefinition,
  BooleanFeatureDefinition,
  MeteredFeatureDefinition,
  MeteredFeatureConfig,
  BooleanFeatureInclude,
  MeteredFeatureInclude,
} from "./schema";
import {
  planIdSchema,
  meteredFeatureConfigSchema,
  planConfigSchema,
  isBirrJSFeatureInclude,
  defineHiddenBrand,
  birrjsFeatureSymbol,
  birrjsFeatureIncludeSymbol,
  birrjsPlanSymbol,
} from "./schema";

export { syncPlans } from "./sync";

export type {
  FeatureType,
  ResetInterval,
  BirrJSPlan,
  FeatureInclude,
  PlanConfig,
  Feature,
  FeatureDefinition,
  BooleanFeatureDefinition,
  MeteredFeatureDefinition,
  MeteredFeatureConfig,
  BooleanFeatureInclude,
  MeteredFeatureInclude,
} from "./schema";

function formatValidationError(
  entityType: "feature" | "feature include" | "plan",
  id: string,
  messages: string[],
): Error {
  return new Error(
    `Invalid ${entityType} "${id}":\n${messages.map((message) => `  - ${message}`).join("\n")}`,
  );
}

/**
 * Feature builder function
 */
export function feature<const TId extends string, const TType extends FeatureType>(config: {
  id: TId;
  type: TType;
}): Feature<FeatureDefinition<TId, TType>> {
  const parsedId = planIdSchema.safeParse(config.id);
  if (!parsedId.success) {
    throw formatValidationError(
      "feature",
      typeof config.id === "string" ? config.id : "<unknown>",
      parsedId.error.issues.map((issue) => issue.message),
    );
  }

  const featureType = config.type === "boolean" || config.type === "metered" ? config.type : null;
  if (!featureType) {
    throw formatValidationError("feature", parsedId.data, [
      "Feature type must be boolean or metered",
    ]);
  }

  const featureDefinition = Object.freeze({
    id: parsedId.data,
    type: featureType,
  }) as FeatureDefinition<TId, TType>;

  const featureFactory = ((config?: MeteredFeatureConfig) => {
    if (featureDefinition.type === "boolean") {
      if (config !== undefined) {
        throw formatValidationError("feature include", featureDefinition.id, [
          `Boolean feature "${featureDefinition.id}" does not accept config`,
        ]);
      }

      const include = {
        config: undefined,
        feature: featureDefinition,
      } as BooleanFeatureInclude<BooleanFeatureDefinition<TId>>;
      defineHiddenBrand(include, birrjsFeatureIncludeSymbol);
      return Object.freeze(include);
    }

    const parsedConfig = meteredFeatureConfigSchema.safeParse(config);
    if (!parsedConfig.success) {
      throw formatValidationError(
        "feature include",
        featureDefinition.id,
        parsedConfig.error.issues.map((issue) => issue.message),
      );
    }

    const include = {
      config: parsedConfig.data,
      feature: featureDefinition,
    } as MeteredFeatureInclude<MeteredFeatureDefinition<TId>>;
    defineHiddenBrand(include, birrjsFeatureIncludeSymbol);
    return Object.freeze(include);
  }) as Feature<FeatureDefinition<TId, TType>>;

  defineHiddenBrand(featureFactory, birrjsFeatureSymbol);
  return featureFactory;
}

/**
 * Plan builder function
 */
export function plan<const TConfig extends PlanConfig>(config: TConfig): BirrJSPlan<TConfig> {
  const result = planConfigSchema.safeParse(config);

  if (!result.success) {
    const id = typeof config?.id === "string" ? config.id : "<unknown>";
    throw formatValidationError(
      "plan",
      id,
      result.error.issues.map((issue: { message: string }) => issue.message),
    );
  }

  const parsed = result.data;
  const includes = parsed.includes ?? [];
  const invalidInclude = includes.find((include: unknown) => !isBirrJSFeatureInclude(include));
  if (invalidInclude) {
    throw formatValidationError("plan", parsed.id, [
      "Includes must contain values returned by feature(...)",
    ]);
  }

  const builtPlan = {
    ...parsed,
    includes: includes as readonly FeatureInclude[],
  } as BirrJSPlan<TConfig>;
  defineHiddenBrand(builtPlan, birrjsPlanSymbol);
  return Object.freeze(builtPlan);
}
