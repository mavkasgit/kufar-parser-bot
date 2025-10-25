import * as cheerio from 'cheerio';
import { BaseParser } from './BaseParser';
import { AdData } from '../types';
import { logger } from '../utils/logger';

export class RealtParser extends BaseParser {
  platform = 'realt' as const;

  validateUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.includes('realt.by');
    } catch {
      return false;
    }
  }

  async parseUrl(url: string): Promise<AdData[]> {
    try {
      const html = await this.fetchWithRetry(url);
      const $ = cheerio.load(html);
      const ads: AdData[] = [];

      $('.bd-item, .object-item').each((_: number, element: any) => {
        const $el = $(element);
        const link = $el.find('a.bd-item-link, a.object-item__link').first();
        const title = $el.find('.bd-item-title, .object-item__title').text().trim();
        const price = $el.find('.bd-item-price, .object-item__price').text().trim();
        const imgEl = $el.find('img').first();
        const imageUrl = imgEl.attr('src') || imgEl.attr('data-src') || null;
        const adUrl = link.attr('href');

        if (title && adUrl) {
          const fullUrl = adUrl.startsWith('http') ? adUrl : `https://realt.by${adUrl}`;
          const externalId = adUrl.match(/\/(\d+)/)?.[1] || adUrl;

          ads.push({
            external_id: `realt_${externalId}`,
            title,
            price: price || '',
            image_url: imageUrl || undefined,
            ad_url: fullUrl,
          });
        }
      });

      logger.info('Realt parsing successful', { url, adsCount: ads.length });
      return ads;
    } catch (error: any) {
      logger.error('Realt parsing failed', { url, error: error.message });
      throw error;
    }
  }
}
