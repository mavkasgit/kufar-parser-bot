import { Platform } from '../types';

export class UrlValidator {
  static detectPlatform(url: string): Platform | null {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();

      if (hostname.includes('kufar.by')) {
        return 'kufar';
      } else if (hostname.includes('onliner.by')) {
        return 'onliner';
      } else if (hostname.includes('av.by')) {
        return 'av';
      }

      return null;
    } catch {
      return null;
    }
  }

  static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  static isSearchPage(url: string, platform: Platform): boolean {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;

      if (platform === 'kufar') {
        // Kufar search pages start with /l/ or /re/
        return pathname.startsWith('/l/') || pathname.startsWith('/re/');
      } else if (platform === 'onliner') {
        // ... (onliner logic)
      } else if (platform === 'av') {
        return pathname.includes('/filter');
      }

      return true;
    } catch {
      return false;
    }
  }

  static validateUrl(url: string): { valid: boolean; platform: Platform | null; isSearchPage?: boolean; error?: string } {
    if (!this.isValidUrl(url)) {
      return { valid: false, platform: null, error: 'Некорректный URL' };
    }

    const platform = this.detectPlatform(url);
    if (!platform) {
      return { valid: false, platform: null, error: 'Неподдерживаемая площадка' };
    }

    const isSearchPage = this.isSearchPage(url, platform);
    if (!isSearchPage) {
      return { 
        valid: false, 
        platform, 
        isSearchPage: false,
        error: 'Это ссылка на конкретное объявление. Нужна ссылка на страницу поиска с фильтрами.'
      };
    }

    return { valid: true, platform, isSearchPage: true };
  }
}
