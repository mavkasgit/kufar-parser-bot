import { Platform } from '../types';

export interface AssessmentResult {
  platform: Platform | null;
  ok: boolean;
  reason?: string;
}

export class LinkAcceptance {
  static assess(url: string): AssessmentResult {
    let urlObj: URL;
    try {
      urlObj = new URL(url);
    } catch {
      return { platform: null, ok: false, reason: 'Некорректный URL' };
    }

    const hostname = urlObj.hostname.toLowerCase();
    const pathname = urlObj.pathname;

    if (hostname.includes('kufar.by')) {
      if (pathname.startsWith('/l/') || pathname.startsWith('/re/')) {
        return { platform: 'kufar', ok: true };
      }
      return { platform: 'kufar', ok: false, reason: 'Это ссылка на конкретное объявление. Нужна ссылка на страницу поиска с фильтрами.' };
    }

    if (hostname.includes('onliner.by')) {
      if (hostname.includes('baraholka') || hostname.includes('ab') || hostname.includes('r.onliner')) {
        return { platform: 'onliner', ok: true };
      }
      return { platform: 'onliner', ok: false, reason: 'Нужна ссылка на Барахолку, Авто или Недвижимость Onliner.' };
    }

    if (hostname.includes('av.by')) {
      return { platform: 'av', ok: true };
    }

    return { platform: null, ok: false, reason: 'Неподдерживаемая площадка' };
  }
}
