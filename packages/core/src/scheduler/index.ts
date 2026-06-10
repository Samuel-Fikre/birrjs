import cron from "node-cron";

import type { BirrJSContext } from "../context";
import { checkPendingSubscriptions } from "../server/cron/cron.api";
import { checkExpiredSubscriptions } from "../server/cron/cron.api";
import { sendReminders } from "../server/cron/cron.api";

const scheduledTasks = new Map<string, ReturnType<typeof cron.schedule>>();
let pendingRunning = false;
let expiryRunning = false;
let remindersRunning = false;

export function startScheduler(
  ctx: BirrJSContext,
  pendingCron: string,
  expiryCron: string,
  reminderCron: string,
): void {
  const { logger } = ctx;

  // Validate all cron expressions upfront before scheduling
  if (!cron.validate(pendingCron)) {
    throw new Error(`Invalid cron expression for pending check: ${pendingCron}`);
  }
  if (!cron.validate(expiryCron)) {
    throw new Error(`Invalid cron expression for expiry check: ${expiryCron}`);
  }
  if (!cron.validate(reminderCron)) {
    throw new Error(`Invalid cron expression for reminder check: ${reminderCron}`);
  }

  // Stop existing tasks if already running
  if (isSchedulerRunning()) {
    stopScheduler();
    logger.info("Stopped existing scheduler before starting new one");
  }

  // Schedule pending subscription check
  const pendingTask = cron.schedule(
    pendingCron,
    async () => {
      if (pendingRunning) {
        logger.info("Skipping pending check; previous run still in progress");
        return;
      }
      pendingRunning = true;
      try {
        await checkPendingSubscriptions(ctx);
      } catch (err) {
        logger.error({ msg: "Scheduler error in pending check", err });
      } finally {
        pendingRunning = false;
      }
    },
    { timezone: "UTC" },
  );
  scheduledTasks.set("pending", pendingTask);
  logger.info(`Started pending subscription check with cron: ${pendingCron}`);

  // Schedule expired subscription check
  const expiryTask = cron.schedule(
    expiryCron,
    async () => {
      if (expiryRunning) {
        logger.info("Skipping expiry check; previous run still in progress");
        return;
      }
      expiryRunning = true;
      try {
        await checkExpiredSubscriptions(ctx);
      } catch (err) {
        logger.error({ msg: "Scheduler error in expiry check", err });
      } finally {
        expiryRunning = false;
      }
    },
    { timezone: "UTC" },
  );
  scheduledTasks.set("expiry", expiryTask);
  logger.info(`Started expired subscription check with cron: ${expiryCron}`);

  // Schedule reminder check
  const remindersTask = cron.schedule(
    reminderCron,
    async () => {
      if (remindersRunning) {
        logger.info("Skipping reminder check; previous run still in progress");
        return;
      }
      remindersRunning = true;
      try {
        await sendReminders(ctx);
      } catch (err) {
        logger.error({ msg: "Scheduler error in reminder check", err });
      } finally {
        remindersRunning = false;
      }
    },
    { timezone: "UTC" },
  );
  scheduledTasks.set("reminders", remindersTask);
  logger.info(`Started reminder check with cron: ${reminderCron}`);
}

export function stopScheduler(): void {
  scheduledTasks.forEach((task) => {
    task.stop();
  });
  scheduledTasks.clear();
  pendingRunning = false;
  expiryRunning = false;
  remindersRunning = false;
}

export function isSchedulerRunning(): boolean {
  return scheduledTasks.size > 0;
}
