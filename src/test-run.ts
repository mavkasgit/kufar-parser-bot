бля бдаваimport 'dotenv/config';
import { KufarParser } from './parsers/KufarParser';
import { AdData } from './types';
import { YandexMapsService } from './services/YandexMapsService';

// Simplified version of BotHandler's sendAdWithMap for demonstration
async function displayAd(ad: AdData, yandexMaps: YandexMapsService | null) {
  let message = `
----------------------------------------
`;
  message += `${ad.title}\n💰 ${ad.price}`;

  if (ad.published_at) {
    const date = new Date(ad.published_at);
    const formattedDate = date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Minsk',
    });
    message += `\n🕐 ${formattedDate}`;
  }

  const addressParts = [];
  if (ad.location) addressParts.push(ad.location);
  if (ad.address) addressParts.push(ad.address);
  if (addressParts.length > 0) {
    message += `\n📍 ${addressParts.join(', ')}`;
  }

  message += `\n🔗 ${ad.ad_url}`;
  console.log(message);

  // Simulate showing map
  if (ad.address && yandexMaps) {
      try {
        const fullAddress = [ad.location, ad.address].filter(Boolean).join(', ');
        const mapUrl = await yandexMaps.getMapForAddress(fullAddress);
        if (mapUrl) {
          console.log(`🗺️ Карта: Да (URL бы был: ${mapUrl.substring(0, 80)}...)`);
        } else {
          console.log('🗺️ Карта: Нет (не удалось создать карту)');
        }
      } catch (e: any) {
        console.log(`🗺️ Карта: Ошибка (${e.message})`);
      }
  } else {
      console.log('🗺️ Карта: Нет (точный адрес не указан)');
  }
  console.log(`----------------------------------------`);
}

async function runTest() {
  console.log('--- ЗАПУСК ТЕСТОВОГО ПРОГОНА ---');

  const urlsToTest = [
    {
      description: '1. Недвижимость (аренда квартир в Минске)',
      url: 'https://re.kufar.by/l/minsk/snyat/kvartiru/bez-posrednikov?cur=BYR&prc=r%3A500000%2C100000000000&rms=v.or%3A1%2C2'
    },
    {
      description: '2. Обычные товары (музыкальные инструменты в Минске)',
      url: 'https://www.kufar.by/l/r~minsk/muzykalnye-instrumenty'
    },
    {
      description: '3. Обычные товары с поисковым запросом',
      url: 'https://www.kufar.by/l/r~minsk/muzykalnye-instrumenty?query=гитара'
    }
  ];

  const parser = new KufarParser();
  const yandexApiKey = process.env.YANDEX_MAPS_API_KEY;
  const yandexMaps = yandexApiKey ? new YandexMapsService(yandexApiKey) : null;
  if (!yandexMaps) {
      console.log('\n⚠️  Ключ YANDEX_MAPS_API_KEY не найден, карты будут отключены.\n');
  }

  for (const test of urlsToTest) {
    console.log(`\n--- Тестируем: ${test.description} ---\nURL: ${test.url}\n`);
    try {
      const ads = await parser.parseUrl(test.url);
      console.log(`✅ Найдено объявлений: ${ads.length}`);

      if (ads.length > 0) {
        console.log('\n📋 Показываю первое объявление:');
        await displayAd(ads[0], yandexMaps);
      } else {
        console.log('\n❌ Объявлений не найдено. Это может быть нормально, если по фильтрам действительно ничего нет.');
      }

    } catch (error: any) {
      console.error(`\n❌ ОШИБКА при парсинге: ${error.message}`);
    }
  }
  
  console.log('\n--- ТЕСТОВЫЙ ПРОГОН ЗАВЕРШЕН ---');
}

runTest();
