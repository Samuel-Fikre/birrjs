import type { Customer } from "../../types/models";
import { defineBirrJSMethod } from "../../api/endpoint";
import {
  CreateCustomerRequestSchema,
  UpdateCustomerRequestSchema,
  GetCustomerRequestSchema,
} from "../../api/schemas";
import { customer } from "../../database/schema";
import { eq } from "drizzle-orm";
import * as z from "zod";
import { BirrJSError, BIRRJS_ERROR_CODES } from "../../core/error-codes";

/**
 * Create customer
 */
export const createCustomer = defineBirrJSMethod(
  {
    route: {
      method: "POST",
      path: "/customers",
    },
  },
  async (ctx) => {
    const { database } = ctx.birrjs;
    const { email, name, metadata } = ctx.input as z.infer<typeof CreateCustomerRequestSchema>;

    const customerId = `cus_${Date.now()}`;
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
    route: {
      method: "PATCH",
      path: "/customers/:customerId",
    },
  },
  async (ctx) => {
    const { database } = ctx.birrjs;
    const { customerId, email, name, metadata } = ctx.input as z.infer<
      typeof UpdateCustomerRequestSchema
    >;

    const customers = await database
      .select()
      .from(customer)
      .where(eq(customer.id, customerId))
      .limit(1);
    const customerRecord = customers[0];
    if (!customerRecord) {
      throw BirrJSError.from("BAD_REQUEST", BIRRJS_ERROR_CODES.CUSTOMER_NOT_FOUND);
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
    route: {
      method: "GET",
      path: "/customers",
    },
  },
  async (ctx) => {
    const { database } = ctx.birrjs;
    const customers = await database.select().from(customer);
    return {
      customers: customers as Customer[],
      total: customers.length,
    };
  },
);

/**
 * Get customer
 */
export const getCustomer = defineBirrJSMethod(
  {
    route: {
      method: "GET",
      path: "/customers/:customerId",
    },
  },
  async (ctx) => {
    const { database } = ctx.birrjs;
    const { customerId } = ctx.input as z.infer<typeof GetCustomerRequestSchema>;

    const customers = await database
      .select()
      .from(customer)
      .where(eq(customer.id, customerId))
      .limit(1);
    const customerRecord = customers[0];
    if (!customerRecord) {
      throw BirrJSError.from("BAD_REQUEST", BIRRJS_ERROR_CODES.CUSTOMER_NOT_FOUND);
    }

    return {
      customer: customerRecord as Customer,
    };
  },
);
