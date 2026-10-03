process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:55433/reliability_lab_test?schema=public';
process.env.WEBHOOK_SECRET ??= 'test-webhook-secret-123456';
process.env.ADMIN_TOKEN ??= 'test-admin-token-123456789';
process.env.MAX_PROCESSING_ATTEMPTS ??= '3';
process.env.RETRY_BASE_DELAY_MS ??= '0';
process.env.WORKER_INTERVAL_MS ??= '1000';
process.env.LOG_LEVEL ??= 'silent';
