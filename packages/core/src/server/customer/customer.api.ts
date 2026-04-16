import type { Customer } from "../../types/models";
import { defineBirrJSMethod } from "../../api/endpoint";
import {
  CreateCustomerRequestSchema,
  UpdateCustomerRequestSchema,
  GetCustomerRequestSchema,
} from "../../api/schemas";
import { customer } from "../../database/schema";
import { eq, desc, count } from "drizzle-orm";
import { BirrJSError, BIRRJS_ERROR_CODES } from "../../core/error-codes";
import * as z from "zod";

/**
 * Create customer
 */
export const createCustomer = defineBirrJSMethod(
  {
    input: CreateCustomerRequestSchema,
    route: {
      method: "POST",
      path: "/customers",
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
    },
  },
  async (ctx) => {
    const { database } = ctx.birrjs;
    const { customerId, email, name, metadata } = ctx.input;

    const customers = await database
      .select()
      .from(customer)
      .where(eq(customer.id, customerId))
      .limit(1);
    const customerRecord = customers[0];
    if (!customerRecord) {
      throw BirrJSError.from("NOT_FOUND", BIRRJS_ERROR_CODES.CUSTOMER_NOT_FOUND);
    }

    const updateData: any = {
      updatedAt: new Date(),
    };
    if (email) updateData.email = email;
    if (name) updateData.name = name;
    if (metadata) updateData.metadata = metadata as Record<string, string>;

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
      path: "/customers",
    },
  },
  async (ctx) => {
    const { database } = ctx.birrjs;
    const { limit = 20, offset = 0 } = ctx.input as { limit?: number; offset?: number };

    const customers = await database
      .select()
      .from(customer)
      .limit(limit)
      .offset(offset)
      .orderBy(desc(customer.createdAt));

    const totalResult = await database.select({ value: count() }).from(customer);
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
      path: "/customers/:customerId",
    },
  },
  async (ctx) => {
    const { database } = ctx.birrjs;
    const { customerId } = ctx.input;

    const customers = await database
      .select()
      .from(customer)
      .where(eq(customer.id, customerId))
      .limit(1);
    const customerRecord = customers[0];
    if (!customerRecord) {
      throw BirrJSError.from("NOT_FOUND", BIRRJS_ERROR_CODES.CUSTOMER_NOT_FOUND);
    }

    return {
      customer: customerRecord as Customer,
    };
  },
);
