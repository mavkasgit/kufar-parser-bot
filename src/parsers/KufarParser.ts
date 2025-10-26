import { BaseParser } from './BaseParser';
import { AdData } from '../types';
import { logger } from '../utils/logger';
import { AxiosInstance } from 'axios';

// --- Справочники для работы с Kufar API ---

/**
 * Карта для преобразования текстовых названий категорий из URL в числовые ID,
 * которые понимает API Kufar.
 */
const CATEGORY_MAP: Record<string, string> = {
  // Недвижимость
  'kvartiru': '1010',
  'komnatu': '1030',
  'dom': '1020',
  'dachu': '1020',
  'uchastok': '1050',
  'kommercheskaya': '1060',
  'garazh': '1040',
  
  // Транспорт
  'avtomobili': '2010',
  'mototsikly': '2020',
  'avtobusy-i-mikroavtobusy': '2030',
  'shiny-i-diski': '2100',
  
  // Техника
  'telefony-i-planshety': '17010',
  'noutbuki': '19020',
  'kompyutery': '19010',
  'televizory': '12030',
  'igrovye-pristavki-i-igry': '12040',
  'stiralnye-mashiny': '14050',

  // Прочее
  'mebel': '15040',
  'velosipedy': '8030',
};

/**
 * Карта для определения ID региона (rgn) по городу/области из URL.
 * Kufar API имеет перепутанную нумерацию регионов.
 * rgn=7: Минск, rgn=5: Минская обл, rgn=1: Брестская, rgn=6: Витебская,
 * rgn=2: Гомельская, rgn=3: Гродненская, rgn=4: Могилевская.
 */
const CITY_TO_REGION_ID: Record<string, string> = {
  'minsk': '7',
  'brest': '1',
  'vitebsk': '6',
  'gomel': '2',
  'grodno': '3',
  'mogilev': '4',
  'minskaya-oblast': '5',
  'brestskaya-oblast': '1',
  'vitebskaya-oblast': '6',
  'gomelskaya-oblast': '2',
  'grodnenskaya-oblast': '3',
  'mogilevskaya-oblast': '4',
  'baranovichi': '1', 'pinsk': '1', 'kobrin': '1', 'bereza': '1',
  'orsha': '6', 'polotsk': '6', 'novopolotsk': '6',
  'zhlobin': '2', 'mozyr': '2', 'rechitsa': '2', 'svetlogorsk': '2',
  'lida': '3', 'volkovysk': '3', 'slonim': '3',
  'borisov': '5', 'soligorsk': '5', 'molodechno': '5', 'zhodino': '5', 'slutsk': '5',
  'bobruisk': '4',
};

/**
 * Карта для вторичной фильтрации. Сопоставляет города из URL
 * с вариантами их названий на кириллице в данных объявлений.
 */
const CITY_VARIANTS: Record<string, string[]> = {
  'minsk': ['минск', 'первомайский', 'московский', 'ленинский', 'заводской', 'октябрьский', 'фрунзенский', 'партизанский', 'советский', 'центральный'],
  'brest': ['брест'], 'baranovichi': ['барановичи'], 'pinsk': ['пинск'], 'kobrin': ['кобрин'], 'bereza': ['береза'],
  'vitebsk': ['витебск'], 'orsha': ['орша'], 'polotsk': ['полоцк'], 'novopolotsk': ['новополоцк'],
  'gomel': ['гомель'], 'zhlobin': ['жлобин'], 'mozyr': ['мозырь'], 'rechitsa': ['речица'], 'svetlogorsk': ['светлогорск'],
  'grodno': ['гродно'], 'lida': ['лида'], 'volkovysk': ['волковыск'], 'slonim': ['слоним'],
  'mogilev': ['могилёв', 'могилев'], 'bobruisk': ['бобруйск'],
  'borisov': ['борисов'], 'soligorsk': ['солигорск'], 'molodechno': ['молодечно'], 'zhodino': ['жодино'], 'slutsk': ['слуцк'],
};


export class KufarParser extends BaseParser {
  platform = 'kufar' as const;

  constructor(axiosInstance?: AxiosInstance) {
    super(axiosInstance);
  }

  validateUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.includes('kufar.by') && (urlObj.pathname.startsWith('/l/') || urlObj.pathname.startsWith('/re/'));
    } catch {
      return false;
    }
  }

  async parseUrl(url: string): Promise<AdData[]> {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);

      // --- 1. Определение параметров для API из URL ---
      let cat = '';
      let rgn = '';
      let typ = '';
      let citySlugForFilter = '';

      // Определяем категорию
      for (const part of pathParts) {
        if (CATEGORY_MAP[part]) {
          cat = CATEGORY_MAP[part];
          break;
        }
      }

      // Определяем регион
      const gtsy = urlObj.searchParams.get('gtsy');
      if (gtsy) {
        if (gtsy.includes('province-minsk_gorod')) rgn = '7';
        else if (gtsy.includes('province-minskaja_oblast')) rgn = '5';
        else if (gtsy.includes('province-brestskaja_oblast')) rgn = '1';
        else if (gtsy.includes('province-vitebskaja_oblast')) rgn = '6';
        else if (gtsy.includes('province-gomelskaja_oblast')) rgn = '2';
        else if (gtsy.includes('province-grodnenskaja_oblast')) rgn = '3';
        else if (gtsy.includes('province-mogilevskaja_oblast')) rgn = '4';
      }

      if (!rgn) {
        for (const part of pathParts) {
          if (CITY_TO_REGION_ID[part]) {
            rgn = CITY_TO_REGION_ID[part];
            // Если это не вся область, запоминаем город для последующей фильтрации
            if (!part.includes('-oblast')) {
              citySlugForFilter = part;
            }
            break;
          }
        }
      }

      // Определяем тип сделки (для недвижимости)
      if (pathParts.includes('snyat')) typ = 'let';
      else if (pathParts.includes('kupit')) typ = 'sell';

      // --- 2. Сборка параметров и выполнение запросов к API ---
      const apiParams: any = { size: 30, sort: 'lst.d' };
      if (cat) apiParams.cat = cat;
      if (rgn) apiParams.rgn = rgn;
      if (typ) apiParams.typ = typ;
      
      // Пробрасываем "безопасные" параметры из исходного URL
      urlObj.searchParams.forEach((value, key) => {
        if (['prc', 'rms', 'gtsy', 'query'].includes(key)) {
          apiParams[key] = value;
        }
      });
      
      logger.info('Making Kufar API requests', { params: apiParams, originalUrl: url });

      const [paginatedResponse, polepositionResponse] = await Promise.all([
        this.axiosInstance.get('https://api.kufar.by/search-api/v2/search/rendered-paginated', { params: apiParams }).catch(() => ({ data: { ads: [] } })),
        this.axiosInstance.get('https://api.kufar.by/search-api/v2/search/poleposition', { params: { ...apiParams, size: 5 } }).catch(() => ({ data: { ads: [] } })),
      ]);

      // --- 3. Объединение, дедупликация и обработка результатов ---
      const allAdsRaw = [...(paginatedResponse.data?.ads || []), ...(polepositionResponse.data?.ads || [])];
      
      const uniqueAdsMap = new Map();
      allAdsRaw.forEach(ad => {
        if (ad.ad_id) uniqueAdsMap.set(ad.ad_id, ad);
      });
      const uniqueAds = Array.from(uniqueAdsMap.values());

      if (uniqueAds.length === 0) {
        logger.warn('No ads found in Kufar API', { url, params: apiParams });
        return [];
      }
      
      // --- 4. Преобразование данных и ВТОРИЧНАЯ ФИЛЬТРАЦИЯ ---
      let processedAds = uniqueAds.map((ad: any) => {
        let priceStr = 'Договорная';
        if (ad.price_byn) priceStr = `${(ad.price_byn / 100).toFixed(2)} BYN`;
        else if (ad.price_usd) priceStr = `${(ad.price_usd / 100).toFixed(2)} USD`;

        let imageUrl;
        if (ad.images && ad.images.length > 0) {
          imageUrl = ad.images[0].path ? `https://rms4.kufar.by/v1/gallery/${ad.images[0].path}` : ad.images[0].url;
        }
        
        const locationParam = ad.ad_parameters?.find((p: any) => p.p === 'area');
        const location = locationParam?.vl;

        const addressParam = ad.account_parameters?.find((p: any) => p.p === 'address');
        const address = addressParam?.v;

        return {
          external_id: String(ad.ad_id),
          title: ad.subject,
          description: ad.body,
          price: priceStr,
          image_url: imageUrl,
          ad_url: ad.ad_link,
          location: location || undefined,
          address: address || undefined,
          published_at: new Date(ad.list_time),
          _rawLocation: (location || '').toLowerCase(), // Временное поле для фильтрации
        };
      });

      // Применяем фильтрацию по городу, если это необходимо
      if (citySlugForFilter && !apiParams.gtsy) {
        const targetCityVariants = CITY_VARIANTS[citySlugForFilter] || [citySlugForFilter];
        
        processedAds = processedAds.filter(ad => {
          if (!ad._rawLocation) return false;
          return targetCityVariants.some(variant => ad._rawLocation.includes(variant));
        });
        logger.info(`Filtered ads by city: ${citySlugForFilter}`, { before: uniqueAds.length, after: processedAds.length });
      }

      // --- 5. Финальная очистка и возврат результата ---
      return processedAds.map(({ _rawLocation, ...ad }) => ad);

    } catch (error: any) {
      logger.error('Kufar API parsing failed', {
        url,
        error: error.message,
        status: error.response?.status,
        responseData: error.response?.data ? JSON.stringify(error.response.data).substring(0, 200) : undefined
      });
      throw error;
    }
  }
}