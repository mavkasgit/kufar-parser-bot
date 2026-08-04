import TelegramBot from 'node-telegram-bot-api';
import { FormattedAd } from './AdPresenter';
import { logger } from '../utils/logger';

export class TelegramSender {
  private bot: TelegramBot;

  constructor(bot: TelegramBot) {
    this.bot = bot;
  }

  async send(chatId: number, ad: FormattedAd): Promise<void> {
    await this.bot.sendMessage(chatId, ad.text);

    if (ad.media.length > 0) {
      try {
        if (ad.media.length === 1) {
          await this.bot.sendPhoto(chatId, ad.media[0]);
        } else {
          const inputMedia: TelegramBot.InputMediaPhoto[] = ad.media.map(url => ({ type: 'photo', media: url }));
          try {
            await this.bot.sendMediaGroup(chatId, inputMedia);
          } catch (error: any) {
            logger.warn('Failed to send media group, falling back to single photo', {
              error: error.message,
              count: ad.media.length,
            });
            await this.bot.sendPhoto(chatId, ad.media[0]);
          }
        }
      } catch (error: any) {
        logger.warn('Failed to send media', { error: error.message, count: ad.media.length });
      }
    }

    if (ad.location) {
      try {
        await this.bot.sendVenue(
          chatId,
          ad.location.lat,
          ad.location.lon,
          ad.location.title,
          ad.location.address
        );
      } catch (error: any) {
        logger.warn('Failed to send venue', { error: error.message });
      }
    }
  }

  async sendBatch(chatId: number, ads: FormattedAd[]): Promise<void> {
    for (let i = 0; i < ads.length; i++) {
      await this.send(chatId, ads[i]);
      if (i < ads.length - 1) {
        await this.sleep(3000);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
