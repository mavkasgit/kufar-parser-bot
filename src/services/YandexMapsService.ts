import axios from 'axios';
import { logger } from '../utils/logger';
import { findMinskDistrict } from '../data/minskDistricts';

interface GeocodeResult {
  lat: number;
  lon: number;
  kind: string;
  bounds?: { lowerCorner: [number, number]; upperCorner: [number, number] };
  envelope?: string;
}

export class YandexMapsService {
  private geocoderApiKey: string;
  private staticMapsApiKey: string;
  private staticApiUrl = 'https://static-maps.yandex.ru/v1';
  private geocoderUrl = 'https://geocode-maps.yandex.ru/v1/';
  private nominatimUrl = 'https://nominatim.openstreetmap.org/search';
  private geocodeCache: Map<string, GeocodeResult> = new Map();
  private referer = 'https://kufar.by/';

  constructor(apiKey: string, staticMapsApiKey?: string) {
    this.geocoderApiKey = apiKey;
    this.staticMapsApiKey = staticMapsApiKey || apiKey;
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
        timeout: 5000,
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
  async geocodeAddress(address: string): Promise<GeocodeResult | null> {
    const cacheKey = address.trim().toLowerCase();
    const cached = this.geocodeCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const response = await axios.get(this.geocoderUrl, {
        params: {
          apikey: this.geocoderApiKey,
          geocode: address,
          format: 'json',
          results: 1,
          lang: 'ru_RU',
        },
        headers: {
          'User-Agent': 'KufarParserBot/1.0',
          'Referer': this.referer,
        },
        timeout: 5000,
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

      const result: GeocodeResult = {
        lon: parseFloat(coords[0]),
        lat: parseFloat(coords[1]),
        kind,
        bounds,
        envelope,
      };

      this.geocodeCache.set(cacheKey, result);
      return result;
    } catch (error: any) {
      logger.error('Geocoding error', { address, error: error.message });
      return null;
    }
  }

  private buildStaticUrl(params: Record<string, string>): string {
    const merged = new URLSearchParams(params);
    merged.set('apikey', this.staticMapsApiKey);
    return `${this.staticApiUrl}?${merged.toString()}`;
  }

  /**
   * Получить URL статической карты с маркером
   */
  getStaticMapUrl(lat: number, lon: number, zoom: number = 16): string {
    // pm2rdm - красный маркер среднего размера
    return this.buildStaticUrl({
      ll: `${lon},${lat}`,
      z: zoom.toString(),
      l: 'map',
      pt: `${lon},${lat},pm2rdm`,
      size: '450,300',
    });
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
      return this.buildStaticUrl({
        ll: `${lon},${lat}`,
        z: '11',
        l: 'map',
        pt: `${lon},${lat},pm2rdm`,
        size: '600,400',
      });
    }

    // Для районов Минска - рисуем полигон
    const minskDistrict = findMinskDistrict(address);
    if (minskDistrict && geocodeResult.bounds) {
        const polygon = minskDistrict.coordinates.map(([lon, lat]) => `${lon},${lat}`).join(',');
        logger.info('Using Minsk district boundaries', { address, district: minskDistrict.name });

        const polygonStyle = `c:FF0000CC,f:FF000033,w:3,${polygon}`;

        const params: Record<string, string> = { l: 'map', pl: polygonStyle, size: '600,400' };
        if (envelope) params.bbox = envelope;

        return this.buildStaticUrl(params);
    }

    // Для всех остальных случаев (включая города/locality) - ставим метку с подходящим зумом
    const zoom = kind === 'locality' ? '11' : kind === 'district' ? '13' : '12';
    return this.buildStaticUrl({
      ll: `${lon},${lat}`,
      z: zoom,
      l: 'map',
      pt: `${lon},${lat},pm2rdm`,
      size: '600,400',
    });
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
