import { Ad, Platform } from '../types';

export interface IParser {
  platform: Platform;
  parseUrl(url: string): Promise<Ad[]>;
  validateUrl(url: string): boolean;
}
