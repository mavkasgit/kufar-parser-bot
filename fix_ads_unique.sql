-- Убираем UNIQUE constraint с external_id
ALTER TABLE ads DROP CONSTRAINT IF EXISTS ads_external_id_key;

-- Создаем составной уникальный индекс для link_id + external_id
-- Это позволит одно и то же объявление сохранять для разных ссылок (пользователей)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ads_link_external ON ads(link_id, external_id);
