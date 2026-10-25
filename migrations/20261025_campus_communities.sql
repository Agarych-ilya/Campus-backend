-- CampusApp student community directory.
-- The NestJS service also creates this table lazily at first access.
-- Run manually if the application's MySQL user has no CREATE TABLE permission.
CREATE TABLE IF NOT EXISTS campus_communities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(80) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(40) NOT NULL,
  icon_kind VARCHAR(20) NOT NULL,
  member_count INT UNSIGNED NULL,
  telegram_url VARCHAR(512) NULL,
  vk_url VARCHAR(512) NULL,
  status ENUM('pending','approved','rejected')
    NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_community_status (status, created_at)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- User-uploaded icons are stored separately so existing community rows
-- remain backward compatible with the new gallery-upload feature.
CREATE TABLE IF NOT EXISTS campus_community_icons (
  community_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  icon_mime VARCHAR(16) NOT NULL,
  icon_data MEDIUMBLOB NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The public API only returns approved submissions.
-- Moderators review pending entries directly in MySQL for this MVP:
-- SELECT id, title, description, telegram_url, vk_url, member_count,
--        created_at FROM campus_communities WHERE status = 'pending';
-- UPDATE campus_communities SET status = 'approved'
-- WHERE id = <reviewed_id> AND status = 'pending';
-- UPDATE campus_communities SET status = 'rejected'
-- WHERE id = <reviewed_id> AND status = 'pending';
