import * as cheerio from 'cheerio';
import { BaseParser } from './BaseParser';
import { AdData } from '../types';
import { logger } from '../utils/logger';

export class OnlinerParser extends BaseParser {
  platform = 'onliner' as const;

  validateUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.includes('onliner.by') && 
             (urlObj.hostname.includes('baraholka') || urlObj.hostname.includes('ab'));
    } catch {
      return false;
    }
  }

  async parseUrl(url: string): Promise<AdData[]> {
    try {
      const html = await this.fetchWithRetry(url);
      const $ = cheerio.load(html);
      const ads: AdData[] = [];

      // Baraholka parsing
      $('.classified__item, .vehicle-item').each((_: number, element: any) => {
        const $el = $(element);
        const link = $el.find('a.classified__link, a.vehicle-item__link').first();
        const title = link.find('.classified__title, .vehicle-item__title').text().trim();
        const priceEl = $el.find('.classified__price, .vehicle-item__price');
        const price = priceEl.text().trim();
        const imgEl = $el.find('img.classified__image, img.vehicle-item__image').first();
        const imageUrl = imgEl.attr('src') || imgEl.attr('data-src') || null;
        const adUrl = link.attr('href');

        if (title && adUrl) {
          const fullUrl = adUrl.startsWith('http') ? adUrl : `https://baraholka.onliner.by${adUrl}`;
          const externalId = adUrl.match(/\/(\d+)$/)?.[1] || adUrl;

          ads.push({
            external_id: `onliner_${externalId}`,
            title,
            price: price || '',
            image_url: imageUrl || undefined,
            ad_url: fullUrl,
          });
        }
      });

      logger.info('Onliner parsing successful', { url, adsCount: ads.length });
      return ads;
    } catch (error: any) {
      logger.error('Onliner parsing failed', { url, error: error.message });
      throw error;
    }
  }
}
