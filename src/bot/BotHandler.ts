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
        '👋 Привет! Я помогу отслеживать новые объявления на Kufar и Onliner.\n\n' +
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
        '• Onliner.by - Барахолка, Авто (страница поиска), Недвижимость (карта)\n\n' +
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

      // Show last 5 ads as preview
      const previewAds = testAds.slice(0, 5);
      await this.bot.sendMessage(chatId, `📋 Последние ${previewAds.length} объявлений:`);
      
      for (const ad of previewAds) {
        await this.sendAdWithMap(chatId, ad);
      }

      logger.info('Link added', { userId, platform: validation.platform, url, adsFound: testAds.length });
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

      const platformEmoji: Record<Platform, string> = {
        kufar: '🟢',
        onliner: '🔵',
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
      const previewAds = ads.slice(0, 5);

      await this.bot.sendMessage(chatId, `📋 Найдено ${ads.length} объявлений. Показываю последние ${previewAds.length}:`);

      for (const ad of previewAds) {
        await this.sendAdWithMap(chatId, ad);
      }

      logger.info('Link checked', { linkId, adsFound: ads.length });
    } catch (error: any) {
      logger.error('Failed to check link', { linkId, error: error.message });
      await this.bot.sendMessage(chatId, '❌ Не удалось проверить ссылку.');
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
    
    // Добавляем карту если есть адрес
    if ((ad.location || ad.address) && this.yandexMaps) {
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
      }
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
      logger.error('Failed to show map', { adId, error: error.message });
      await this.bot.sendMessage(chatId, '❌ Произошла ошибка при загрузке карты.');
    }
  }

  stop(): void {
    this.bot.stopPolling();
    logger.info('Bot stopped');
  }
}
