import TelegramBot, { Message, CallbackQuery } from 'node-telegram-bot-api';
import { DatabaseService } from '../database/DatabaseService';
import { UrlValidator } from '../utils/urlValidator';
import { RateLimiter } from '../utils/rateLimiter';
import { ParserFactory } from '../parsers/ParserFactory';
import { Ad } from '../types';
import { logger } from '../utils/logger';

export class BotHandler {
  private bot: TelegramBot;
  private db: DatabaseService;
  private rateLimiter: RateLimiter;
  private userStates: Map<number, string> = new Map();

  constructor(token: string, db: DatabaseService) {
    this.bot = new TelegramBot(token, { polling: true });
    this.db = db;
    this.rateLimiter = new RateLimiter(10, 60000);
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.bot.on('message', async (msg: Message) => {
      if (!msg.from || !msg.text) return;

      const chatId = msg.chat.id;
      const userId = msg.from.id;

      if (!this.rateLimiter.isAllowed(userId)) {
        await this.bot.sendMessage(chatId, '⚠️ Слишком много запросов. Подождите минуту.');
        return;
      }

      if (msg.text === '/start') {
        await this.handleStart(chatId, userId, msg.from.username);
      } else if (this.userStates.get(userId) === 'awaiting_url') {
        await this.handleAddLink(chatId, userId, msg.text);
      }
    });

    this.bot.on('callback_query', async (query: CallbackQuery) => {
      if (!query.message || !query.from) return;

      const chatId = query.message.chat.id;
      const userId = query.from.id;
      const data = query.data;

      if (!this.rateLimiter.isAllowed(userId)) {
        await this.bot.answerCallbackQuery(query.id, { text: 'Слишком много запросов' });
        return;
      }

      await this.bot.answerCallbackQuery(query.id);

      if (data === 'add_link') {
        await this.handleAddLinkButton(chatId, userId);
      } else if (data === 'my_links') {
        await this.handleMyLinks(chatId, userId);
      } else if (data?.startsWith('delete_')) {
        const linkId = parseInt(data.replace('delete_', ''), 10);
        await this.handleDeleteLink(chatId, linkId);
      }
    });

    this.bot.on('polling_error', (error: Error) => {
      logger.error('Telegram polling error', { error: error.message });
    });

    logger.info('Bot handlers initialized');
  }

