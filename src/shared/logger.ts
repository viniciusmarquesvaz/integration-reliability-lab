import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.x-admin-token',
      'req.headers.x-webhook-signature',
    ],
    censor: '[REDACTED]',
  },
});
