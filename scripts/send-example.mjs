import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const filePath = resolve(process.argv[2] ?? 'examples/payment-success.json');
const endpoint = process.env.WEBHOOK_URL ?? 'http://localhost:3000/webhooks/provider';
const secret = process.env.WEBHOOK_SECRET ?? 'local-development-webhook-secret';
const rawBody = await readFile(filePath, 'utf8');
const digest = createHmac('sha256', secret).update(rawBody).digest('hex');

const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-webhook-signature': `sha256=${digest}`,
  },
  body: rawBody,
});

console.log(response.status, await response.text());
process.exitCode = response.ok ? 0 : 1;
