import TelegramBot, { Message, CallbackQuery } from 'node-telegram-bot-api';
import { DatabaseService } from '../database/DatabaseService';
import { UrlValidator } from '../utils/urlValidator';
import { RateLimiter } from '../utils/rateLimiter';
import { ParserFactory } from '../parsers/ParserFactory';
import { YandexMapsService } from '../services/YandexMapsService';
import { Ad, Platform, AdData } from '../types';
import { logger } from '../utils/logger';

export class BotHandler {
  private bot: TelegramBot;
  private db: DatabaseService;
  private rateLimiter: RateLimiter;
  private userStates: Map<number, string> = new Map();
  private yandexMaps: YandexMapsService | null = null;
  private adCache: Map<string, AdData> = new Map(); // Кэш объявлений для показа на карте
  private pendingLinks: Map<number, string> = new Map(); // userId -> URL для подтверждения

  constructor(token: string, db: DatabaseService) {
    this.bot = new TelegramBot(token, { polling: true });
    this.db = db;
    this.rateLimiter = new RateLimiter(10, 60000);

    // Инициализируем Yandex Maps если есть API ключ
    const yandexApiKey = process.env.YANDEX_MAPS_API_KEY;
    if (yandexApiKey) {
      this.yandexMaps = new YandexMapsService(yandexApiKey);
      logger.info('Yandex Maps service initialized');
    } else {
      logger.warn('YANDEX_MAPS_API_KEY not set, map features disabled');
    }

    this.setupHandlers();
  }

