import type { BirrJSContext } from "../context";
import type { BirrJSEventHandlers, BirrJSEventMap, BirrJSEventName } from "../types/events";
import type {
  BeforePlanChangeHookCtx,
  BeforeSubscribeHookCtx,
  BeforeSubscribeResult,
  BirrJSPlugin,
  CheckoutReadyHookCtx,
  PaymentReadyHookCtx,
} from "../types/plugin";
import { BirrJSError, BIRRJS_ERROR_CODES } from "./error-codes";
import type { BirrJSInternalLogger } from "./logger";

export async function runBeforeHooks(
  plugins: BirrJSPlugin[] | undefined,
  ctx: BeforeSubscribeHookCtx,
  timeoutMs: number,
): Promise<BeforeSubscribeResult | undefined> {
  const hooks = (plugins ?? [])
    .filter(
      (
        p,
      ): p is BirrJSPlugin & {
        onBeforeSubscribe: NonNullable<BirrJSPlugin["onBeforeSubscribe"]>;
      } => !!p.onBeforeSubscribe,
    )
    .map((p) =>
      Promise.resolve()
        .then(() => p.onBeforeSubscribe(ctx))
        .catch(() => undefined),
    );
  if (hooks.length === 0) return;
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Plugin hook timed out")), timeoutMs);
  });
  const results = await Promise.race([Promise.all(hooks), timeout]);
  return results.find((r): r is BeforeSubscribeResult => r !== undefined);
}

/**
 * Fail-closed gate for plan changes: a plugin that throws, or one that outlives
 * `timeoutMs`, aborts the change before any row is written. Silently continuing
 * would let a fraud check that timed out bill the customer anyway.
 */
export async function runBeforePlanChangeHooks(
  plugins: BirrJSPlugin[] | undefined,
  buildCtx: () => Promise<BeforePlanChangeHookCtx>,
  timeoutMs: number,
  logger: BirrJSInternalLogger,
): Promise<void> {
  const hooks = (plugins ?? []).filter(
    (
      p,
    ): p is BirrJSPlugin & {
      onBeforePlanChange: NonNullable<BirrJSPlugin["onBeforePlanChange"]>;
    } => !!p.onBeforePlanChange,
  );
  // The context costs two plan reads, so build it only when someone is listening.
  if (hooks.length === 0) return;

  const ctx = await buildCtx();
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Plugin hook timed out")), timeoutMs);
  });

  try {
    await Promise.race([Promise.all(hooks.map((p) => p.onBeforePlanChange(ctx))), timeout]);
  } catch (error) {
    logger.warn({ err: error, subscriptionId: ctx.subscriptionId }, "onBeforePlanChange rejected");
    throw BirrJSError.from(
      "FORBIDDEN",
      BIRRJS_ERROR_CODES.PLAN_CHANGE_NOT_ALLOWED,
      error instanceof Error ? error.message : "Plan change blocked by plugin",
    );
  }
}

export async function runAfterHooks(
  plugins: BirrJSPlugin[] | undefined,
  ctx: CheckoutReadyHookCtx,
  logger: BirrJSInternalLogger,
): Promise<void> {
  const hooks = (plugins ?? [])
    .filter(
      (
        p,
      ): p is BirrJSPlugin & {
        onCheckoutReady: NonNullable<BirrJSPlugin["onCheckoutReady"]>;
      } => !!p.onCheckoutReady,
    )
    .map((p) => p.onCheckoutReady(ctx));
  if (hooks.length === 0) return;
  const results = await Promise.allSettled(hooks);
  for (const result of results) {
    if (result.status === "rejected") {
      logger.error({ err: result.reason }, "Plugin onCheckoutReady hook error");
    }
  }
}

export async function runPaymentReadyHooks(
  plugins: BirrJSPlugin[] | undefined,
  ctx: PaymentReadyHookCtx,
  logger: BirrJSInternalLogger,
): Promise<void> {
  const hooks = (plugins ?? [])
    .filter(
      (
        p,
      ): p is BirrJSPlugin & {
        onPaymentReady: NonNullable<BirrJSPlugin["onPaymentReady"]>;
      } => !!p.onPaymentReady,
    )
    .map((p) => p.onPaymentReady(ctx));
  if (hooks.length === 0) return;
  const results = await Promise.allSettled(hooks);
  for (const result of results) {
    if (result.status === "rejected") {
      logger.error({ err: result.reason }, "Plugin onPaymentReady hook error");
    }
  }
}

export async function runEventHandlers(
  on: BirrJSEventHandlers | undefined,
  eventName: BirrJSEventName,
  payload: BirrJSEventMap[BirrJSEventName],
  logger: BirrJSInternalLogger,
): Promise<void> {
  const namedHandler = on?.[eventName] as ((p: unknown) => Promise<void> | void) | undefined;
  try {
    await namedHandler?.(payload);
  } catch (error) {
    logger.error({ err: error, eventName }, "Event handler error");
  }
  const wildcardHandler = on?.["*"] as ((event: unknown) => Promise<void> | void) | undefined;
  try {
    await wildcardHandler?.({ name: eventName, payload });
  } catch (error) {
    logger.error({ err: error, eventName: "*" }, "Wildcard handler error");
  }
}

export async function runPluginEventHandlers(
  plugins: BirrJSPlugin[] | undefined,
  eventName: BirrJSEventName,
  payload: BirrJSEventMap[BirrJSEventName],
  ctx: BirrJSContext,
): Promise<void> {
  if (!plugins) return;
  for (const plugin of plugins) {
    const namedHandler = plugin.onEvent?.[eventName] as
      | ((p: typeof payload, c: BirrJSContext) => Promise<void> | void)
      | undefined;
    try {
      await namedHandler?.(payload, ctx);
    } catch (error) {
      ctx.logger.error(
        { err: error, pluginId: plugin.id, eventName },
        "Plugin event handler error",
      );
    }
    const wildcardHandler = plugin.onEvent?.["*"] as
      | ((event: {
          name: BirrJSEventName;
          payload: BirrJSEventMap[BirrJSEventName];
          ctx: BirrJSContext;
        }) => Promise<void> | void)
      | undefined;
    try {
      await wildcardHandler?.({ name: eventName, payload, ctx });
    } catch (error) {
      ctx.logger.error(
        { err: error, pluginId: plugin.id, eventName: "*" },
        "Plugin wildcard handler error",
      );
    }
  }
}
