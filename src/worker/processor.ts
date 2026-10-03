import { type WebhookEvent } from '@prisma/client';

import { config } from '../config';
import { prisma } from '../database/prisma';
import { logger } from '../shared/logger';
import { webhookPayloadSchema } from '../webhook/payload';

type ProcessingResult =
  | { outcome: 'processed'; eventId: string; attemptNumber: number }
  | { outcome: 'retry_scheduled'; eventId: string; attemptNumber: number }
  | { outcome: 'failed'; eventId: string; attemptNumber: number }
  | { outcome: 'skipped'; eventId: string };

function processingFailure(
  payload: ReturnType<typeof webhookPayloadSchema.parse>,
  attemptNumber: number,
): { errorCode: string; retryable: boolean } | null {
  if (payload.data.simulation.mode === 'success') {
    return null;
  }

  if (payload.data.simulation.mode === 'permanent_failure') {
    return { errorCode: 'SIMULATED_PERMANENT_FAILURE', retryable: false };
  }

  if (attemptNumber <= payload.data.simulation.failuresBeforeSuccess) {
    return { errorCode: 'SIMULATED_TRANSIENT_FAILURE', retryable: true };
  }

  return null;
}

async function claimEvent(eventId: string): Promise<WebhookEvent | null> {
  return prisma.$transaction(async (transaction) => {
    const event = await transaction.webhookEvent.findUnique({ where: { id: eventId } });

    if (!event || (event.status !== 'PENDING' && event.status !== 'RETRY_PENDING')) {
      return null;
    }

    if (event.nextAttemptAt && event.nextAttemptAt > new Date()) {
      return null;
    }

    const claimed = await transaction.webhookEvent.updateMany({
      where: {
        id: event.id,
        status: event.status,
        attemptCount: event.attemptCount,
      },
      data: { status: 'PROCESSING' },
    });

    return claimed.count === 1 ? event : null;
  });
}

export async function processEventById(eventId: string): Promise<ProcessingResult> {
  const event = await claimEvent(eventId);
  if (!event) {
    return { outcome: 'skipped', eventId };
  }

  const payload = webhookPayloadSchema.parse(event.payload);
  const attemptNumber = event.attemptCount + 1;
  const failure = processingFailure(payload, attemptNumber);

  if (!failure) {
    await prisma.$transaction([
      prisma.processingAttempt.create({
        data: {
          eventId: event.id,
          attemptNumber,
          status: 'SUCCESS',
        },
      }),
      prisma.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: 'PROCESSED',
          attemptCount: attemptNumber,
          nextAttemptAt: null,
          lastErrorCode: null,
          processedAt: new Date(),
        },
      }),
    ]);

    logger.info({ eventId: event.providerEventId, attemptNumber }, 'webhook event processed');
    return { outcome: 'processed', eventId, attemptNumber };
  }

  const canRetry = failure.retryable && attemptNumber < config.MAX_PROCESSING_ATTEMPTS;
  const nextAttemptAt = canRetry
    ? new Date(Date.now() + config.RETRY_BASE_DELAY_MS * 2 ** (attemptNumber - 1))
    : null;

  await prisma.$transaction([
    prisma.processingAttempt.create({
      data: {
        eventId: event.id,
        attemptNumber,
        status: failure.retryable ? 'RETRYABLE_FAILURE' : 'PERMANENT_FAILURE',
        errorCode: failure.errorCode,
      },
    }),
    prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: canRetry ? 'RETRY_PENDING' : 'FAILED',
        attemptCount: attemptNumber,
        nextAttemptAt,
        lastErrorCode: failure.errorCode,
      },
    }),
  ]);

  logger.warn(
    {
      eventId: event.providerEventId,
      attemptNumber,
      errorCode: failure.errorCode,
      retryScheduled: canRetry,
    },
    'webhook event processing failed',
  );

  return {
    outcome: canRetry ? 'retry_scheduled' : 'failed',
    eventId,
    attemptNumber,
  };
}

export async function runDueEvents(limit = 25): Promise<ProcessingResult[]> {
  const dueEvents = await prisma.webhookEvent.findMany({
    where: {
      status: { in: ['PENDING', 'RETRY_PENDING'] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  const results: ProcessingResult[] = [];
  for (const event of dueEvents) {
    results.push(await processEventById(event.id));
  }

  return results;
}
