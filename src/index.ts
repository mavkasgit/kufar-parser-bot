import * as dotenv from 'dotenv';
import { DatabaseService } from './database/DatabaseService';
import { BotHandler } from './bot/BotHandler';
import { ParserScheduler } from './scheduler/ParserScheduler';
import { logger } from './utils/logger';

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

if (!TELEGRAM_BOT_TOKEN) {
  logger.error('TELEGRAM_BOT_TOKEN is not set');
  process.exit(1);
}

if (!DATABASE_URL) {
  logger.error('DATABASE_URL is not set');
  process.exit(1);
}

async function main() {
  logger.info('Starting KufarEnjoyer Bot...');

  // Initialize database
  const db = new DatabaseService(DATABASE_URL!);
  await db.initialize();
  logger.info('Database initialized');

  // Initialize bot
  const bot = new BotHandler(TELEGRAM_BOT_TOKEN!, db);
  logger.info('Bot initialized');

  // Initialize scheduler
  const scheduler = new ParserScheduler(db, bot);
  scheduler.start();

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    scheduler.stop();
    bot.stop();
    await db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('KufarEnjoyer Bot is running!');
}

main().catch((error) => {
  logger.error('Fatal error', { error: error.message, stack: error.stack });
  process.exit(1);
});
