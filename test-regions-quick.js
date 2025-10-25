const axios = require('axios');

// Быстрый тест ключевых регионов
const tests = [
  { name: 'Минск', rgn: '7', expected: 'Минск' },
  { name: 'Брест', rgn: '1', expected: 'Брестская область' },
  { name: 'Витебск', rgn: '6', expected: 'Витебская область' },
  { name: 'Гомель', rgn: '2', expected: 'Гомельская область' },
  { name: 'Гродно', rgn: '3', expected: 'Гродненская область' },
  { name: 'Могилев', rgn: '4', expected: 'Могилевская область' },
  { name: 'Минская обл', rgn: '5', expected: 'Минская область' },
];

async function testRegion(test) {
  try {
    const response = await axios.get('https://api.kufar.by/search-api/v2/search/rendered-paginated', {
      params: {
        size: 3,
        sort: 'lst.d',
        cat: '1010',
        typ: 'let',
        rgn: test.rgn
      },
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'accept': 'application/json',
      },
    });

    const ads = response.data?.ads || [];
    if (ads.length > 0) {
      const regionParam = ads[0].ad_parameters?.find(p => p.p === 'region');
      const actualRegion = regionParam?.vl || 'не указан';
      
      const match = actualRegion === test.expected;
      const icon = match ? '✅' : '❌';
      
      console.log(`${icon} rgn=${test.rgn} (${test.name}): ${actualRegion} ${match ? '' : `(ожидалось: ${test.expected})`}`);
      
      return match;
    } else {
      console.log(`⚠️  rgn=${test.rgn} (${test.name}): нет объявлений`);
      return null;
    }
  } catch (error) {
    console.log(`❌ rgn=${test.rgn} (${test.name}): ошибка - ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log('🔍 БЫСТРАЯ ПРОВЕРКА РЕГИОНОВ KUFAR API\n');
  
  const results = [];
  for (const test of tests) {
    const result = await testRegion(test);
    results.push(result);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  const passed = results.filter(r => r === true).length;
  const failed = results.filter(r => r === false).length;
  const skipped = results.filter(r => r === null).length;
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Результаты: ✅ ${passed} успешно | ❌ ${failed} ошибок | ⚠️  ${skipped} пропущено`);
  console.log('='.repeat(60));
  
  if (failed === 0 && passed > 0) {
    console.log('✅ ВСЕ РЕГИОНЫ КОРРЕКТНЫ!');
  } else if (failed > 0) {
    console.log('❌ ЕСТЬ ОШИБКИ В МАППИНГЕ РЕГИОНОВ!');
  }
}

runTests();
