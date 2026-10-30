import type {
  ProrationInput,
  ProrationLine,
  ProrationResult,
  ProrationStrategy,
} from "./proration.types";

/**
 * Fraction of the current period still unused, measured in wall-clock time.
 * All inputs are UTC timestamps, so this is DST-immune by construction.
 */
export function getRemainingRatio(now: Date, periodStartAt: Date, periodEndAt: Date): number {
  const start = periodStartAt.getTime();
  const end = periodEndAt.getTime();
  const current = now.getTime();

  // A zero or negative-length period has nothing left to credit.
  if (end <= start) return 0;
  if (current <= start) return 1;
  if (current >= end) return 0;

  return (end - current) / (end - start);
}

/**
 * Splits a period price into the prorated debit and credit for a plan change.
 *
 * Rounding always favours the payer of the difference: charges are floored and
 * credits are ceiled, so the residual sub-unit cent is never taken from the
 * customer.
 */
export function calculateProration(input: ProrationInput): ProrationResult {
  const intervalChanged = input.currentInterval !== input.nextInterval;
  // An expired period has nothing left to prorate against: the customer is buying
  // a fresh one, so it rebases at full price instead of a zero-valued difference.
  const hasPaidPeriod =
    input.currentPeriodEndAt !== null &&
    input.currentPeriodEndAt.getTime() > input.now.getTime() &&
    input.currentAmountMinor > 0;

  const strategy: ProrationStrategy = intervalChanged || !hasPaidPeriod ? "rebase" : "keep_anchor";

  if (strategy === "keep_anchor") {
    return keepAnchor(input);
  }

  return rebase(input);
}

function keepAnchor(input: ProrationInput): ProrationResult {
  const periodEndAt = input.currentPeriodEndAt as Date;
  const ratio = getRemainingRatio(input.now, input.currentPeriodStartAt, periodEndAt);
  const difference = input.nextAmountMinor - input.currentAmountMinor;

  const lines: ProrationLine[] = [];
  let debitMinor = 0;
  let creditMinor = 0;

  if (difference > 0) {
    debitMinor = Math.floor(difference * ratio);
  } else if (difference < 0) {
    creditMinor = Math.ceil(-difference * ratio);
  }

  if (debitMinor > 0 || creditMinor > 0) {
    lines.push({ kind: "plan_difference_prorated", amountMinor: debitMinor - creditMinor });
  }

  return net({
    strategy: "keep_anchor",
    intervalChanged: false,
    cycleStartAt: input.currentPeriodStartAt,
    cycleEndAt: periodEndAt,
    debitMinor,
    creditMinor,
    lines,
    minimumChargeMinor: input.minimumChargeMinor,
  });
}

function rebase(input: ProrationInput): ProrationResult {
  const lines: ProrationLine[] = [];
  const debitMinor = Math.max(0, input.nextAmountMinor);
  let creditMinor = 0;

  if (input.currentPeriodEndAt !== null && input.currentAmountMinor > 0) {
    const ratio = getRemainingRatio(
      input.now,
      input.currentPeriodStartAt,
      input.currentPeriodEndAt,
    );
    creditMinor = Math.ceil(input.currentAmountMinor * ratio);
  }

  if (debitMinor > 0) {
    lines.push({ kind: "new_period_charged", amountMinor: debitMinor });
  }
  if (creditMinor > 0) {
    lines.push({ kind: "unused_period_credited", amountMinor: -creditMinor });
  }

  return net({
    strategy: "rebase",
    intervalChanged: input.currentInterval !== input.nextInterval,
    cycleStartAt: input.now,
    cycleEndAt: debitMinor > 0 ? (input.nextPeriodEndAt ?? null) : null,
    debitMinor,
    creditMinor,
    lines,
    minimumChargeMinor: input.minimumChargeMinor,
  });
}

interface NetInput {
  strategy: ProrationStrategy;
  intervalChanged: boolean;
  cycleStartAt: Date;
  cycleEndAt: Date | null;
  debitMinor: number;
  creditMinor: number;
  lines: ProrationLine[];
  minimumChargeMinor?: number;
}

function net(input: NetInput): ProrationResult {
  const grossDueNow = Math.max(0, input.debitMinor - input.creditMinor);
  const bankedCreditMinor = Math.max(0, input.creditMinor - input.debitMinor);

  const minimum = input.minimumChargeMinor ?? 0;
  const belowMinimum = grossDueNow > 0 && grossDueNow < minimum;

  return {
    strategy: input.strategy,
    intervalChanged: input.intervalChanged,
    cycleStartAt: input.cycleStartAt,
    cycleEndAt: input.cycleEndAt,
    debitMinor: input.debitMinor,
    creditMinor: input.creditMinor,
    dueNowMinor: belowMinimum ? 0 : grossDueNow,
    bankedCreditMinor,
    deferredMinor: belowMinimum ? grossDueNow : 0,
    lines: input.lines,
  };
}
