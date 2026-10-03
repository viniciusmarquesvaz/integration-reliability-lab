import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/api/app';
import { config } from '../src/config';
import { prisma } from '../src/database/prisma';
import { createWebhookSignature } from '../src/webhook/signature';
import { processEventById } from '../src/worker/processor';

const app = createApp();

type SimulationMode = 'success' | 'transient_failure' | 'permanent_failure';

function payload(
  mode: SimulationMode = 'success',
  failuresBeforeSuccess = 0,
  eventId = `evt_${randomUUID()}`,
) {
  return {
    eventId,
    type: 'payment.completed' as const,
    occurredAt: new Date().toISOString(),
    data: {
      orderId: `order_${randomUUID()}`,
      amountCents: 12_500,
      simulation: { mode, failuresBeforeSuccess },
    },
  };
}

function signedRequestBody(body: ReturnType<typeof payload>) {
  const rawBody = JSON.stringify(body);
  return {
    rawBody,
    signature: createWebhookSignature(rawBody, config.WEBHOOK_SECRET),
  };
}

async function postWebhook(body: ReturnType<typeof payload>) {
  const signed = signedRequestBody(body);
  return request(app)
    .post('/webhooks/provider')
    .set('content-type', 'application/json')
    .set('x-webhook-signature', signed.signature)
    .send(signed.rawBody);
}

beforeEach(async () => {
  await prisma.processingAttempt.deleteMany();
  await prisma.webhookEvent.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('webhook ingestion', () => {
  it('rejects an invalid signature without persistence', async () => {
    const body = payload();

    const response = await request(app)
      .post('/webhooks/provider')
      .set('content-type', 'application/json')
      .set('x-webhook-signature', `sha256=${'0'.repeat(64)}`)
      .send(JSON.stringify(body));

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'invalid_signature' });
    await expect(prisma.webhookEvent.count()).resolves.toBe(0);
  });

  it('accepts a valid signed event', async () => {
    const body = payload();
    const response = await postWebhook(body);

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      eventId: body.eventId,
      status: 'PENDING',
      duplicate: false,
    });
  });

  it('does not duplicate an event effect', async () => {
    const body = payload();

    expect((await postWebhook(body)).status).toBe(202);
    const duplicate = await postWebhook(body);

    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toMatchObject({ duplicate: true, eventId: body.eventId });
    await expect(prisma.webhookEvent.count()).resolves.toBe(1);
  });
});

describe('event processing', () => {
  it('retries a transient failure and then succeeds', async () => {
    const body = payload('transient_failure', 1);
    await postWebhook(body);
    const event = await prisma.webhookEvent.findUniqueOrThrow({
      where: { providerEventId: body.eventId },
    });

    await expect(processEventById(event.id)).resolves.toMatchObject({
      outcome: 'retry_scheduled',
      attemptNumber: 1,
    });
    await expect(processEventById(event.id)).resolves.toMatchObject({
      outcome: 'processed',
      attemptNumber: 2,
    });

    const processed = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(processed.status).toBe('PROCESSED');
    expect(processed.attemptCount).toBe(2);
  });

  it('moves an exhausted transient failure to the final failed state', async () => {
    const body = payload('transient_failure', 10);
    await postWebhook(body);
    const event = await prisma.webhookEvent.findUniqueOrThrow({
      where: { providerEventId: body.eventId },
    });

    await processEventById(event.id);
    await processEventById(event.id);
    await expect(processEventById(event.id)).resolves.toMatchObject({
      outcome: 'failed',
      attemptNumber: 3,
    });

    const failed = await prisma.webhookEvent.findUniqueOrThrow({
      where: { id: event.id },
      include: { attempts: true },
    });
    expect(failed.status).toBe('FAILED');
    expect(failed.attemptCount).toBe(3);
    expect(failed.attempts).toHaveLength(3);
  });

  it('does not retry a permanent failure', async () => {
    const body = payload('permanent_failure');
    await postWebhook(body);
    const event = await prisma.webhookEvent.findUniqueOrThrow({
      where: { providerEventId: body.eventId },
    });

    await expect(processEventById(event.id)).resolves.toMatchObject({
      outcome: 'failed',
      attemptNumber: 1,
    });

    const failed = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.lastErrorCode).toBe('SIMULATED_PERMANENT_FAILURE');
  });

  it('returns processing history without exposing the stored payload', async () => {
    const body = payload();
    await postWebhook(body);
    const event = await prisma.webhookEvent.findUniqueOrThrow({
      where: { providerEventId: body.eventId },
    });
    await processEventById(event.id);

    const response = await request(app).get(`/events/${body.eventId}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      providerEventId: body.eventId,
      status: 'PROCESSED',
      attemptCount: 1,
    });
    expect(response.body).not.toHaveProperty('payload');
    expect(response.body).toMatchObject({
      attempts: [expect.objectContaining({ attemptNumber: 1, status: 'SUCCESS' })],
    });
  });
});
