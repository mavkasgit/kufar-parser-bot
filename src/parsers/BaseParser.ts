import axios, { AxiosInstance } from 'axios';
import { IParser } from './IParser';
import { AdData, Platform } from '../types';
import { logger } from '../utils/logger';

export abstract class BaseParser implements IParser {
  abstract platform: Platform;
  protected axiosInstance: AxiosInstance;
  private userAgents: string[] = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ];

  constructor() {
    this.axiosInstance = axios.create({
      timeout: 10000,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
      },
    });
  }

  protected getRandomUserAgent(): string {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  protected async fetchWithRetry(url: string, retries: number = 3): Promise<string> {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await this.axiosInstance.get(url, {
          headers: {
            'User-Agent': this.getRandomUserAgent(),
          },
        });
        return response.data;
      } catch (error: any) {
        logger.warn(`Fetch attempt ${i + 1} failed for ${url}`, {
          platform: this.platform,
          error: error.message,
        });

        if (i === retries - 1) {
          throw error;
        }

        // Exponential backoff
        await this.sleep(Math.pow(2, i) * 1000);
      }
    }
    throw new Error('All retry attempts failed');
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  abstract parseUrl(url: string): Promise<AdData[]>;
  abstract validateUrl(url: string): boolean;
}
