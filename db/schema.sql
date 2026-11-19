-- 授权平台 Demo · D1 建表脚本
-- 本地：npx wrangler d1 execute auth-demo --local --file=./db/schema.sql
-- 线上：npx wrangler d1 execute auth-demo --remote --file=./db/schema.sql

-- 1) 用户：账号 + 密码 + 邮箱/手机号
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  account       TEXT NOT NULL UNIQUE,          -- 用户自填的登录账号（即平台内 ID 标识）
  display_name  TEXT,
  email         TEXT UNIQUE,
  phone         TEXT UNIQUE,
  avatar        TEXT,                          -- preset:0..4 或 img:dataURL，NULL=未设置
  pwd_hash      TEXT NOT NULL,                 -- PBKDF2 派生值，绝不存明文
  pwd_salt      TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT 'basic', -- basic | pro
  status        TEXT NOT NULL DEFAULT 'pending', -- pending(待验证) | active | disabled
  failed_login  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  activated_at  INTEGER
);

-- 2) 验证码：注册 / 登录共用，单次消费 + 尝试次数限制
CREATE TABLE IF NOT EXISTS otp (
  id          TEXT PRIMARY KEY,
  target      TEXT NOT NULL,                   -- 邮箱或手机号
  scene       TEXT NOT NULL,                   -- register | login
  code        TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  consumed    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_target ON otp (target, scene, created_at);

-- 3) 会话：只存 token 的 SHA-256，库被读也拿不到可用凭证
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

-- 4) 软件授权（许可证）：一用户一条，plan 决定可用功能与设备席位
CREATE TABLE IF NOT EXISTS licenses (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL UNIQUE,
  license_key  TEXT NOT NULL UNIQUE,
  plan         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',  -- active | suspended
  seats        INTEGER NOT NULL,
  issued_at    INTEGER NOT NULL,
  expires_at   INTEGER,                         -- NULL = 永不过期（demo）
  renew_source TEXT                             -- demo | webhook
);

-- 5) 设备激活：席位由 plan 决定，超席直接拒绝
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

-- 6) 回调事件：以事件 ID 为主键，重复推送不会重复开权限（幂等）
CREATE TABLE IF NOT EXISTS webhook_events (
  id          TEXT PRIMARY KEY,
  type        TEXT,
  payload     TEXT,
  processed   INTEGER NOT NULL DEFAULT 1,
  received_at INTEGER NOT NULL
);

-- 7) 审计日志：谁在什么时候开通了哪个版本
CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at INTEGER NOT NULL
);

-- 8) 备忘录：按 user_id 隔离，每人只能看到自己的
CREATE TABLE IF NOT EXISTS memos (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  title      TEXT,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memos_user ON memos (user_id, updated_at);
