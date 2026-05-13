export interface EntitlementBalance {
  limit: number;
  remaining: number;
  resetAt: Date | null;
  unlimited: boolean;
}

export interface CheckResult {
  allowed: boolean;
  balance: EntitlementBalance | null;
}

export interface ReportResult {
  balance: EntitlementBalance | null;
  success: boolean;
}

export interface CheckEntitlementInput {
  customerId: string;
  featureId: string;
  now?: Date;
  required?: number;
}

export interface ReportEntitlementInput {
  customerId: string;
  featureId: string;
  amount?: number;
  now?: Date;
}

export interface ActiveEntitlementRow {
  balance: number;
  id: string;
  nextResetAt: Date | null;
  originalLimit: number | null;
  resetInterval: string | null;
}

export interface StaleEntitlementRow extends Omit<
  ActiveEntitlementRow,
  "nextResetAt" | "originalLimit" | "resetInterval"
> {
  nextResetAt: Date;
  originalLimit: number;
  resetInterval: string;
}