  private getMainKeyboard() {
    return {
      keyboard: [
        [{ text: '➕ Добавить ссылку' }],
        [{ text: '📋 Мои ссылки' }, { text: '🗑 Удалить все ссылки' }],
      ],
      resize_keyboard: true,
      persistent: true,
    };
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
      } else if (msg.text === '➕ Добавить ссылку') {
        await this.handleAddLinkButton(chatId, userId);
      } else if (msg.text === '📋 Мои ссылки') {
        await this.handleMyLinks(chatId, userId);
      } else if (msg.text === '🗑 Удалить все ссылки') {
        await this.handleDeleteAllLinks(chatId, userId);
      } else if (this.userStates.get(userId) === 'awaiting_url') {
        await this.handleAddLink(chatId, userId, msg.text);
      } else if (msg.text && (msg.text.startsWith('http://') || msg.text.startsWith('https://'))) {
        // Пользователь отправил ссылку напрямую - показываем превью
        await this.handleDirectLink(chatId, userId, msg.text);
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
      } else if (data === 'delete_all') {
        await this.handleDeleteAllLinks(chatId, userId);
      } else if (data === 'confirm_delete_all') {
        await this.handleConfirmDeleteAll(chatId, userId);
      } else if (data === 'cancel_delete_all') {
        await this.handleCancelDeleteAll(chatId);
      } else if (data?.startsWith('check_')) {
        const linkId = parseInt(data.replace('check_', ''), 10);
        await this.handleCheckLink(chatId, linkId);
      } else if (data?.startsWith('map_')) {
        const adId = data.replace('map_', '');
        await this.handleShowMap(chatId, adId);
      } else if (data === 'confirm_add_link') {
        await this.handleConfirmAddLink(chatId, userId);
      } else if (data === 'cancel_add_link') {
        await this.handleCancelAddLink(chatId, userId);
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

      await this.bot.sendMessage(
        chatId,
        '👋 Привет! Я помогу отслеживать новые объявления на Kufar, Onliner и av.by.\n\n' +
        'Используйте кнопки снизу для управления ссылками.',
        { reply_markup: this.getMainKeyboard() }
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
        '📎 Отправьте ссылку на страницу поиска с фильтрами:\n\n' +
        '• Kufar.by - страница категории с фильтрами\n' +
        '• Onliner.by - Барахолка, Авто (страница поиска), Недвижимость (карта)\n' +
        '• av.by - страница поиска с фильтрами\n\n' +
        '⚠️ Не отправляйте ссылки на конкретные объявления!',
        { reply_markup: this.getMainKeyboard() }
      );
    } catch (error: any) {
      logger.error('Failed to handle add link button', { userId, error: error.message });
      await this.bot.sendMessage(chatId, '❌ Произошла ошибка.');
    }
  }

  async handleAddLink(chatId: number, userId: number, url: string): Promise<void> {
    try {
      this.userStates.delete(userId);

      // Handle cancel
      if (url === '❌ Отмена') {
        const keyboard = {
          keyboard: [
            [{ text: '➕ Добавить ссылку' }, { text: '📋 Мои ссылки' }],
          ],
          resize_keyboard: true,
          persistent: true,
        };
        await this.bot.sendMessage(chatId, '❌ Отменено.', { reply_markup: keyboard });
        return;
      }

      const validation = UrlValidator.validateUrl(url);
      if (!validation.valid || !validation.platform) {
        const errorMsg = validation.error || 'Некорректная ссылка';
        await this.bot.sendMessage(
          chatId,
          `❌ ${errorMsg}\n\n` +
          'Поддерживаются страницы поиска:\n' +
          '• kufar.by/l/* (страница с фильтрами)\n' +
          '• ab.onliner.by/brand/model (без ID объявления)\n' +
          '• baraholka.onliner.by/* (страница категории)\n' +
          '• r.onliner.by/ak/ (карта с фильтрами)\n' +
          '• av.by/cars/* (страница поиска)'
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

      // Проверяем дубликаты
      const existingLinks = await this.db.getUserLinks(user.id);
      const isDuplicate = existingLinks.some(link => link.url === url);
      if (isDuplicate) {
        await this.bot.sendMessage(chatId, '⚠️ Эта ссылка уже добавлена!');
        return;
      }

      // Test parsing before adding link
      await this.bot.sendMessage(chatId, '⏳ Проверяю ссылку...');

      let testAds: AdData[] = [];
      try {
        testAds = await parser.parseUrl(url);

        if (testAds.length === 0) {
          await this.bot.sendMessage(
            chatId,
            '❌ По этой ссылке не найдено объявлений.\n\n' +
            'Возможные причины:\n' +
            '• Неправильные фильтры\n' +
            '• Ссылка на конкретное объявление\n' +
            '• Временная проблема с сайтом\n\n' +
            'Попробуйте другую ссылку.'
          );
          return;
        }
      } catch (error: any) {
        logger.error('Failed to test parse link', { userId, url, error: error.message });
        await this.bot.sendMessage(
          chatId,
          '❌ Не удалось проверить ссылку.\n\n' +
          `Ошибка: ${error.message}\n\n` +
          'Попробуйте другую ссылку или повторите позже.'
        );
        return;
      }

      // Link is valid, add it to database
      await this.db.createLink(user.id, url, validation.platform);

      const platformEmoji: Record<Platform, string> = {
        kufar: '🟢',
        onliner: '🔵',
        av: '🚗',
      };

      const keyboard = {
        keyboard: [
          [{ text: '➕ Добавить ссылку' }, { text: '📋 Мои ссылки' }],
        ],
        resize_keyboard: true,
        persistent: true,
      };

      await this.bot.sendMessage(
        chatId,
        `✅ Ссылка добавлена и работает!\n\n${platformEmoji[validation.platform]} ${validation.platform.toUpperCase()}\n${url}\n\n` +
        `Найдено объявлений: ${testAds.length}\n\n` +
        'Вы получите уведомление о новых объявлениях.',
        { reply_markup: keyboard }
      );

      // Show last 5 ads as preview (from oldest to newest)
      const previewAds = testAds.slice(-5).reverse();
      await this.bot.sendMessage(chatId, `📋 Последние ${previewAds.length} объявлений:`);

      for (const ad of previewAds) {
        await this.sendAdWithMap(chatId, ad);
      }

      logger.info('Link added', { userId, platform: validation.platform, url, adsFound: testAds.length });
    } catch (error: any) {
      logger.error('Failed to add link', { userId, url, error: error.message, stack: error.stack });

      // Определяем тип ошибки и показываем понятное сообщение
      let errorMessage = '❌ Не удалось добавить ссылку.';

      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        errorMessage = '❌ Не удалось подключиться к сайту. Проверьте интернет-соединение или попробуйте позже.';
      } else if (error.response?.status === 403) {
        errorMessage = '❌ Доступ к сайту заблокирован. Попробуйте позже.';
      } else if (error.response?.status === 404) {
        errorMessage = '❌ Страница не найдена. Проверьте правильность ссылки.';
      } else if (error.response?.status === 429) {
        errorMessage = '❌ Слишком много запросов к сайту. Подождите немного и попробуйте снова.';
      } else if (error.response?.status >= 500) {
        errorMessage = '❌ Сайт временно недоступен. Попробуйте позже.';
      } else if (error.message?.includes('timeout')) {
        errorMessage = '❌ Превышено время ожидания ответа от сайта. Попробуйте позже.';
      } else if (error.message?.includes('parse') || error.message?.includes('JSON')) {
        errorMessage = '❌ Ошибка обработки данных с сайта. Возможно, сайт изменил формат страницы.';
      }

      await this.bot.sendMessage(chatId, errorMessage);
    }
  }

  async handleDirectLink(chatId: number, userId: number, url: string): Promise<void> {
    try {
      // Проверяем валидность ссылки
      const validation = UrlValidator.validateUrl(url);
      if (!validation.valid || !validation.platform) {
        await this.bot.sendMessage(chatId, '❌ Эта ссылка не поддерживается. Используйте ссылки на Kufar, Onliner или av.by.');
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

      // Проверяем лимит
      const linksCount = await this.db.getUserLinksCount(user.id);
      if (linksCount >= 10) {
        await this.bot.sendMessage(chatId, '⚠️ Достигнут лимит в 10 ссылок. Удалите старые ссылки.');
        return;
      }

      // Проверяем дубликаты
      const existingLinks = await this.db.getUserLinks(user.id);
      const isDuplicate = existingLinks.some(link => link.url === url);
      if (isDuplicate) {
        await this.bot.sendMessage(chatId, '⚠️ Эта ссылка уже добавлена в ваш список!');
        return;
      }

      await this.bot.sendMessage(chatId, '⏳ Проверяю ссылку...');

      // Парсим ссылку
      const testAds = await parser.parseUrl(url);

      if (testAds.length === 0) {
        await this.bot.sendMessage(chatId, '❌ По этой ссылке не найдено объявлений.');
        return;
      }

      // Сохраняем ссылку для подтверждения
      this.pendingLinks.set(userId, url);

      const platformEmoji: Record<Platform, string> = {
        kufar: '🟢',
        onliner: '🔵',
        av: '🚗',
      };

      await this.bot.sendMessage(
        chatId,
        `${platformEmoji[validation.platform]} ${validation.platform.toUpperCase()}\n${url}\n\n` +
        `Найдено объявлений: ${testAds.length}`
      );

      // Показываем превью (от старого к новому)
      const previewAds = testAds.slice(-5).reverse();
      await this.bot.sendMessage(chatId, `📋 Последние ${previewAds.length} объявлений:`);

      for (const ad of previewAds) {
        await this.sendAdWithMap(chatId, ad);
      }

      // Кнопки подтверждения
      const confirmKeyboard = {
        inline_keyboard: [
          [
            { text: '✅ Добавить эту ссылку', callback_data: 'confirm_add_link' },
            { text: '❌ Отмена', callback_data: 'cancel_add_link' }
          ]
        ],
      };

      await this.bot.sendMessage(
        chatId,
        '❓ Хотите добавить эту ссылку для отслеживания новых объявлений?',
        { reply_markup: confirmKeyboard }
      );

      logger.info('Direct link preview shown', { userId, platform: validation.platform, url, adsFound: testAds.length });
    } catch (error: any) {
      logger.error('Failed to handle direct link', { userId, url, error: error.message, stack: error.stack });

      let errorMessage = '❌ Не удалось проверить ссылку.';

      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        errorMessage = '❌ Не удалось подключиться к сайту. Проверьте интернет-соединение.';
      } else if (error.response?.status === 403) {
        errorMessage = '❌ Доступ к сайту заблокирован. Попробуйте позже.';
      } else if (error.response?.status === 404) {
        errorMessage = '❌ Страница не найдена. Проверьте правильность ссылки.';
      } else if (error.response?.status === 429) {
        errorMessage = '❌ Слишком много запросов. Подождите немного.';
      } else if (error.response?.status >= 500) {
        errorMessage = '❌ Сайт временно недоступен. Попробуйте позже.';
      } else if (error.message?.includes('timeout')) {
        errorMessage = '❌ Превышено время ожидания. Попробуйте позже.';
      }

      await this.bot.sendMessage(chatId, errorMessage);
    }
  }

  async handleConfirmAddLink(chatId: number, userId: number): Promise<void> {
    try {
      const url = this.pendingLinks.get(userId);
      if (!url) {
        await this.bot.sendMessage(chatId, '❌ Ссылка не найдена. Попробуйте отправить её снова.');
        return;
      }

      const validation = UrlValidator.validateUrl(url);
      if (!validation.valid || !validation.platform) {
        await this.bot.sendMessage(chatId, '❌ Ошибка валидации ссылки.');
        this.pendingLinks.delete(userId);
        return;
      }

      const user = await this.db.getUser(userId);
      if (!user) {
        await this.bot.sendMessage(chatId, '❌ Пользователь не найден.');
        this.pendingLinks.delete(userId);
        return;
      }

      // Добавляем ссылку
      await this.db.createLink(user.id, url, validation.platform);
      this.pendingLinks.delete(userId);

      await this.bot.sendMessage(
        chatId,
        '✅ Ссылка добавлена! Вы будете получать уведомления о новых объявлениях.',
        { reply_markup: this.getMainKeyboard() }
      );

      logger.info('Link confirmed and added', { userId, platform: validation.platform, url });
    } catch (error: any) {
      logger.error('Failed to confirm add link', { userId, error: error.message });
      await this.bot.sendMessage(chatId, '❌ Не удалось добавить ссылку.');
      this.pendingLinks.delete(userId);
    }
  }

  async handleCancelAddLink(chatId: number, userId: number): Promise<void> {
    try {
      this.pendingLinks.delete(userId);
      await this.bot.sendMessage(
        chatId,
        '❌ Добавление ссылки отменено.',
        { reply_markup: this.getMainKeyboard() }
      );
    } catch (error: any) {
      logger.error('Failed to cancel add link', { userId, error: error.message });
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

      const platformEmoji: Record<Platform, string> = {
        kufar: '🟢',
        onliner: '🔵',
        av: '🚗',
      };

      for (const link of links) {
        // Skip unsupported platforms (like old 'realt' links)
        if (!platformEmoji[link.platform as Platform]) {
          continue;
        }

        const status = link.is_active ? '✅ Активна' : '❌ Неактивна';
        const keyboard = {
          inline_keyboard: [
            [
              { text: '🔍 Проверить', callback_data: `check_${link.id}` },
              { text: '🗑 Удалить', callback_data: `delete_${link.id}` }
            ]
          ],
        };

        await this.bot.sendMessage(
          chatId,
          `${platformEmoji[link.platform as Platform]} ${link.platform.toUpperCase()}\n\n` +
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

  async handleDeleteAllLinks(chatId: number, userId: number): Promise<void> {
    try {
      const user = await this.db.getUser(userId);
      if (!user) {
        await this.bot.sendMessage(chatId, '❌ Пользователь не найден.');
        return;
      }

      const links = await this.db.getUserLinks(user.id);

      if (links.length === 0) {
        await this.bot.sendMessage(chatId, '📋 У вас нет ссылок для удаления.');
        return;
      }

      // Запрашиваем подтверждение
      const confirmKeyboard = {
        inline_keyboard: [
          [
            { text: '✅ Да, удалить все', callback_data: 'confirm_delete_all' },
            { text: '❌ Отмена', callback_data: 'cancel_delete_all' }
          ]
        ],
      };

      await this.bot.sendMessage(
        chatId,
        `⚠️ Вы уверены, что хотите удалить все ${links.length} ссылок?\n\nЭто действие нельзя отменить!`,
        { reply_markup: confirmKeyboard }
      );
    } catch (error: any) {
      logger.error('Failed to handle delete all links', { userId, error: error.message });
      await this.bot.sendMessage(chatId, '❌ Произошла ошибка.');
    }
  }

  async handleConfirmDeleteAll(chatId: number, userId: number): Promise<void> {
    try {
      const user = await this.db.getUser(userId);
      if (!user) {
        await this.bot.sendMessage(chatId, '❌ Пользователь не найден.');
        return;
      }

      const links = await this.db.getUserLinks(user.id);

      for (const link of links) {
        await this.db.deleteLink(link.id);
      }

      await this.bot.sendMessage(
        chatId,
        `✅ Удалено ${links.length} ссылок.`,
        { reply_markup: this.getMainKeyboard() }
      );

      logger.info('All links deleted', { userId, count: links.length });
    } catch (error: any) {
      logger.error('Failed to delete all links', { userId, error: error.message });
      await this.bot.sendMessage(chatId, '❌ Не удалось удалить ссылки.');
    }
  }

  async handleCancelDeleteAll(chatId: number): Promise<void> {
    try {
      await this.bot.sendMessage(
        chatId,
        '❌ Удаление отменено.',
        { reply_markup: this.getMainKeyboard() }
      );
    } catch (error: any) {
      logger.error('Failed to cancel delete all', { error: error.message });
    }
  }

  async handleCheckLink(chatId: number, linkId: number): Promise<void> {
    try {
      const link = await this.db.getLink(linkId);
      if (!link) {
        await this.bot.sendMessage(chatId, '❌ Ссылка не найдена.');
        return;
      }

      await this.bot.sendMessage(chatId, '⏳ Проверяю ссылку...');

      const parser = ParserFactory.getParser(link.platform as Platform);
      if (!parser) {
        await this.bot.sendMessage(chatId, '❌ Парсер не найден.');
        return;
      }

      const ads = await parser.parseUrl(link.url);
      const previewAds = ads.slice(-5).reverse();

      await this.bot.sendMessage(chatId, `📋 Найдено ${ads.length} объявлений. Показываю последние ${previewAds.length}:`);

      for (const ad of previewAds) {
        await this.sendAdWithMap(chatId, ad);
      }

      logger.info('Link checked', { linkId, adsFound: ads.length });
    } catch (error: any) {
      logger.error('Failed to check link', { linkId, error: error.message, stack: error.stack });

      // Определяем тип ошибки
      let errorMessage = '❌ Не удалось проверить ссылку.';

      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        errorMessage = '❌ Не удалось подключиться к сайту. Проверьте интернет-соединение.';
      } else if (error.response?.status === 403) {
        errorMessage = '❌ Доступ к сайту заблокирован. Попробуйте позже.';
      } else if (error.response?.status === 404) {
        errorMessage = '❌ Страница не найдена. Возможно, ссылка устарела.';
      } else if (error.response?.status === 429) {
        errorMessage = '❌ Слишком много запросов. Подождите немного.';
      } else if (error.response?.status >= 500) {
        errorMessage = '❌ Сайт временно недоступен. Попробуйте позже.';
      } else if (error.message?.includes('timeout')) {
        errorMessage = '❌ Превышено время ожидания. Попробуйте позже.';
      }

      await this.bot.sendMessage(chatId, errorMessage);
    }
  }

  private async sendAdWithMap(chatId: number, ad: AdData): Promise<void> {
    let message = `${ad.title}\n💰 ${ad.price}`;

    if (ad.published_at) {
      const date = new Date(ad.published_at);
      const formattedDate = date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Minsk',
      });
      message += `\n🕐 ${formattedDate}`;
    }

    // Объединяем location и address в одну строку
    const addressParts = [];
    if (ad.location) addressParts.push(ad.location);
    if (ad.address) addressParts.push(ad.address);
    if (addressParts.length > 0) {
      message += `\n📍 ${addressParts.join(', ')}`;
    }

    message += `\n🔗 ${ad.ad_url}`;

    // Сначала отправляем текст
    await this.bot.sendMessage(chatId, message);

    // Подготавливаем медиа
    const media: any[] = [];

    // Добавляем фото объявления
    if (ad.image_url) {
      media.push({
        type: 'photo',
        media: ad.image_url,
      });
    }

    // Добавляем карту только если есть точный адрес
    if (ad.address && this.yandexMaps) {
      try {
        const addressParts = [];
        if (ad.location) addressParts.push(ad.location);
        if (ad.address) addressParts.push(ad.address);
        const fullAddress = addressParts.join(', ');

        const mapUrl = await this.yandexMaps.getMapForAddress(fullAddress);
        if (mapUrl) {
          media.push({
            type: 'photo',
            media: mapUrl,
          });
        }
      } catch (error: any) {
        logger.warn('Failed to get map', { error: error.message });
      }
    }

    // Отправляем картинки
    if (media.length > 0) {
      try {
        await this.bot.sendMediaGroup(chatId, media);
      } catch (error: any) {
        logger.warn('Failed to send media group', { error: error.message });
        // Если не удалось отправить медиагруппу, пробуем отправить хотя бы первое фото
        if (media.length > 0 && media[0].media) {
          try {
            await this.bot.sendPhoto(chatId, media[0].media);
          } catch (photoError: any) {
            logger.warn('Failed to send photo fallback', { error: photoError.message });
          }
        }
      }
    }
  }

  async sendNotification(telegramId: number, ad: Ad): Promise<void> {
    try {
      let message = `📢 Новое объявление!\n\n${ad.title}\n💰 ${ad.price || 'Договорная'}`;

      // Используем время публикации объявления, если есть
      const dateToShow = ad.published_at || ad.created_at;
      if (dateToShow) {
        const date = new Date(dateToShow);
        const formattedDate = date.toLocaleString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Europe/Minsk',
        });
        message += `\n🕐 ${formattedDate}`;
      }

      // Объединяем location и address в одну строку
      const addressParts = [];
      if ((ad as any).location) addressParts.push((ad as any).location);
      if ((ad as any).address) addressParts.push((ad as any).address);
      if (addressParts.length > 0) {
        message += `\n📍 ${addressParts.join(', ')}`;
      }

      message += `\n🔗 ${ad.ad_url}`;

      // Отправляем текст
      await this.bot.sendMessage(telegramId, message);

      // Задержка перед отправкой медиа
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Подготавливаем медиа
      const media: any[] = [];

      // Добавляем фото объявления
      if (ad.image_url) {
        media.push({
          type: 'photo',
          media: ad.image_url,
        });
      }

      // Добавляем карту только если есть точный адрес
      if ((ad as any).address && this.yandexMaps) {
        try {
          const fullAddress = addressParts.join(', ');
          const mapUrl = await this.yandexMaps.getMapForAddress(fullAddress);
          if (mapUrl) {
            media.push({
              type: 'photo',
              media: mapUrl,
            });
          }
        } catch (error: any) {
          logger.warn('Failed to get map for notification', { error: error.message });
        }
      }

      // Отправляем картинки
      if (media.length > 0) {
        try {
          await this.bot.sendMediaGroup(telegramId, media);
        } catch (error: any) {
          logger.warn('Failed to send media group in notification', { error: error.message });
          // Если не удалось отправить медиагруппу, пробуем отправить хотя бы первое фото
          if (media.length > 0 && media[0].media) {
            try {
              await this.bot.sendPhoto(telegramId, media[0].media);
            } catch (photoError: any) {
              logger.warn('Failed to send photo fallback in notification', { error: photoError.message });
            }
          }
        }
      }
    } catch (error: any) {
      if (error.response?.statusCode === 403) {
        logger.warn('User blocked bot', { telegramId });
      } else {
        logger.error('Failed to send notification', {
          telegramId,
          adId: ad.id,
          error: error.message
        });
      }
    }
  }

  async handleShowMap(chatId: number, adId: string): Promise<void> {
    try {
      if (!this.yandexMaps) {
        await this.bot.sendMessage(chatId, '❌ Функция карт недоступна. API ключ не настроен.');
        return;
      }

      const ad = this.adCache.get(adId);
      if (!ad) {
        await this.bot.sendMessage(chatId, '❌ Объявление не найдено. Попробуйте обновить список.');
        return;
      }

      // Формируем адрес для геокодирования
      const addressParts = [];
      if (ad.location) addressParts.push(ad.location);
      if (ad.address) addressParts.push(ad.address);

      const fullAddress = addressParts.join(', ');
      if (!fullAddress) {
        await this.bot.sendMessage(chatId, '❌ Адрес не указан в объявлении.');
        return;
      }

      await this.bot.sendMessage(chatId, '🔍 Ищу адрес на карте...');

      // Получаем URL картинки карты
      const mapImageUrl = await this.yandexMaps.getMapImageForAddress(fullAddress);

      if (!mapImageUrl) {
        await this.bot.sendMessage(chatId, '❌ Не удалось найти адрес на карте. Попробуйте позже.');
        return;
      }

      // Отправляем картинку карты
      await this.bot.sendPhoto(chatId, mapImageUrl, {
        caption: `📍 ${fullAddress}\n\n${ad.title}\n💰 ${ad.price}\n🔗 ${ad.ad_url}`,
      });

      logger.info('Map sent successfully', { adId, address: fullAddress });
    } catch (error: any) {
      logger.error('Failed to show map', { adId, error: error.message, stack: error.stack });

      // Определяем тип ошибки
      let errorMessage = '❌ Произошла ошибка при загрузке карты.';

      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        errorMessage = '❌ Не удалось подключиться к сервису карт. Проверьте интернет-соединение.';
      } else if (error.response?.status === 403) {
        errorMessage = '❌ Доступ к сервису карт ограничен. Попробуйте позже.';
      } else if (error.response?.status === 429) {
        errorMessage = '❌ Превышен лимит запросов к картам. Подождите немного.';
      } else if (error.message?.includes('timeout')) {
        errorMessage = '❌ Превышено время ожидания ответа от сервиса карт.';
      } else if (error.message?.includes('not found') || error.message?.includes('адрес')) {
        errorMessage = '❌ Не удалось найти указанный адрес на карте.';
      }

      await this.bot.sendMessage(chatId, errorMessage);
    }
  }

  stop(): void {
    this.bot.stopPolling();
    logger.info('Bot stopped');
  }
}
