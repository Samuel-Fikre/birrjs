import * as z from "zod";
import { createSelectSchema } from "drizzle-zod";
import { subscription, customer, plan } from "../database/schema";

export const SubscriptionSchema = createSelectSchema(subscription);
export const CustomerSchema = createSelectSchema(customer);
export const PlanSchema = createSelectSchema(plan);

// Status enums
export const SubscriptionStatusSchema = z.enum(["active", "expired", "canceled", "pending"]);
export const InvoiceStatusSchema = z.enum(["draft", "pending", "paid", "failed", "void"]);

// Standard error response format
export const ApiErrorSchema = z.object({
  code: z.enum([
    "VALIDATION_ERROR",
    "NOT_FOUND",
    "UNAUTHORIZED",
    "FORBIDDEN",
    "CONFLICT",
    "INTERNAL_ERROR",
  ]),
  message: z.string(),
  details: z.record(z.string(), z.array(z.string())).optional(),
});

// Reusable pagination schemas
export const PaginationRequestSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export const PaginationResponseMetaSchema = z.object({
  total: z.number().int().min(0),
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().min(0),
});

// Reusable customer fields
export const CustomerInputSchema = z.object({
  email: z.string().email(),
  name: z.string().max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// Subscribe to a plan
export const SubscribeRequestSchema = z.object({
  planId: z.string().min(1),
  email: z.string().email(),
  name: z.string().max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const SubscribeResponseSchema = z.object({
  checkoutUrl: z.string().url(),
  subscriptionId: z.string(),
  customerId: z.string(),
});

// Inferred TypeScript types
export type SubscribeRequest = z.infer<typeof SubscribeRequestSchema>;
export type SubscribeResponse = z.infer<typeof SubscribeResponseSchema>;

// List subscriptions with pagination
export const ListSubscriptionsRequestSchema = PaginationRequestSchema.extend({
  customerId: z.string().optional(),
  planId: z.string().optional(),
  status: SubscriptionStatusSchema.optional(),
});

export const ListSubscriptionsResponseSchema = z.object({
  subscriptions: z.array(SubscriptionSchema),
  ...PaginationResponseMetaSchema.shape,
});

export type ListSubscriptionsResponse = z.infer<typeof ListSubscriptionsResponseSchema>;

// Cancel subscription
export const CancelSubscriptionRequestSchema = z.object({
  subscriptionId: z.string().min(1),
  cancelAtPeriodEnd: z.boolean().default(false),
});

export const CancelSubscriptionResponseSchema = z.object({
  subscription: SubscriptionSchema,
});

export type CancelSubscriptionRequest = z.infer<typeof CancelSubscriptionRequestSchema>;
export type CancelSubscriptionResponse = z.infer<typeof CancelSubscriptionResponseSchema>;

// Create customer
export const CreateCustomerRequestSchema = CustomerInputSchema;

export const CreateCustomerResponseSchema = z.object({
  customer: CustomerSchema,
});

export type CreateCustomerRequest = z.infer<typeof CreateCustomerRequestSchema>;
export type CreateCustomerResponse = z.infer<typeof CreateCustomerResponseSchema>;

// Update customer
export const UpdateCustomerRequestSchema = CustomerInputSchema.partial()
  .extend({
    customerId: z.string().min(1),
  })
  .refine(
    (data) => data.email !== undefined || data.name !== undefined || data.metadata !== undefined,
    { message: "At least one field must be provided to update" },
  );

export const UpdateCustomerResponseSchema = z.object({
  customer: CustomerSchema,
});

export type UpdateCustomerRequest = z.infer<typeof UpdateCustomerRequestSchema>;
export type UpdateCustomerResponse = z.infer<typeof UpdateCustomerResponseSchema>;

// List customers with pagination
export const ListCustomersRequestSchema = PaginationRequestSchema;

export const ListCustomersResponseSchema = z.object({
  customers: z.array(CustomerSchema),
  ...PaginationResponseMetaSchema.shape,
});

export type ListCustomersResponse = z.infer<typeof ListCustomersResponseSchema>;

// List plans with pagination
export const ListPlansRequestSchema = PaginationRequestSchema;

export const ListPlansResponseSchema = z.object({
  plans: z.array(PlanSchema),
  ...PaginationResponseMetaSchema.shape,
});

export type ListPlansResponse = z.infer<typeof ListPlansResponseSchema>;

// Get single subscription
export const GetSubscriptionRequestSchema = z.object({
  subscriptionId: z.string().min(1),
});

export const GetSubscriptionResponseSchema = z.object({
  subscription: SubscriptionSchema,
});

export type GetSubscriptionRequest = z.infer<typeof GetSubscriptionRequestSchema>;
export type GetSubscriptionResponse = z.infer<typeof GetSubscriptionResponseSchema>;

// Check subscription access
export const CheckSubscriptionRequestSchema = z.object({
  customerId: z.string().min(1),
});

export const CheckSubscriptionResponseSchema = z.object({
  allowed: z.boolean(),
  effectiveStatus: z.enum(["pending", "active", "canceled", "failed", "expired", "none"]),
});

export type CheckSubscriptionRequest = z.infer<typeof CheckSubscriptionRequestSchema>;
export type CheckSubscriptionResponse = z.infer<typeof CheckSubscriptionResponseSchema>;

// Get single customer
export const GetCustomerRequestSchema = z.object({
  customerId: z.string().min(1),
});

export const GetCustomerResponseSchema = z.object({
  customer: CustomerSchema,
});

export type GetCustomerRequest = z.infer<typeof GetCustomerRequestSchema>;
export type GetCustomerResponse = z.infer<typeof GetCustomerResponseSchema>;

// Webhook schemas
export const WebhookEventSchema = z.enum([
  "charge.success",
  "charge.failed/cancelled",
  "charge.reversed",
  "charge.refunded",
]);

export const WebhookPayloadSchema = z.object({
  event: WebhookEventSchema,
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().nullable().optional(),
  mobile: z.string().optional(),
  currency: z.string(),
  amount: z.string(),
  charge: z.string(),
  status: z.string(),
  mode: z.enum(["test", "live"]),
  reference: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  type: z.enum(["API", "Payment Link", "Event", "Donation"]),
  tx_ref: z.string(),
  payment_method: z.string().optional(),
  customization: z
    .object({
      title: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      logo: z.string().nullable().optional(),
    })
    .optional(),
  meta: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const WebhookRequestSchema = z.object({
  payload: WebhookPayloadSchema,
  rawBody: z.string(),
  headers: z.looseObject({}), // Allow any string keys and values
});

export const WebhookResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;
export type WebhookRequest = z.infer<typeof WebhookRequestSchema>;
export type WebhookResponse = z.infer<typeof WebhookResponseSchema>;
