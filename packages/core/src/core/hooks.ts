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
): Promise<void> {
  const hooks = (plugins ?? [])
    .filter(
      (
        p,
      ): p is BirrJSPlugin & {
        onSubscribeComplete: NonNullable<BirrJSPlugin["onCheckoutReady"]>;
      } => !!p.onCheckoutReady,
    )
    .map((p) => p.onSubscribeComplete(ctx));
  if (hooks.length === 0) return;
  await Promise.all(hooks);
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
