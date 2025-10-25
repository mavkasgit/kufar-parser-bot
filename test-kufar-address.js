const axios = require('axios');

async function testKufarAddress() {
  console.log('=== Тестируем извлечение адреса из Kufar API ===\n');

  const params = {
    cat: '1010', // Квартиры
    rgn: '7',    // Минск
    typ: 'let',  // Аренда
    size: 5,
    sort: 'lst.d'
  };

  const headers = {
    'accept': 'application/json',
    'accept-language': 'ru-RU,ru',
    'origin': 'https://auto.kufar.by',
    'referer': 'https://auto.kufar.by/',
  };

  try {
    const url = 'https://api.kufar.by/search-api/v2/search/rendered-paginated';
    const response = await axios.get(url, { params, headers });
    
    console.log(`Найдено объявлений: ${response.data?.ads?.length || 0}\n`);
    
    if (response.data?.ads?.length > 0) {
      const ad = response.data.ads[0];
      
      console.log('=== Первое объявление ===');
      console.log('ID:', ad.ad_id);
      console.log('Заголовок:', ad.subject);
      console.log('\nВсе параметры (ad_parameters):');
      
      if (ad.ad_parameters && Array.isArray(ad.ad_parameters)) {
        ad.ad_parameters.forEach((param, index) => {
          console.log(`\n[${index}]`);
          console.log('  p:', param.p);
          console.log('  pl:', param.pl);
          console.log('  v:', param.v);
          console.log('  vl:', param.vl);
        });
      }
      
      console.log('\n=== Другие поля ===');
      console.log('account_parameters:', JSON.stringify(ad.account_parameters, null, 2));
      console.log('ad_link:', ad.ad_link);
    }

  } catch (error) {
    console.error('Ошибка:', error.message);
  }
}

testKufarAddress();
