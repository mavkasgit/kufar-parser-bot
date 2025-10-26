import { BaseParser } from './BaseParser';
import { AdData } from '../types';
import { logger } from '../utils/logger';
import { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';

export class AvParser extends BaseParser {
  platform = 'av' as const;

  constructor(axiosInstance?: AxiosInstance) {
    super(axiosInstance);
  }

  validateUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.includes('av.by');
    } catch {
      return false;
    }
  }

  async parseUrl(url: string): Promise<AdData[]> {
    logger.info('AV.by parsing started', { url });
    try {
      const html = await this.fetchWithRetry(url);
      const $ = cheerio.load(html);
      const nextData = $('#__NEXT_DATA__').html();

      if (!nextData) {
        logger.warn('Could not find __NEXT_DATA__ on av.by page', { url });
        return [];
      }

      const data = JSON.parse(nextData);
      const ads = data.props.initialState.filter.main.adverts;

      if (!ads || !Array.isArray(ads)) {
        logger.warn('Could not find ads in __NEXT_DATA__ on av.by page', { url });
        return [];
      }

      // Сортируем объявления по дате публикации (от новых к старым)
      ads.sort((a: any, b: any) => {
        const dateA = new Date(a.publishedAt).getTime();
        const dateB = new Date(b.publishedAt).getTime();
        return dateB - dateA;
      });

      return ads.map((ad: any) => ({
        external_id: `av_${ad.id}`,
        title: ad.metadata?.vinInfo?.vin || `${ad.properties.find((p: any) => p.name === 'brand')?.value} ${ad.properties.find((p: any) => p.name === 'model')?.value}`,
        description: ad.description,
        price: `${ad.price.usd.amount} USD`,
        image_url: ad.photos[0]?.medium.url,
        ad_url: `https://cars.av.by${ad.publicUrl}`,
        location: ad.locationName,
        published_at: new Date(ad.publishedAt),
      }));
    } catch (error: any) {
      logger.error('av.by parsing failed', { url, error: error.message });
      throw error;
    }
  }
}
