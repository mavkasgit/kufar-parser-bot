import axios from 'axios';
import { logger } from '../utils/logger';

export class YandexMapsService {
  private geocoderApiKey: string;
  private staticApiUrl = 'https://static-maps.yandex.ru/1.x/';
  private geocoderUrl = 'https://geocode-maps.yandex.ru/1.x/';

  constructor(apiKey: string) {
    this.geocoderApiKey = apiKey;
  }

  /**
   * Геокодирование адреса в координаты
   */
  async geocodeAddress(address: string): Promise<{ lat: number; lon: number } | null> {
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
      return {
        lon: parseFloat(coords[0]),
        lat: parseFloat(coords[1]),
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
   * Получить одну большую карту города
   */
  async getMapForAddress(address: string): Promise<string | null> {
    const coords = await this.geocodeAddress(address);
    if (!coords) {
      return null;
    }

    // Одна большая карта города
    const params = new URLSearchParams({
      ll: `${coords.lon},${coords.lat}`,
      z: '11', // Zoom для покрытия города
      l: 'map',
      pt: `${coords.lon},${coords.lat},pm2rdm`,
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
