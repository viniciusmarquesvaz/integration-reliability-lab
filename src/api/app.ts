import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import pinoHttp from 'pino-http';

import { config } from '../config';
import { logger } from '../shared/logger';
import {
  acceptWebhookEvent,
  getEventView,
  requestManualRetry,
} from '../webhook/event-service';
import { webhookPayloadSchema } from '../webhook/payload';
import { verifyWebhookSignature } from '../webhook/signature';
import { runDueEvents } from '../worker/processor';

type RawBodyRequest = Request & { rawBody?: Buffer };
type EventParams = { providerEventId: string };

function requireAdminToken(request: Request, response: Response, next: NextFunction): void {
  if (request.header('x-admin-token') !== config.ADMIN_TOKEN) {
    response.status(401).json({ error: 'unauthorized' });
    return;
  }

  next();
}

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    pinoHttp({
      logger,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.x-admin-token',
          'req.headers.x-webhook-signature',
        ],
        censor: '[REDACTED]',
      },
    }),
  );
  app.use(
    express.json({
      limit: '64kb',
      verify: (request, _response, buffer) => {
        (request as RawBodyRequest).rawBody = Buffer.from(buffer);
      },
    }),
  );

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.post('/webhooks/provider', async (request: RawBodyRequest, response) => {
    if (!request.rawBody) {
      response.status(400).json({ error: 'missing_raw_body' });
      return;
    }

    const signature = request.header('x-webhook-signature');
    if (!verifyWebhookSignature(request.rawBody, signature, config.WEBHOOK_SECRET)) {
      response.status(401).json({ error: 'invalid_signature' });
      return;
    }

    const parsedPayload = webhookPayloadSchema.safeParse(request.body);
    if (!parsedPayload.success) {
      response.status(422).json({
        error: 'invalid_payload',
        fields: parsedPayload.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }

    const accepted = await acceptWebhookEvent(parsedPayload.data, request.rawBody);
    response.status(accepted.duplicate ? 200 : 202).json({
      eventId: accepted.event.providerEventId,
      status: accepted.event.status,
      duplicate: accepted.duplicate,
    });
  });

  app.get<EventParams>('/events/:providerEventId', async (request, response) => {
    const event = await getEventView(request.params.providerEventId);
    if (!event) {
      response.status(404).json({ error: 'event_not_found' });
      return;
    }

    response.json(event);
  });

  app.post('/internal/process-pending', requireAdminToken, async (_request, response) => {
    const results = await runDueEvents();
    response.json({ processed: results.length, results });
  });

  app.post(
    '/internal/events/:providerEventId/retry',
    requireAdminToken,
    async (request: Request<EventParams>, response) => {
      const queued = await requestManualRetry(request.params.providerEventId);
      if (!queued) {
        response.status(409).json({ error: 'event_not_retryable' });
        return;
      }

      response.status(202).json({ status: 'RETRY_PENDING' });
    },
  );

  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    request.log.error({ err: error }, 'unhandled request error');
    response.status(500).json({ error: 'internal_error' });
  });

  return app;
}
