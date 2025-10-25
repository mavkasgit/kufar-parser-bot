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
      } else if (hostname.includes('realt.by')) {
        return 'realt';
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

  static validateUrl(url: string): { valid: boolean; platform: Platform | null } {
    if (!this.isValidUrl(url)) {
      return { valid: false, platform: null };
    }

    const platform = this.detectPlatform(url);
    return { valid: platform !== null, platform };
  }
}
