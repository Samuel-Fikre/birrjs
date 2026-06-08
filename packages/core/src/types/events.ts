export interface BirrJSEventMap {
  "subscription.activated": {
    customerId: string;
    subscriptionId: string;
    planId: string;
    startedAt: Date | null;
    expiresAt: Date | null;
  };
  "subscription.cancelled": {
    customerId: string;
    subscriptionId: string;
    planId: string;
    canceledAt: Date | null;
    endedAt: Date | null;
  };
  "subscription.expired": {
    customerId: string;
    subscriptionId: string;
    planId: string;
    expiredAt: Date;
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
