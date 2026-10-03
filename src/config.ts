import { z } from 'zod';

const environmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  WEBHOOK_SECRET: z.string().min(16),
  ADMIN_TOKEN: z.string().min(16),
  MAX_PROCESSING_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  RETRY_BASE_DELAY_MS: z.coerce.number().int().min(0).default(1_000),
  WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),
});

export const config = environmentSchema.parse(process.env);
