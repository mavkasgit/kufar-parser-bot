import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { User, Link, Ad, AdData, Platform } from '../types';
import { logger } from '../utils/logger';

export class DatabaseService {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.pool.on('error', (err: Error) => {
      logger.error('Unexpected database error', { error: err.message });
    });
  }

  async initialize(): Promise<void> {
    try {
      const schemaPath = join(__dirname, 'schema.sql');
      const schema = readFileSync(schemaPath, 'utf-8');
      await this.pool.query(schema);
      logger.info('Database schema initialized');
    } catch (error) {
      logger.error('Failed to initialize database', { error });
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  // User operations
  async createUser(telegramId: number, username: string | null): Promise<User> {
    const result = await this.pool.query<User>(
      'INSERT INTO users (telegram_id, username) VALUES ($1, $2) ON CONFLICT (telegram_id) DO UPDATE SET username = $2 RETURNING *',
      [telegramId, username]
    );
    return result.rows[0];
  }

  async getUser(telegramId: number): Promise<User | null> {
    const result = await this.pool.query<User>(
      'SELECT * FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    return result.rows[0] || null;
  }

  async getUserById(userId: number): Promise<User | null> {
    const result = await this.pool.query<User>(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );
    return result.rows[0] || null;
  }

  // Link operations
  async createLink(userId: number, url: string, platform: Platform): Promise<Link> {
    const result = await this.pool.query<Link>(
      'INSERT INTO links (user_id, url, platform) VALUES ($1, $2, $3) RETURNING *',
      [userId, url, platform]
    );
    return result.rows[0];
  }

  async getUserLinks(userId: number): Promise<Link[]> {
    const result = await this.pool.query<Link>(
      'SELECT * FROM links WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return result.rows;
  }

  async getUserLinksCount(userId: number): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM links WHERE user_id = $1',
      [userId]
    );
    return parseInt(result.rows[0].count, 10);
  }

  async getLink(linkId: number): Promise<Link | null> {
    const result = await this.pool.query<Link>(
      'SELECT * FROM links WHERE id = $1',
      [linkId]
    );
    return result.rows[0] || null;
  }

  async deleteLink(linkId: number): Promise<void> {
    await this.pool.query('DELETE FROM links WHERE id = $1', [linkId]);
  }

  async getActiveLinks(): Promise<Link[]> {
    const result = await this.pool.query<Link>(
      'SELECT * FROM links WHERE is_active = true'
    );
    return result.rows;
  }

  async incrementErrorCount(linkId: number): Promise<void> {
    await this.pool.query(
      'UPDATE links SET error_count = error_count + 1 WHERE id = $1',
      [linkId]
    );
  }

  async markLinkInactive(linkId: number): Promise<void> {
    await this.pool.query(
      'UPDATE links SET is_active = false WHERE id = $1',
      [linkId]
    );
  }

  async updateLastParsed(linkId: number): Promise<void> {
    await this.pool.query(
      'UPDATE links SET last_parsed_at = CURRENT_TIMESTAMP WHERE id = $1',
      [linkId]
    );
  }

  async resetErrorCount(linkId: number): Promise<void> {
    await this.pool.query(
      'UPDATE links SET error_count = 0 WHERE id = $1',
      [linkId]
    );
  }

  // Ad operations
  async createAd(linkId: number, adData: AdData): Promise<Ad> {
    const result = await this.pool.query<Ad>(
      `INSERT INTO ads (link_id, external_id, title, description, price, image_url, ad_url, location, address, published_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       ON CONFLICT (link_id, external_id) DO NOTHING 
       RETURNING *`,
      [
        linkId, 
        adData.external_id, 
        adData.title, 
        adData.description || null, 
        adData.price || null, 
        adData.image_url || null, 
        adData.ad_url,
        adData.location || null,
        adData.address || null,
        adData.published_at || null
      ]
    );
    return result.rows[0];
  }

  async getAdByExternalId(externalId: string): Promise<Ad | null> {
    const result = await this.pool.query<Ad>(
      'SELECT * FROM ads WHERE external_id = $1',
      [externalId]
    );
    return result.rows[0] || null;
  }

  async isNewAd(externalId: string): Promise<boolean> {
    const ad = await this.getAdByExternalId(externalId);
    return ad === null;
  }

  async isNewAdForLink(linkId: number, externalId: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT id FROM ads WHERE link_id = $1 AND external_id = $2',
      [linkId, externalId]
    );
    return result.rows.length === 0;
  }
}
