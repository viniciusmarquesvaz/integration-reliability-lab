import 'dotenv/config';

import { config } from './config';
import { prisma } from './database/prisma';
import { logger } from './shared/logger';
import { runDueEvents } from './worker/processor';

let stopping = false;

async function tick(): Promise<void> {
  if (stopping) {
    return;
  }

  try {
    const results = await runDueEvents();
    if (results.length > 0) {
      logger.info({ count: results.length }, 'worker cycle completed');
    }
  } catch (error) {
    logger.error({ err: error }, 'worker cycle failed');
  }
}

const interval = setInterval(() => void tick(), config.WORKER_INTERVAL_MS);
void tick();

async function shutdown(signal: string): Promise<void> {
  stopping = true;
  clearInterval(interval);
  logger.info({ signal }, 'shutting down worker');
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