  async handleStart(chatId: number, userId: number, username?: string): Promise<void> {
    try {
      await this.db.createUser(userId, username || null);
      
      const keyboard = {
        inline_keyboard: [
          [{ text: '➕ Добавить ссылку', callback_data: 'add_link' }],
          [{ text: '📋 Мои ссылки', callback_data: 'my_links' }],
        ],
      };

      await this.bot.sendMessage(
        chatId,
        '👋 Привет! Я помогу отслеживать новые объявления на Kufar, Onliner и Realt.\n\n' +
        'Выберите действие:',
        { reply_markup: keyboard }
      );

      logger.info('User started bot', { userId, username });
    } catch (error: any) {
      logger.error('Failed to handle /start', { userId, error: error.message });
      await this.bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
  }

  async handleAddLinkButton(chatId: number, userId: number): Promise<void> {
    try {
      const user = await this.db.getUser(userId);
      if (!user) {
        await this.bot.sendMessage(chatId, '❌ Пользователь не найден. Отправьте /start');
        return;
      }

      const linksCount = await this.db.getUserLinksCount(user.id);
      if (linksCount >= 10) {
        await this.bot.sendMessage(chatId, '⚠️ Достигнут лимит в 10 ссылок. Удалите старые ссылки.');
        return;
      }

      this.userStates.set(userId, 'awaiting_url');
      await this.bot.sendMessage(
        chatId,
        '📎 Отправьте ссылку на страницу с фильтрами:\n\n' +
        '• Kufar.by\n' +
        '• Onliner.by (Барахолка или Авто)\n' +
        '• Realt.by'
      );
    } catch (error: any) {
      logger.error('Failed to handle add link button', { userId, error: error.message });
      await this.bot.sendMessage(chatId, '❌ Произошла ошибка.');
    }
  }

  async handleAddLink(chatId: number, userId: number, url: string): Promise<void> {
    try {
      this.userStates.delete(userId);

      const validation = UrlValidator.validateUrl(url);
      if (!validation.valid || !validation.platform) {
        await this.bot.sendMessage(
          chatId,
          '❌ Некорректная ссылка. Поддерживаются только:\n' +
          '• kufar.by/l/*\n' +
          '• baraholka.onliner.by/* или ab.onliner.by/*\n' +
          '• realt.by/*'
        );
        return;
      }

      const parser = ParserFactory.getParser(validation.platform);
      if (!parser || !parser.validateUrl(url)) {
        await this.bot.sendMessage(chatId, '❌ Ссылка не соответствует формату площадки.');
        return;
      }

      const user = await this.db.getUser(userId);
      if (!user) {
        await this.bot.sendMessage(chatId, '❌ Пользователь не найден. Отправьте /start');
        return;
      }

      await this.db.createLink(user.id, url, validation.platform);

      const platformEmoji = {
        kufar: '🟢',
        onliner: '🔵',
        realt: '🟠',
      };

      await this.bot.sendMessage(
        chatId,
        `✅ Ссылка добавлена!\n\n${platformEmoji[validation.platform]} ${validation.platform.toUpperCase()}\n${url}\n\n` +
        'Вы получите уведомление о новых объявлениях.'
      );

      logger.info('Link added', { userId, platform: validation.platform, url });
    } catch (error: any) {
      logger.error('Failed to add link', { userId, url, error: error.message });
      await this.bot.sendMessage(chatId, '❌ Не удалось добавить ссылку.');
    }
  }

  async handleMyLinks(chatId: number, userId: number): Promise<void> {
    try {
      const user = await this.db.getUser(userId);
      if (!user) {
        await this.bot.sendMessage(chatId, '❌ Пользователь не найден. Отправьте /start');
        return;
      }

      const links = await this.db.getUserLinks(user.id);

      if (links.length === 0) {
        const keyboard = {
          inline_keyboard: [[{ text: '➕ Добавить ссылку', callback_data: 'add_link' }]],
        };
        await this.bot.sendMessage(chatId, '📋 У вас пока нет ссылок.', { reply_markup: keyboard });
        return;
      }

      const platformEmoji = {
        kufar: '🟢',
        onliner: '🔵',
        realt: '🟠',
      };

      for (const link of links) {
        const status = link.is_active ? '✅ Активна' : '❌ Неактивна';
        const keyboard = {
          inline_keyboard: [[{ text: '🗑 Удалить', callback_data: `delete_${link.id}` }]],
        };

        await this.bot.sendMessage(
          chatId,
          `${platformEmoji[link.platform]} ${link.platform.toUpperCase()}\n\n` +
          `${link.url}\n\n` +
          `Статус: ${status}`,
          { reply_markup: keyboard }
        );
      }
    } catch (error: any) {
      logger.error('Failed to show links', { userId, error: error.message });
      await this.bot.sendMessage(chatId, '❌ Не удалось загрузить ссылки.');
    }
  }

  async handleDeleteLink(chatId: number, linkId: number): Promise<void> {
    try {
      await this.db.deleteLink(linkId);
      await this.bot.sendMessage(chatId, '✅ Ссылка удалена.');
      logger.info('Link deleted', { linkId });
    } catch (error: any) {
      logger.error('Failed to delete link', { linkId, error: error.message });
      await this.bot.sendMessage(chatId, '❌ Не удалось удалить ссылку.');
    }
  }

  async sendNotification(chatId: number, ad: Ad): Promise<void> {
    try {
      const message = `📢 Новое объявление!\n\n` +
        `${ad.title}\n\n` +
        `💰 ${ad.price || 'Цена не указана'}\n\n` +
        `🔗 ${ad.ad_url}`;

      if (ad.image_url) {
        await this.bot.sendPhoto(chatId, ad.image_url, { caption: message });
      } else {
        await this.bot.sendMessage(chatId, message);
      }
    } catch (error: any) {
      if (error.response?.statusCode === 403) {
        logger.warn('User blocked bot', { chatId });
      } else {
        logger.error('Failed to send notification', { chatId, error: error.message });
      }
    }
  }

  stop(): void {
    this.bot.stopPolling();
    logger.info('Bot stopped');
  }
}
