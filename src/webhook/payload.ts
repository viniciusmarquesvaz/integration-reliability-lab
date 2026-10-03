import { z } from 'zod';

export const webhookPayloadSchema = z.object({
  eventId: z.string().min(3).max(120),
  type: z.literal('payment.completed'),
  occurredAt: z.iso.datetime(),
  data: z.object({
    orderId: z.string().min(3).max(120),
    amountCents: z.number().int().positive().max(100_000_000),
    simulation: z
      .object({
        mode: z.enum(['success', 'transient_failure', 'permanent_failure']),
        failuresBeforeSuccess: z.number().int().min(0).max(10).default(1),
      })
      .default({ mode: 'success', failuresBeforeSuccess: 0 }),
  }),
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
