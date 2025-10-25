import { AdData, Platform } from '../types';

export interface IParser {
  platform: Platform;
  parseUrl(url: string): Promise<AdData[]>;
  validateUrl(url: string): boolean;
}
