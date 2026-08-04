import { Ad } from '../types';
import { YandexMapsService } from './YandexMapsService';
import { LocationService } from './LocationService';

export interface FormattedAd {
  text: string;
  media: string[];
  location?: { lat: number; lon: number; title: string; address: string };
}

export class AdPresenter {
  private yandexMaps: YandexMapsService | null;
  private locationService: LocationService | null;

  constructor(yandexMaps: YandexMapsService | null, locationService: LocationService | null = null) {
    this.yandexMaps = yandexMaps;
    this.locationService = locationService;
  }

  async format(ad: Ad): Promise<FormattedAd> {
    let message = `${ad.title}\n💰 ${ad.price || 'Договорная'}`;

    if (ad.published_at) {
      const publishedDate = new Date(ad.published_at);
      const formattedPublished = publishedDate.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Minsk',
      });

      if (ad.updated_at) {
        const updatedDate = new Date(ad.updated_at);
        const timeDiff = updatedDate.getTime() - publishedDate.getTime();
        const daysDiff = Math.floor(timeDiff / (1000 * 60 * 60 * 24));

        if (daysDiff > 1) {
          const formattedUpdated = updatedDate.toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/Minsk',
          });
          message += `\n🕐 Опубликовано: ${formattedPublished}`;
          message += `\n🔄 Поднято: ${formattedUpdated}`;
        } else {
          message += `\n🕐 ${formattedPublished}`;
        }
      } else {
        message += `\n🕐 ${formattedPublished}`;
      }
    }

    const addressParts = [];
    if (ad.location) addressParts.push(ad.location);
    if (ad.address) addressParts.push(ad.address);
    const fullAddress = addressParts.join(', ');
    if (addressParts.length > 0) {
      message += `\n📍 ${fullAddress}`;
    }

    message += `\n🔗 ${ad.ad_url}`;

    const media: string[] = [];
    let location: FormattedAd['location'];

    if (ad.image_url) {
      media.push(ad.image_url);
    }

    if (fullAddress && this.yandexMaps) {
      try {
        const mapUrl = await this.yandexMaps.getMapForAddress(fullAddress);
        if (mapUrl) {
          media.push(mapUrl);
        }
      } catch {
        // Map generation failed, continue without map
      }
    }

    if (fullAddress && this.locationService) {
      try {
        const coords = await this.locationService.getCoordinates(ad.address, fullAddress, ad.location);
        if (coords) {
          location = {
            lat: coords.lat,
            lon: coords.lon,
            title: ad.title,
            address: fullAddress,
          };
        }
      } catch {
        // Geocoding failed, continue without location
      }
    }

    return { text: message, media, location };
  }
}
