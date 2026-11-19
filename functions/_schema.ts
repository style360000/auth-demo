// 建表语句（与 db/schema.sql 保持一致，供 /api/admin/init 在业务同一连接上执行）
// 全部使用 CREATE TABLE IF NOT EXISTS，可安全重复执行
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  account       TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  email         TEXT UNIQUE,
  phone         TEXT UNIQUE,
  avatar        TEXT,
  pwd_hash      TEXT NOT NULL,
  pwd_salt      TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT 'basic',
  status        TEXT NOT NULL DEFAULT 'pending',
  failed_login  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  activated_at  INTEGER
);
CREATE TABLE IF NOT EXISTS otp (
  id          TEXT PRIMARY KEY,
  target      TEXT NOT NULL,
  scene       TEXT NOT NULL,
  code        TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  consumed    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_target ON otp (target, scene, created_at);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS licenses (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL UNIQUE,
  license_key  TEXT NOT NULL UNIQUE,
  plan         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  seats        INTEGER NOT NULL,
  issued_at    INTEGER NOT NULL,
  expires_at   INTEGER,
  renew_source TEXT
);
CREATE TABLE IF NOT EXISTS activations (
  id           TEXT PRIMARY KEY,
  license_id   TEXT NOT NULL,
  device_id    TEXT NOT NULL,
  device_name  TEXT,
  activated_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE (license_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_act_license ON activations (license_id);
CREATE TABLE IF NOT EXISTS webhook_events (
  id          TEXT PRIMARY KEY,
  type        TEXT,
  payload     TEXT,
  processed   INTEGER NOT NULL DEFAULT 1,
  received_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memos (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  title      TEXT,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memos_user ON memos (user_id, updated_at);
`;
