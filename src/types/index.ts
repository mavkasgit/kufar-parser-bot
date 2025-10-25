export interface User {
  id: number;
  telegram_id: number;
  username: string | null;
  created_at: Date;
}

export interface Link {
  id: number;
  user_id: number;
  url: string;
  platform: 'kufar' | 'onliner' | 'realt';
  is_active: boolean;
  error_count: number;
  last_parsed_at: Date | null;
  created_at: Date;
}

export interface Ad {
  id: number;
  link_id: number;
  external_id: string;
  title: string;
  description: string | null;
  price: string | null;
  image_url: string | null;
  ad_url: string;
  created_at: Date;
}

export interface AdData {
  external_id: string;
  title: string;
  description?: string;
  price?: string;
  image_url?: string;
  ad_url: string;
  location?: string; // Город/область
  address?: string;  // Адрес
  published_at?: Date; // Время публикации
}

export type Platform = 'kufar' | 'onliner';
