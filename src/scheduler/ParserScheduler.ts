import * as cron from 'node-cron';
import { DatabaseService } from '../database/DatabaseService';
import { ParserFactory } from '../parsers/ParserFactory';
import { BotHandler } from '../bot/BotHandler';
import { logger } from '../utils/logger';

export class ParserScheduler {
  private db: DatabaseService;
  private bot: BotHandler;
  private task: cron.ScheduledTask | null = null;
  private isRunning: boolean = false;
  private lastNotificationTime: Map<number, number> = new Map();

  constructor(db: DatabaseService, bot: BotHandler) {
    this.db = db;
    this.bot = bot;
  }

  start(): void {
    // Run every minute
    this.task = cron.schedule('* * * * *', async () => {
      if (this.isRunning) {
        logger.warn('Previous parsing still running, skipping this cycle');
        return;
      }
      await this.runParsing();
    });

    logger.info('Parser scheduler started (runs every minute)');
  }

  async runParsing(): Promise<void> {
    this.isRunning = true;
    const startTime = Date.now();

    try {
      const links = await this.db.getActiveLinks();
      logger.info('Starting parsing cycle', { linksCount: links.length });

      // Process links in parallel with limit
      const batchSize = 10;
      for (let i = 0; i < links.length; i += batchSize) {
        const batch = links.slice(i, i + batchSize);
        await Promise.all(batch.map(link => this.parseLink(link)));
        
        // Small delay between batches
        if (i + batchSize < links.length) {
          await this.sleep(1000);
        }
      }

      const duration = Date.now() - startTime;
      logger.info('Parsing cycle completed', { duration: `${duration}ms`, linksCount: links.length });
    } catch (error: any) {
      logger.error('Parsing cycle failed', { error: error.message });
    } finally {
      this.isRunning = false;
    }
  }

  private async parseLink(link: any): Promise<void> {
    try {
      const parser = ParserFactory.getParser(link.platform);
      if (!parser) {
        logger.error('No parser found for platform', { platform: link.platform, linkId: link.id });
        return;
      }

      const ads = await parser.parseUrl(link.url);
      await this.db.updateLastParsed(link.id);

      // Reset error count on successful parse
      if (link.error_count > 0) {
        await this.db.resetErrorCount(link.id);
      }

      // Process new ads
      let newAdsCount = 0;
      for (const adData of ads) {
        const isNew = await this.db.isNewAd(adData.external_id);
        if (isNew) {
          const ad = await this.db.createAd(link.id, adData);
          if (ad) {
            // Check notification throttling (max 1 per minute per link)
            const lastNotif = this.lastNotificationTime.get(link.id) || 0;
            const now = Date.now();
            if (now - lastNotif >= 60000) {
              // Get user's telegram_id
              const user = await this.db.getUser(link.user_id);
              if (user) {
                await this.bot.sendNotification(user.telegram_id, ad);
                this.lastNotificationTime.set(link.id, now);
                newAdsCount++;
              }
            }
          }
        }
      }

      if (newAdsCount > 0) {
        logger.info('New ads found and notified', { linkId: link.id, newAdsCount });
      }
    } catch (error: any) {
      logger.error('Failed to parse link', { linkId: link.id, url: link.url, error: error.message });
      
      await this.db.incrementErrorCount(link.id);
      const updatedLink = await this.db.getUserLinks(link.user_id);
      const currentLink = updatedLink.find(l => l.id === link.id);
      
      if (currentLink && currentLink.error_count >= 5) {
        await this.db.markLinkInactive(link.id);
        logger.warn('Link marked as inactive due to errors', { linkId: link.id, errorCount: currentLink.error_count });
      }
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      logger.info('Parser scheduler stopped');
    }
  }
}
