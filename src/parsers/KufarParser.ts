import { BaseParser } from './BaseParser';
import { AdData } from '../types';
import { logger } from '../utils/logger';

export class KufarParser extends BaseParser {
  platform = 'kufar' as const;

  validateUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.includes('kufar.by') && 
             (urlObj.pathname.startsWith('/l/') || urlObj.pathname.startsWith('/re/'));
    } catch {
      return false;
    }
  }

  async parseUrl(url: string): Promise<AdData[]> {
    try {
      // Parse URL to extract search parameters
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      
      // Extract category and region from URL
      let cat = '';
      let rgn = '';
      
      // Try to determine category from URL path
      if (pathParts.includes('telefony-i-planshety')) cat = '17010';
      else if (pathParts.includes('nedvizhimost') || pathParts.includes('kvartiru')) cat = '1010'; // Недвижимость -> Квартиры
      else if (pathParts.includes('avtomobili')) cat = '2000';
      
      // Determine region from URL
      // ВАЖНО: В Kufar API ПЕРЕПУТАННАЯ нумерация регионов!
      // rgn=7 - Минск (город)
      // rgn=5 - Минская область
      // rgn=1 - Брестская область
      // rgn=2 - Гомельская область (НЕ Витебская!)
      // rgn=3 - Гродненская область (НЕ Гомельская!)
      // rgn=4 - Могилевская область (НЕ Гродненская!)
      // rgn=6 - Витебская область (НЕ Могилевская!)
      
      // Проверяем параметр gtsy (самый точный)
      const gtsy = urlObj.searchParams.get('gtsy');
      if (gtsy) {
        if (gtsy.includes('locality-minsk') || gtsy.includes('province-minsk_gorod')) {
          rgn = '7'; // Минск город
        } else if (gtsy.includes('province-minskaja_oblast')) {
          rgn = '5'; // Минская область
        } else if (gtsy.includes('province-brestskaja_oblast')) {
          rgn = '1'; // Брестская
        } else if (gtsy.includes('province-vitebskaja_oblast')) {
          rgn = '6'; // Витебская → rgn=6 (НЕ 2!)
        } else if (gtsy.includes('province-gomelskaja_oblast')) {
          rgn = '2'; // Гомельская → rgn=2 (НЕ 3!)
        } else if (gtsy.includes('province-grodnenskaja_oblast')) {
          rgn = '3'; // Гродненская → rgn=3 (НЕ 4!)
        } else if (gtsy.includes('province-mogilevskaja_oblast')) {
          rgn = '4'; // Могилевская → rgn=4 (НЕ 6!)
        }
      }
      
      // Если gtsy нет, проверяем path
      if (!rgn) {
        // Маппинг городов на регионы (ИСПРАВЛЕННЫЙ!)
        const cityToRegion: Record<string, string> = {
          // Областные центры
          'minsk': '7',
          'brest': '1',
          'vitebsk': '6', // НЕ 2!
          'gomel': '2',   // НЕ 3!
          'grodno': '3',  // НЕ 4!
          'mogilev': '4', // НЕ 6!
          
          // Области (полные названия)
          'brestskaya-oblast': '1',
          'brestskaja-oblast': '1',
          'vitebskaya-oblast': '6',
          'vitebskaja-oblast': '6',
          'gomelskaya-oblast': '2',
          'gomelskaja-oblast': '2',
          'grodnenskaya-oblast': '3',
          'grodnenskaja-oblast': '3',
          'minskaya-oblast': '5',
          'minskaja-oblast': '5',
          'mogilevskaya-oblast': '4',
          'mogilevskaja-oblast': '4',
          
          // Брестская область (rgn=1)
          'baranovichi': '1',
          'pinsk': '1',
          'kobrin': '1',
          'bereza': '1',
          'gantsevichi': '1',
          'drogichin': '1',
          'zhabinka': '1',
          'ivanovo': '1',
          'ivatsevichi': '1',
          'kamenets': '1',
          'luninets': '1',
          'lyakhovichi': '1',
          'malorita': '1',
          'pruzhany': '1',
          'stolin': '1',
          
          // Витебская область (rgn=6!)
          'orsha': '6',
          'polotsk': '6',
          'novopolotsk': '6',
          'beshenkovichi': '6',
          'braslav': '6',
          'verkhnedvinsk': '6',
          'glubokoe': '6',
          'gorodok': '6',
          'dokshitsy': '6',
          'dubrovno': '6',
          'lepel': '6',
          'liozno': '6',
          'miory': '6',
          'novolukoml': '6',
          'postavy': '6',
          'senno': '6',
          'tolochin': '6',
          'ushachi': '6',
          'chashniki': '6',
          'sharkovshchina': '6',
          'shumilino': '6',
          
          // Гомельская область (rgn=2!)
          'zhlobin': '2',
          'mozyr': '2',
          'rechitsa': '2',
          'bragin': '2',
          'buda-koshelevo': '2',
          'dobrush': '2',
          'elsk': '2',
          'zhitkovichi': '2',
          'kalinkovichi': '2',
          'korma': '2',
          'lelchitsy': '2',
          'loev': '2',
          'narovlya': '2',
          'petrikov': '2',
          'rogachev': '2',
          'svetlogorsk': '2',
          'chechersk': '2',
          
          // Гродненская область (rgn=3!)
          'lida': '3',
          'volkovysk': '3',
          'slonim': '3',
          'shchuchin': '3', // Щучин
          'novogrudok': '3',
          'voronovo': '3',
          'dyatlovo': '3',
          'zelva': '3',
          'ivye': '3',
          'korelichi': '3',
          'mir': '3',
          'mosty': '3',
          'ostrovets': '3',
          'oshmyany': '3',
          'svisloch': '3',
          'skidel': '3',
          'smorgon': '3',
          
          // Минская область (rgn=5)
          'borisov': '5',
          'zhodino': '5',
          'molodechno': '5',
          'soligorsk': '5',
          'borovlyany': '5',
          'zaslavl': '5',
          'dzerzhinsk': '5',
          'kletsk': '5',
          'kopyl': '5',
          'krupki': '5',
          'logoysk': '5',
          'lyuban': '5',
          'nesvizh': '5',
          'slutsk': '5',
          'smolevichi': '5',
          'stolbtsy': '5',
          'fanipol': '5',
          
          // Могилевская область (rgn=4!)
          'bobruisk': '4',
          'belynichy': '4',
          'bykhov': '4',
          'glusk': '4',
          'gorki': '4',
          'dribin': '4',
          'kirovsk': '4',
          'klimovichi': '4',
          'klichev': '4',
          'kostyukovichi': '4',
          'krasnopolye': '4',
          'krichev': '4',
          'krugloe': '4',
          'mstislavl': '4',
          'osipovichi': '4',
          'slavgorod': '4',
          'khotimsk': '4',
          'chausy': '4',
          'cherikov': '4',
          'shklov': '4',
        };
        
        // Проверяем формат r~город
        const regionPart = pathParts.find(p => p.startsWith('r~'));
        if (regionPart) {
          const city = regionPart.replace('r~', '');
          rgn = cityToRegion[city] || '';
        }
        // Проверяем просто название города в path
        else {
          for (const [city, region] of Object.entries(cityToRegion)) {
            if (pathParts.includes(city)) {
              rgn = region;
              break;
            }
          }
        }
      }
      
      // Determine operation type for real estate
      let typ = '';
      if (pathParts.includes('snyat')) typ = 'let'; // Аренда
      else if (pathParts.includes('kupit')) typ = 'sell'; // Продажа
      
      // Build API request - используем оба endpoint как в lonesomestranger/avby-kufar-notifier
      const paginatedUrl = 'https://api.kufar.by/search-api/v2/search/rendered-paginated';
      const polepositionUrl = 'https://api.kufar.by/search-api/v2/search/poleposition';
      
      const params: any = {
        size: 30,
        sort: 'lst.d'
      };
      
      if (cat) params.cat = cat;
      if (rgn) params.rgn = rgn;
      if (typ) params.typ = typ;
      
      // Copy filters from original URL (only working ones)
      urlObj.searchParams.forEach((value, key) => {
        // Pass through only parameters that work with API
        if (key === 'prc' || key === 'rms' || key === 'gtsy') {
          params[key] = value;
        }
        // Skip problematic filters: ar (districts), cur (currency), oph (owner only)
        // These make API return 0 results
      });

      logger.info('Making Kufar API requests', { paginatedUrl, polepositionUrl, params, originalUrl: url });
      
      // Делаем оба запроса параллельно (как в lonesomestranger/avby-kufar-notifier)
      const [paginatedResponse, polepositionResponse] = await Promise.all([
        this.axiosInstance.get(paginatedUrl, {
          params,
          headers: {
            'User-Agent': this.getRandomUserAgent(),
            'accept': 'application/json',
            'accept-language': 'ru-RU,ru',
            'origin': 'https://auto.kufar.by',
            'referer': 'https://auto.kufar.by/',
          },
        }).catch(err => {
          logger.warn('Paginated endpoint failed', { error: err.message });
          return { data: { ads: [] } };
        }),
        this.axiosInstance.get(polepositionUrl, {
          params: { ...params, size: 5 }, // Топовые объявления - меньше
          headers: {
            'User-Agent': this.getRandomUserAgent(),
            'accept': 'application/json',
            'accept-language': 'ru-RU,ru',
            'origin': 'https://auto.kufar.by',
            'referer': 'https://auto.kufar.by/',
          },
        }).catch(err => {
          logger.warn('Poleposition endpoint failed', { error: err.message });
          return { data: { ads: [] } };
        }),
      ]);

      logger.info('Kufar API responses received', { 
        paginatedCount: paginatedResponse.data?.ads?.length || 0,
        polepositionCount: polepositionResponse.data?.ads?.length || 0,
      });

      // Объединяем результаты и убираем дубликаты
      const allAdsRaw = [
        ...(paginatedResponse.data?.ads || []),
        ...(polepositionResponse.data?.ads || []),
      ];
      
      // Убираем дубликаты по ad_id
      const uniqueAdsMap = new Map();
      allAdsRaw.forEach(ad => {
        const id = ad.ad_id || ad.id;
        if (id && !uniqueAdsMap.has(id)) {
          uniqueAdsMap.set(id, ad);
        }
      });
      
      const uniqueAds = Array.from(uniqueAdsMap.values());

      if (uniqueAds.length === 0) {
        logger.warn('No ads found in Kufar API', { url, params });
        return [];
      }

      // Определяем нужный город для фильтрации (если указан конкретный город)
      let filterCity: string | null = null;
      const locationPart = pathParts[1]; // Второй элемент после /l/
      
      // Список областных центров (не фильтруем, т.к. они совпадают с областью)
      const regionalCenters = ['minsk', 'brest', 'vitebsk', 'gomel', 'grodno', 'mogilev'];
      
      if (locationPart && !locationPart.includes('-oblast') && !regionalCenters.includes(locationPart)) {
        // Это конкретный город (не областной центр)
        filterCity = locationPart.replace('r~', ''); // Убираем r~ если есть
      }
      
      // Если есть gtsy с конкретной локацией, используем её
      if (gtsy && gtsy.includes('locality-')) {
        const localityMatch = gtsy.match(/locality-([^~]+)/);
        if (localityMatch) {
          const locality = localityMatch[1].replace(/_/g, ' ');
          // Проверяем что это не областной центр
          if (!regionalCenters.includes(locality.toLowerCase())) {
            filterCity = locality;
          }
        }
      }

      let allAds = uniqueAds.map((ad: any) => {
        // Цена в копейках, делим на 100 (как в lonesomestranger/avby-kufar-notifier)
        let priceStr = '';
        if (ad.price_byn) {
          const priceInByn = (ad.price_byn / 100).toFixed(2);
          priceStr = `${priceInByn} BYN`;
        } else if (ad.price_usd) {
          const priceInUsd = (ad.price_usd / 100).toFixed(2);
          priceStr = `${priceInUsd} USD`;
        } else if (ad.price) {
          priceStr = ad.price;
        }

        // Обработка изображений (как в lonesomestranger)
        let imageUrl: string | undefined;
        if (ad.images && ad.images.length > 0) {
          // Если есть path, формируем полный URL
          if (ad.images[0].path) {
            imageUrl = `https://rms4.kufar.by/v1/gallery/${ad.images[0].path}`;
          } else if (ad.images[0].url) {
            imageUrl = ad.images[0].url;
          }
        }

        // Извлекаем город и адрес
        let location = '';
        let address = '';
        
        // Город/район из ad_parameters
        if (ad.ad_parameters && Array.isArray(ad.ad_parameters)) {
          const regionParam = ad.ad_parameters.find((p: any) => p.p === 'region');
          const areaParam = ad.ad_parameters.find((p: any) => p.p === 'area');
          
          if (regionParam && regionParam.vl) {
            location = regionParam.vl;
            // Добавляем район если есть
            if (areaParam && areaParam.vl && areaParam.vl !== regionParam.vl) {
              location += `, ${areaParam.vl}`;
            }
          } else if (areaParam && areaParam.vl) {
            location = areaParam.vl;
          }
        }
        
        // Точный адрес из account_parameters
        if (ad.account_parameters && Array.isArray(ad.account_parameters)) {
          const addressParam = ad.account_parameters.find((p: any) => 
            p.p === 'address' || p.pl === 'Адрес'
          );
          if (addressParam && addressParam.v) {
            address = addressParam.v;
          }
        }

        // Извлекаем дату публикации
        let publishedAt: Date | undefined;
        if (ad.list_time) {
          publishedAt = new Date(ad.list_time);
        }

        return {
          external_id: String(ad.ad_id || ad.id),
          title: ad.subject || ad.title || 'Без названия',
          description: ad.body || ad.description || '',
          price: priceStr,
          image_url: imageUrl,
          ad_url: ad.ad_link || `https://kufar.by/item/${ad.ad_id || ad.id}`,
          location: location || undefined,
          address: address || undefined,
          published_at: publishedAt,
          _rawAd: ad, // Сохраняем для фильтрации
        };
      });

      // Фильтруем по городу если нужно
      if (filterCity) {
        const beforeFilter = allAds.length;
        
        // Маппинг названий городов (URL -> Kufar area name)
        const cityMapping: Record<string, string[]> = {
          // Областные центры
          'minsk': ['минск', 'первомайский', 'московский', 'ленинский', 'заводской', 'октябрьский', 'фрунзенский', 'партизанский', 'советский', 'центральный'],
          'brest': ['брест'],
          'gomel': ['гомель'],
          'vitebsk': ['витебск'],
          'grodno': ['гродно'],
          'mogilev': ['могилёв', 'могилев'],
          
          // Минская область
          'borisov': ['борисов'],
          'borovlyany': ['боровляны'],
          'zhodino': ['жодино'],
          'zaslavl': ['заславль'],
          'dzerzhinsk': ['дзержинск'],
          'kletsk': ['клецк'],
          'kopyl': ['копыль'],
          'krupki': ['крупки'],
          'logoysk': ['логойск'],
          'lyuban': ['любань'],
          'molodechno': ['молодечно'],
          'nesvizh': ['несвиж'],
          'slutsk': ['слуцк'],
          'smolevichi': ['смолевичи'],
          'soligorsk': ['солигорск'],
          'stolbtsy': ['столбцы'],
          'fanipol': ['фанипол'],
          
          // Брестская область
          'baranovichi': ['барановичи'],
          'bereza': ['береза'],
          'gantsevichi': ['ганцевичи'],
          'drogichin': ['дрогичин'],
          'zhabinka': ['жабинка'],
          'ivanovo': ['иваново'],
          'ivatsevichi': ['ивацевичи'],
          'kamenets': ['каменец'],
          'kobrin': ['кобрин'],
          'luninets': ['лунинец'],
          'lyakhovichi': ['ляховичи'],
          'malorita': ['малорита'],
          'pinsk': ['пинск'],
          'pruzhany': ['пружаны'],
          'stolin': ['столин'],
          
          // Витебская область
          'beshenkovichi': ['бешенковичи'],
          'braslav': ['браслав'],
          'verkhnedvinsk': ['верхнедвинск'],
          'glubokoe': ['глубокое'],
          'gorodok': ['городок'],
          'dokshitsy': ['докшицы'],
          'dubrovno': ['дубровно'],
          'lepel': ['лепель'],
          'liozno': ['лиозно'],
          'miory': ['миоры'],
          'novolukoml': ['новолукомль'],
          'novopolotsk': ['новополоцк'],
          'orsha': ['орша'],
          'polotsk': ['полоцк'],
          'postavy': ['поставы'],
          'senno': ['сенно'],
          'tolochin': ['толочин'],
          'ushachi': ['ушачи'],
          'chashniki': ['чашники'],
          'sharkovshchina': ['шарковщина'],
          'shumilino': ['шумилино'],
          
          // Гомельская область
          'bragin': ['брагин'],
          'buda-koshelevo': ['буда-кошелево'],
          'dobrush': ['добруш'],
          'elsk': ['ельск'],
          'zhitkovichi': ['житковичи'],
          'zhlobin': ['жлобин'],
          'kalinkovichi': ['калинковичи'],
          'korma': ['корма'],
          'lelchitsy': ['лельчицы'],
          'loev': ['лоев'],
          'mozyr': ['мозырь'],
          'narovlya': ['наровля'],
          'petrikov': ['петриков'],
          'rechitsa': ['речица'],
          'rogachev': ['рогачев'],
          'svetlogorsk': ['светлогорск'],
          'chechersk': ['чечерск'],
          
          // Гродненская область
          'volkovysk': ['волковыск'],
          'voronovo': ['вороново'],
          'dyatlovo': ['дятлово'],
          'zelva': ['зельва'],
          'ivye': ['ивье'],
          'korelichi': ['кореличи'],
          'lida': ['лида'],
          'mir': ['мир'],
          'mosty': ['мосты'],
          'novogrudok': ['новогрудок'],
          'ostrovets': ['островец'],
          'oshmyany': ['ошмяны'],
          'svisloch': ['свислочь'],
          'skidel': ['скидель'],
          'slonim': ['слоним'],
          'smorgon': ['сморгонь'],
          'shchuchin': ['щучин'],
          
          // Могилёвская область
          'belynichy': ['белыничи'],
          'bobruisk': ['бобруйск'],
          'bykhov': ['быхов'],
          'glusk': ['глуск'],
          'gorki': ['горки'],
          'dribin': ['дрибин'],
          'kirovsk': ['кировск'],
          'klimovichi': ['климовичи'],
          'klichev': ['кличев'],
          'kostyukovichi': ['костюковичи'],
          'krasnopolye': ['краснополье'],
          'krichev': ['кричев'],
          'krugloe': ['круглое'],
          'mstislavl': ['мстиславль'],
          'osipovichi': ['осиповичи'],
          'slavgorod': ['славгород'],
          'khotimsk': ['хотимск'],
          'chausy': ['чаусы'],
          'cherikov': ['чериков'],
          'shklov': ['шклов'],
        };
        
        const targetCityVariants = cityMapping[filterCity.toLowerCase()] || [filterCity.toLowerCase()];
        
        allAds = allAds.filter((adData: any) => {
          const ad = adData._rawAd;
          const areaParam = ad.ad_parameters?.find((p: any) => p.p === 'area');
          if (!areaParam) return false; // Если нет информации о городе, отфильтровываем
          
          const adCity = (areaParam.vl || '').toLowerCase();
          
          // Проверяем совпадение с любым вариантом названия города
          return targetCityVariants.some(variant => 
            adCity.includes(variant) || variant.includes(adCity)
          );
        });
        
        logger.info('Filtered ads by city', { 
          filterCity, 
          before: beforeFilter, 
          after: allAds.length 
        });
      }

      // Убираем _rawAd перед возвратом
      const ads: AdData[] = allAds.map(({ _rawAd, ...ad }: any) => ad);

      logger.info('Kufar API parsing successful', { url, adsCount: ads.length });
      return ads;
    } catch (error: any) {
      logger.error('Kufar API parsing failed', { 
        url, 
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data ? JSON.stringify(error.response.data).substring(0, 500) : undefined
      });
      throw error;
    }
  }
}
