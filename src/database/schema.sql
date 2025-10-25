-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Links table
CREATE TABLE IF NOT EXISTS links (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  platform VARCHAR(50) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  error_count INTEGER DEFAULT 0,
  last_parsed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT check_platform CHECK (platform IN ('kufar', 'onliner', 'realt'))
);

CREATE INDEX IF NOT EXISTS idx_links_user_id ON links(user_id);
CREATE INDEX IF NOT EXISTS idx_links_active ON links(is_active) WHERE is_active = true;

-- Ads table
CREATE TABLE IF NOT EXISTS ads (
  id SERIAL PRIMARY KEY,
  link_id INTEGER REFERENCES links(id) ON DELETE CASCADE,
  external_id VARCHAR(255) UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  price VARCHAR(100),
  image_url TEXT,
  ad_url TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ads_link_id ON ads(link_id);
CREATE INDEX IF NOT EXISTS idx_ads_external_id ON ads(external_id);
CREATE INDEX IF NOT EXISTS idx_ads_created_at ON ads(created_at);
