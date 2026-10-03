import { createHash } from 'node:crypto';

import { Prisma, type WebhookEvent } from '@prisma/client';

import { prisma } from '../database/prisma';
import type { WebhookPayload } from './payload';

type AcceptedEvent = {
  duplicate: boolean;
  event: WebhookEvent;
};

export async function acceptWebhookEvent(
  payload: WebhookPayload,
  rawBody: Buffer,
): Promise<AcceptedEvent> {
  const payloadHash = createHash('sha256').update(rawBody).digest('hex');

  try {
    const event = await prisma.webhookEvent.create({
      data: {
        providerEventId: payload.eventId,
        type: payload.type,
        payload,
        payloadHash,
      },
    });

    return { duplicate: false, event };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const event = await prisma.webhookEvent.findUniqueOrThrow({
        where: { providerEventId: payload.eventId },
      });

      return { duplicate: true, event };
    }

    throw error;
  }
}

export async function getEventView(providerEventId: string) {
  return prisma.webhookEvent.findUnique({
    where: { providerEventId },
    select: {
      providerEventId: true,
      type: true,
      status: true,
      attemptCount: true,
      nextAttemptAt: true,
      lastErrorCode: true,
      processedAt: true,
      createdAt: true,
      updatedAt: true,
      attempts: {
        orderBy: { attemptNumber: 'asc' },
        select: {
          attemptNumber: true,
          status: true,
          errorCode: true,
          createdAt: true,
        },
      },
    },
  });
}

export async function requestManualRetry(providerEventId: string): Promise<boolean> {
  const result = await prisma.webhookEvent.updateMany({
    where: {
      providerEventId,
      status: 'FAILED',
    },
    data: {
      status: 'RETRY_PENDING',
      nextAttemptAt: new Date(),
      lastErrorCode: null,
    },
  });

  return result.count === 1;
}
