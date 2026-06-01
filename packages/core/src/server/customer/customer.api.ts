import { createHash, timingSafeEqual } from "node:crypto";

import { APIError } from "better-call";
import { desc, count, eq, isNull } from "drizzle-orm";
import * as z from "zod";

import { defineBirrJSMethod } from "../../api/endpoint";
import {
  CreateCustomerRequestSchema,
  UpdateCustomerRequestSchema,
  GetCustomerRequestSchema,
  GetCustomerWithDetailsRequestSchema,
  DeleteCustomerRequestSchema,
} from "../../api/schemas";
import { BirrJSError, BIRRJS_ERROR_CODES } from "../../core/error-codes";
import { customer } from "../../database/schema";
import type { Customer } from "../../types/models";
import { getCustomerByIdOrThrow, getCustomerWithDetails } from "./customer.service";

function safeCompare(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

function validateAdminAuth(ctx: {
  headers?: Headers;
  birrjs: { options: { adminSecret?: string } };
}): void {
  if (!ctx.headers) return;

  const auth = ctx.headers?.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    throw new APIError("UNAUTHORIZED", {
      message: "Missing or invalid Authorization header",
    });
  }
  const token = auth.slice(7);
  const adminSecret = ctx.birrjs.options.adminSecret;
  if (!adminSecret || !safeCompare(token, adminSecret)) {
    throw new APIError("UNAUTHORIZED", {
      message: "Invalid admin secret",
    });
  }
}

/**
 * Create customer
 */
export const createCustomer = defineBirrJSMethod(
  {
    input: CreateCustomerRequestSchema,
    route: {
      method: "POST",
      path: "/create-customer",
    },
  },
  async (ctx) => {
    const { database } = ctx.birrjs;
    const { email, name, metadata } = ctx.input;

    const customerId = `cus_${crypto.randomUUID()}`;
    const newCustomer: Customer = {
      id: customerId,
      email,
      name: name || null,
      metadata: (metadata as Record<string, string>) || null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await database.insert(customer).values(newCustomer);

    return {
      customer: newCustomer,
    };
  },
);

/**
 * Update customer
 */
export const updateCustomer = defineBirrJSMethod(
  {
    input: UpdateCustomerRequestSchema,
    route: {
      method: "PATCH",
      path: "/customers/:customerId",
      requireHeaders: true,
    },
  },
  async (ctx) => {
    validateAdminAuth(ctx);

    const { database } = ctx.birrjs;
    const { customerId, email, name, metadata } = ctx.input;

    await getCustomerByIdOrThrow(database, customerId);

    const updateData: Partial<Customer> = {
      updatedAt: new Date(),
    };
    if (email !== undefined) updateData.email = email;
    if (name !== undefined) updateData.name = name;
    if (metadata !== undefined) updateData.metadata = metadata as Record<string, string>;

    await database.update(customer).set(updateData).where(eq(customer.id, customerId));

    const updatedCustomers = await database
      .select()
      .from(customer)
      .where(eq(customer.id, customerId))
      .limit(1);

    return {
      customer: updatedCustomers[0] as Customer,
    };
  },
);

/**
 * List customers
 */
export const listCustomers = defineBirrJSMethod(
  {
    input: z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }),
    route: {
      method: "GET",
      path: "/list-customers",
      requireHeaders: true,
    },
  },
  async (ctx) => {
    validateAdminAuth(ctx);

    const { database } = ctx.birrjs;
    const { limit = 20, offset = 0 } = ctx.input as { limit?: number; offset?: number };

    const customers = await database
      .select()
      .from(customer)
      .where(isNull(customer.deletedAt))
      .limit(limit)
      .offset(offset)
      .orderBy(desc(customer.createdAt));

    const totalResult = await database
      .select({ value: count() })
      .from(customer)
      .where(isNull(customer.deletedAt));
    const total = totalResult[0]?.value || 0;

    return {
      customers: customers as Customer[],
      total,
      limit,
      offset,
    };
  },
);

/**
 * Get customer
 */
export const getCustomer = defineBirrJSMethod(
  {
    input: GetCustomerRequestSchema,
    route: {
      method: "GET",
      path: "/get-customer",
      requireHeaders: true,
    },
  },
  async (ctx) => {
    validateAdminAuth(ctx);

    const { database } = ctx.birrjs;
    const { customerId } = ctx.input;

    const customerRecord = await getCustomerByIdOrThrow(database, customerId);

    return {
      customer: customerRecord,
    };
  },
);

/**
 * Get customer with details (subscriptions, entitlements)
 */
export const getCustomerWithDetailsEndpoint = defineBirrJSMethod(
  {
    input: GetCustomerWithDetailsRequestSchema,
    route: {
      method: "GET",
      path: "/get-customer-with-details",
      requireHeaders: true,
    },
  },
  async (ctx) => {
    validateAdminAuth(ctx);

    const { database } = ctx.birrjs;
    const { customerId } = ctx.input;

    const details = await getCustomerWithDetails(database, customerId);
    if (!details) {
      throw BirrJSError.from("NOT_FOUND", BIRRJS_ERROR_CODES.CUSTOMER_NOT_FOUND);
    }

    return {
      customer: details,
    };
  },
);

/**
 * Delete customer (soft delete)
 */
export const deleteCustomer = defineBirrJSMethod(
  {
    input: DeleteCustomerRequestSchema,
    route: {
      method: "POST",
      path: "/delete-customer",
      requireHeaders: true,
    },
  },
  async (ctx) => {
    validateAdminAuth(ctx);

    const { database } = ctx.birrjs;
    const { customerId } = ctx.input;

    const customerRecord = await getCustomerByIdOrThrow(database, customerId);

    await database
      .update(customer)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(customer.id, customerRecord.id));

    return {
      success: true,
    };
  },
);
