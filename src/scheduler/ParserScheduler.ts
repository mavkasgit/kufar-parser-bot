import * as cron from 'node-cron';
import { DatabaseService } from '../database/DatabaseService';
import { ParserFactory } from '../parsers/ParserFactory';
import { BotHandler } from '../bot/BotHandler';
import { logger } from '../utils/logger';

export class ParserScheduler {
  private db: DatabaseService;
  private bot: BotHandler;
  private task: cron.ScheduledTask | null = null;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private intervalMs: number;

  constructor(db: DatabaseService, bot: BotHandler) {
    this.db = db;
    this.bot = bot;
    
    // Читаем интервал из переменной окружения (в секундах)
    // По умолчанию 300 секунд (5 минут)
    const intervalSeconds = parseInt(process.env.PARSE_INTERVAL_SECONDS || '300', 10);
    this.intervalMs = intervalSeconds * 1000;
    
    logger.info('Parser scheduler configured', { 
      intervalSeconds, 
      intervalMinutes: (intervalSeconds / 60).toFixed(1) 
    });
  }

  start(): void {
    // Запускаем сразу при старте
    this.runParsing();
    
    // Затем запускаем по интервалу
    this.intervalId = setInterval(async () => {
      if (this.isRunning) {
        logger.warn('Previous parsing still running, skipping this cycle');
        return;
      }
      await this.runParsing();
    }, this.intervalMs);

    logger.info('Parser scheduler started', { 
      intervalMs: this.intervalMs,
      intervalMinutes: (this.intervalMs / 60000).toFixed(1)
    });
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
      const newAds: any[] = [];
      for (const adData of ads) {
        const isNew = await this.db.isNewAd(adData.external_id);
        if (isNew) {
          const ad = await this.db.createAd(link.id, adData);
          if (ad) {
            newAds.push(ad);
          }
        }
      }

      logger.info('Processed ads for link', { 
        linkId: link.id, 
        totalAds: ads.length, 
        newAds: newAds.length 
      });

      // Send notifications for new ads (max 5 per cycle to avoid spam)
      if (newAds.length > 0) {
        logger.info('Attempting to send notifications', { 
          linkId: link.id, 
          userId: link.user_id,
          newAdsCount: newAds.length 
        });
        
        const user = await this.db.getUserById(link.user_id);
        if (!user) {
          logger.error('User not found for link', { linkId: link.id, userId: link.user_id });
          return;
        }
        
        logger.info('User found, sending notifications', { 
          userId: user.id, 
          telegramId: user.telegram_id 
        });
        
        // Сортируем объявления по дате публикации (от старых к новым)
        const sortedAds = newAds.sort((a, b) => {
          const dateA = a.published_at ? new Date(a.published_at).getTime() : 0;
          const dateB = b.published_at ? new Date(b.published_at).getTime() : 0;
          return dateA - dateB;
        });
        
        // Берем последние 5 объявлений (самые новые по дате публикации)
        const adsToNotify = sortedAds.slice(-5);
        
        for (const ad of adsToNotify) {
          try {
            logger.info('Sending notification for ad', { 
              adId: ad.id, 
              telegramId: user.telegram_id 
            });
            await this.bot.sendNotification(user.telegram_id, ad);
            // Delay between notifications to prevent message merging
            await this.sleep(3000);
          } catch (error: any) {
            logger.error('Failed to send notification', { 
              linkId: link.id, 
              adId: ad.id, 
              error: error.message,
              stack: error.stack
            });
          }
        }
        
        logger.info('New ads found and notified', { 
          linkId: link.id, 
          totalNew: newAds.length,
          notified: adsToNotify.length 
        });
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
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    logger.info('Parser scheduler stopped');
  }
}
