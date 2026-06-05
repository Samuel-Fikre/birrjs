import * as z from "zod";

export const ChapaWebhookEventSchema = z.object({
  event: z.string(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  email: z.string().nullable(),
  mobile: z.string().nullable(),
  currency: z.string(),
  amount: z.string(),
  charge: z.string(),
  status: z.string(),
  mode: z.string(),
  reference: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  type: z.string(),
  tx_ref: z.string(),
  payment_method: z.string(),
  customization: z
    .object({
      title: z.string().nullable(),
      description: z.string().nullable(),
      logo: z.string().nullable(),
    })
    .nullable(),
  meta: z.unknown().nullable(),
});

export type ChapaWebhookEvent = z.infer<typeof ChapaWebhookEventSchema>;
