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
        // Check for single ad pages
        if (urlObj.hostname.includes('ab.onliner')) {
          // ab.onliner.by/brand/model/12345 - это конкретное объявление
          // ab.onliner.by/brand/model - это поиск
          const parts = pathname.split('/').filter(Boolean);
          // Если последняя часть - число (ID объявления), это не поиск
          if (parts.length >= 3 && /^\d+$/.test(parts[parts.length - 1])) {
            return false;
          }
        }
        
        if (urlObj.hostname.includes('baraholka.onliner')) {
          // baraholka.onliner.by/products/12345 - конкретное объявление
          if (pathname.match(/^\/products\/\d+/)) {
            return false;
          }
        }
        
        if (urlObj.hostname.includes('r.onliner')) {
          // r.onliner.by/ak/12345 - конкретное объявление
          if (pathname.match(/^\/ak\/\d+/)) {
            return false;
          }
        }
        
        return true;
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
