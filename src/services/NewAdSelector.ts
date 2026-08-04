import { Ad } from '../types';

export class NewAdSelector {
  static pick(ads: Ad[], limit: number): Ad[] {
    const sorted = [...ads].sort((a, b) => {
      const dateA = a.updated_at || a.published_at || new Date(0);
      const dateB = b.updated_at || b.published_at || new Date(0);
      const timeA = dateA instanceof Date ? dateA.getTime() : new Date(dateA).getTime();
      const timeB = dateB instanceof Date ? dateB.getTime() : new Date(dateB).getTime();

      if (timeA === timeB) {
        return (b.id ?? 0) - (a.id ?? 0);
      }

      return timeB - timeA;
    });

    return sorted.slice(0, limit);
  }
}
