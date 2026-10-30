import type { BirrJSContext } from "../context";

export interface BirrJSEventMap {
  "subscription.trial_started": {
    customerId: string;
    subscriptionId: string;
    planId: string;
    planName: string;
    customerEmail: string | null;
    trialEndsAt: Date;
  };
  "subscription.activated": {
    customerId: string;
    subscriptionId: string;
    planId: string;
    planName: string;
    customerEmail: string | null;
    startedAt: Date | null;
    expiresAt: Date | null;
  };
  "subscription.cancelled": {
    customerId: string;
    subscriptionId: string;
    planId: string;
    planName: string;
    customerEmail: string | null;
    canceledAt: Date | null;
    endedAt: Date | null;
  };
  "subscription.expired": {
    customerId: string;
    subscriptionId: string;
    planId: string;
    planName: string;
    customerEmail: string | null;
    expiredAt: Date;
  };
  "subscription.reminder": {
    customerId: string;
    subscriptionId: string;
    planId: string;
    planName: string;
    customerEmail: string | null;
    customerPhone: string | null;
    expiresAt: Date;
    daysUntilExpiry: number;
  };
  "subscription.trial_ending": {
    customerId: string;
    subscriptionId: string;
    planId: string;
    planName: string;
    customerEmail: string | null;
    customerPhone: string | null;
    trialEndsAt: Date;
    daysUntilTrialEnd: number;
  };
  "subscription.plan_change_pending": {
    customerId: string;
    subscriptionId: string;
    planChangeId: string;
    fromPlanId: string;
    toPlanId: string;
    toPlanName: string;
    direction: "upgrade" | "downgrade" | "switch";
    customerEmail: string | null;
    amountDue: number;
    txRef: string | null;
    cycleStartAt: Date;
    cycleEndAt: Date | null;
  };
  "subscription.plan_changed": {
    customerId: string;
    subscriptionId: string;
    planChangeId: string;
    fromPlanId: string;
    toPlanId: string;
    toPlanName: string;
    direction: "upgrade" | "downgrade" | "switch";
    customerEmail: string | null;
    amountCharged: number;
    creditedAmount: number;
    cycleStartAt: Date | null;
    cycleEndAt: Date | null;
    changedAt: Date;
  };
  "subscription.plan_change_failed": {
    customerId: string;
    subscriptionId: string;
    planChangeId: string;
    fromPlanId: string;
    toPlanId: string;
    customerEmail: string | null;
    reason: string | null;
    failedAt: Date;
  };
}

export type BirrJSEventName = keyof BirrJSEventMap;

export type BirrJSEventHandlers = {
  [TName in BirrJSEventName]?: (payload: BirrJSEventMap[TName]) => Promise<void> | void;
} & {
  "*"?: (event: {
    name: BirrJSEventName;
    payload: BirrJSEventMap[BirrJSEventName];
  }) => Promise<void> | void;
};

export type BirrJSPluginEventHandlers = {
  [TName in BirrJSEventName]?: (
    payload: BirrJSEventMap[TName],
    ctx: BirrJSContext,
  ) => Promise<void> | void;
} & {
  "*"?: (event: {
    name: BirrJSEventName;
    payload: BirrJSEventMap[BirrJSEventName];
    ctx: BirrJSContext;
  }) => Promise<void> | void;
};
