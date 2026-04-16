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

// Cancel subscription
export const CancelSubscriptionRequestSchema = z.object({
  subscriptionId: z.string().min(1),
  cancelAtPeriodEnd: z.boolean().default(false),
});

export const CancelSubscriptionResponseSchema = z.object({
  subscription: SubscriptionSchema,
});

// Create customer
export const CreateCustomerRequestSchema = CustomerInputSchema;

export const CreateCustomerResponseSchema = z.object({
  customer: CustomerSchema,
});

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

// List customers with pagination
export const ListCustomersRequestSchema = PaginationRequestSchema;

export const ListCustomersResponseSchema = z.object({
  customers: z.array(CustomerSchema),
  ...PaginationResponseMetaSchema.shape,
});

// List plans with pagination
export const ListPlansRequestSchema = PaginationRequestSchema;

export const ListPlansResponseSchema = z.object({
  plans: z.array(PlanSchema),
  ...PaginationResponseMetaSchema.shape,
});

// Get single subscription
export const GetSubscriptionRequestSchema = z.object({
  subscriptionId: z.string().min(1),
});

export const GetSubscriptionResponseSchema = z.object({
  subscription: SubscriptionSchema,
});

// Get single customer
export const GetCustomerRequestSchema = z.object({
  customerId: z.string().min(1),
});

export const GetCustomerResponseSchema = z.object({
  customer: CustomerSchema,
});
