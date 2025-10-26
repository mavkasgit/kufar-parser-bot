import axios from 'axios';
import { logger } from '../utils/logger';
import { findMinskDistrict } from '../data/minskDistricts';

export class YandexMapsService {
  private geocoderApiKey: string;
  private staticApiUrl = 'https://static-maps.yandex.ru/1.x/';
  private geocoderUrl = 'https://geocode-maps.yandex.ru/1.x/';
  private nominatimUrl = 'https://nominatim.openstreetmap.org/search';

  constructor(apiKey: string) {
    this.geocoderApiKey = apiKey;
  }

  /**
   * Получить полигон границ из OpenStreetMap
   */
  async getPolygonFromOSM(address: string): Promise<[number, number][] | null> {
    try {
      const response = await axios.get(this.nominatimUrl, {
        params: {
          q: address,
          format: 'json',
          polygon_geojson: 1,
          limit: 1,
        },
        headers: {
          'User-Agent': 'KufarParserBot/1.0',
        },
      });

      if (!response.data || response.data.length === 0) {
        return null;
      }

      const result = response.data[0];
      if (!result.geojson || !result.geojson.coordinates) {
        return null;
      }

      // Извлекаем координаты из GeoJSON
      let coordinates = result.geojson.coordinates;
      
      // Обрабатываем разные типы геометрии
      if (result.geojson.type === 'Polygon') {
        coordinates = coordinates[0]; // Берем внешнее кольцо
      } else if (result.geojson.type === 'MultiPolygon') {
        coordinates = coordinates[0][0]; // Берем первый полигон, внешнее кольцо
      } else {
        return null;
      }

      // Упрощаем полигон - берем каждую 5-ю точку для уменьшения размера URL
      const simplified: [number, number][] = [];
      for (let i = 0; i < coordinates.length; i += 5) {
        simplified.push([coordinates[i][0], coordinates[i][1]]);
      }
      
      // Замыкаем полигон
      if (simplified.length > 0) {
        simplified.push(simplified[0]);
      }

      return simplified;
    } catch (error: any) {
      logger.warn('Failed to get polygon from OSM', { address, error: error.message });
      return null;
    }
  }

  /**
   * Геокодирование адреса в координаты с информацией о типе объекта
   */
  async geocodeAddress(address: string): Promise<{ 
    lat: number; 
    lon: number; 
    kind: string;
    bounds?: { lowerCorner: [number, number]; upperCorner: [number, number] };
    envelope?: string;
  } | null> {
    try {
      const response = await axios.get(this.geocoderUrl, {
        params: {
          apikey: this.geocoderApiKey,
          geocode: address,
          format: 'json',
          results: 1,
        },
      });

      const geoObject = response.data?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
      if (!geoObject) {
        logger.warn('Geocoding failed: no results', { address });
        return null;
      }

      const coords = geoObject.Point.pos.split(' '); // "lon lat"
      const kind = geoObject.metaDataProperty?.GeocoderMetaData?.kind || 'unknown';
      
      // Получаем границы объекта (для районов и городов)
      let bounds;
      let envelope;
      if (geoObject.boundedBy?.Envelope) {
        const lowerCorner = geoObject.boundedBy.Envelope.lowerCorner.split(' ').map(parseFloat);
        const upperCorner = geoObject.boundedBy.Envelope.upperCorner.split(' ').map(parseFloat);
        bounds = {
          lowerCorner: [lowerCorner[0], lowerCorner[1]] as [number, number],
          upperCorner: [upperCorner[0], upperCorner[1]] as [number, number],
        };
        // Формат для Static API: lon1,lat1~lon2,lat2
        envelope = `${lowerCorner[0]},${lowerCorner[1]}~${upperCorner[0]},${upperCorner[1]}`;
      }

      return {
        lon: parseFloat(coords[0]),
        lat: parseFloat(coords[1]),
        kind,
        bounds,
        envelope,
      };
    } catch (error: any) {
      logger.error('Geocoding error', { address, error: error.message });
      return null;
    }
  }

  /**
   * Получить URL статической карты с маркером
   */
  getStaticMapUrl(lat: number, lon: number, zoom: number = 16): string {
    // Формат: https://static-maps.yandex.ru/1.x/?ll=lon,lat&z=zoom&l=map&pt=lon,lat,pm2rdm
    // pm2rdm - красный маркер среднего размера
    const params = new URLSearchParams({
      ll: `${lon},${lat}`,
      z: zoom.toString(),
      l: 'map',
      pt: `${lon},${lat},pm2rdm`, // Маркер
      size: '450,300', // Размер изображения
    });

    return `${this.staticApiUrl}?${params.toString()}`;
  }

  /**
   * Получить карту с границами для района/города или меткой для точного адреса
   */
  async getMapForAddress(address: string): Promise<string | null> {
    const geocodeResult = await this.geocodeAddress(address);
    if (!geocodeResult) {
      return null;
    }

    const { lat, lon, kind, envelope } = geocodeResult;

    // Для точных адресов (дом, улица) - ставим метку с большим зумом
    if (kind === 'house' || kind === 'street') {
      const params = new URLSearchParams({
        ll: `${lon},${lat}`,
        z: '11', // Более крупный зум для улиц/домов
        l: 'map',
        pt: `${lon},${lat},pm2rdm`,
        size: '600,400',
      });
      return `${this.staticApiUrl}?${params.toString()}`;
    }

    // Для районов Минска - рисуем полигон
    const minskDistrict = findMinskDistrict(address);
    if (minskDistrict && geocodeResult.bounds) {
        const polygon = minskDistrict.coordinates.map(([lon, lat]) => `${lon},${lat}`).join(',');
        logger.info('Using Minsk district boundaries', { address, district: minskDistrict.name });

        const polygonStyle = `c:FF0000CC,f:FF000033,w:3,${polygon}`;

        const params = new URLSearchParams();
        if (envelope) params.append('bbox', envelope);
        params.append('l', 'map');
        params.append('pl', polygonStyle);
        params.append('size', '600,400');

        return `${this.staticApiUrl}?${params.toString()}`;
    }

    // Для всех остальных случаев (включая города/locality) - ставим метку с подходящим зумом
    const zoom = kind === 'locality' ? '11' : kind === 'district' ? '13' : '12';
    const params = new URLSearchParams({
      ll: `${lon},${lat}`,
      z: zoom,
      l: 'map',
      pt: `${lon},${lat},pm2rdm`,
      size: '600,400',
    });

    return `${this.staticApiUrl}?${params.toString()}`;
  }

  /**
   * Получить картинку карты для адреса
   */
  async getMapImageForAddress(address: string): Promise<string | null> {
    const coords = await this.geocodeAddress(address);
    if (!coords) {
      return null;
    }

    return this.getStaticMapUrl(coords.lat, coords.lon);
  }
}
