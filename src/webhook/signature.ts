import { createHmac, timingSafeEqual } from 'node:crypto';

export function createWebhookSignature(rawBody: Buffer | string, secret: string): string {
  const digest = createHmac('sha256', secret).update(rawBody).digest('hex');
  return `sha256=${digest}`;
}

export function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const expected = Buffer.from(createWebhookSignature(rawBody, secret));
  const received = Buffer.from(signature.toLowerCase());

  return expected.length === received.length && timingSafeEqual(expected, received);
}
