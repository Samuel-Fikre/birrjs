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
