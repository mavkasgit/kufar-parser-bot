import * as cheerio from 'cheerio';
import { BaseParser } from './BaseParser';
import { AdData } from '../types';
import { logger } from '../utils/logger';

export class KufarParser extends BaseParser {
  platform = 'kufar' as const;

  validateUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.includes('kufar.by') && urlObj.pathname.startsWith('/l/');
    } catch {
      return false;
    }
  }

  async parseUrl(url: string): Promise<AdData[]> {
    try {
      const html = await this.fetchWithRetry(url);
      const $ = cheerio.load(html);

      // Find script tag with __INITIAL_STATE__
      const scripts = $('script');
      let initialState: any = null;

      scripts.each((_: number, element: any) => {
        const scriptContent = $(element).html();
        if (scriptContent && scriptContent.includes('window.__INITIAL_STATE__')) {
          const match = scriptContent.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});/s);
          if (match) {
            try {
              initialState = JSON.parse(match[1]);
            } catch (e) {
              logger.error('Failed to parse Kufar initial state', { error: e });
            }
          }
        }
      });

      if (!initialState || !initialState.listing || !initialState.listing.ads) {
        logger.warn('No ads found in Kufar page', { url });
        return [];
      }

      const ads: AdData[] = initialState.listing.ads.map((ad: any) => ({
        external_id: String(ad.ad_id || ad.id),
        title: ad.subject || ad.title || 'Без названия',
        description: ad.body || ad.description || '',
        price: ad.price_byn ? `${ad.price_byn} BYN` : ad.price || '',
        image_url: ad.images && ad.images[0] ? ad.images[0].path : null,
        ad_url: `https://kufar.by/item/${ad.ad_id || ad.id}`,
      }));

      logger.info('Kufar parsing successful', { url, adsCount: ads.length });
      return ads;
    } catch (error: any) {
      logger.error('Kufar parsing failed', { url, error: error.message });
      throw error;
    }
  }
}
