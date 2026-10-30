import type { PlanInterval } from "../types";

/**
 * `keep_anchor` keeps the customer's existing renewal date and bills only the
 * difference for the time left in the period. `rebase` starts a fresh period
 * from now and is required whenever the interval or the payment state changes.
 */
export type ProrationStrategy = "keep_anchor" | "rebase";

export type ProrationLineKind =
  | "plan_difference_prorated"
  | "new_period_charged"
  | "unused_period_credited";

export interface ProrationLine {
  readonly kind: ProrationLineKind;
  /** Positive for a charge, negative for a credit. */
  readonly amountMinor: number;
}

export interface ProrationInput {
  readonly now: Date;
  readonly currentPeriodStartAt: Date;
  readonly currentPeriodEndAt: Date | null;
  readonly currentAmountMinor: number;
  readonly currentInterval: PlanInterval;
  readonly nextAmountMinor: number;
  readonly nextInterval: PlanInterval;
  /** End of the fresh period, computed by the caller for `rebase`. */
  readonly nextPeriodEndAt?: Date | null;
  readonly minimumChargeMinor?: number;
}

export interface ProrationResult {
  readonly strategy: ProrationStrategy;
  readonly intervalChanged: boolean;
  readonly cycleStartAt: Date;
  readonly cycleEndAt: Date | null;
  readonly creditMinor: number;
  readonly debitMinor: number;
  readonly dueNowMinor: number;
  readonly bankedCreditMinor: number;
  /** Charge suppressed by `minimumChargeMinor`; recovered at the next renewal. */
  readonly deferredMinor: number;
  readonly lines: readonly ProrationLine[];
}
