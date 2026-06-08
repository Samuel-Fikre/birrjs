import type { BirrJSContext } from "../context";
import type { BirrJSEventHandlers, BirrJSEventMap, BirrJSEventName } from "../types/events";
import type { BirrJSPlugin, BeforeSubscribeHookCtx, CheckoutReadyHookCtx } from "../types/plugin";
import type { BirrJSInternalLogger } from "./logger";

export async function runBeforeHooks(
  plugins: BirrJSPlugin[] | undefined,
  ctx: BeforeSubscribeHookCtx,
  timeoutMs: number,
): Promise<void> {
  const hooks = (plugins ?? [])
    .filter(
      (
        p,
      ): p is BirrJSPlugin & {
        onBeforeSubscribe: NonNullable<BirrJSPlugin["onBeforeSubscribe"]>;
      } => !!p.onBeforeSubscribe,
    )
    .map((p) => p.onBeforeSubscribe(ctx));
  if (hooks.length === 0) return;
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Plugin hook timed out")), timeoutMs);
  });
  await Promise.race([Promise.all(hooks), timeout]);
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
