import 'dotenv/config';

import { createApp } from './api/app';
import { config } from './config';
import { prisma } from './database/prisma';
import { logger } from './shared/logger';

const app = createApp();
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'API listening');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down API');
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
