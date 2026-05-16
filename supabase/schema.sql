-- 提醒表
CREATE TABLE reminders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  remind_at   TIMESTAMPTZ NOT NULL,
  repeat_type TEXT NOT NULL DEFAULT 'none' CHECK (repeat_type IN ('none', 'daily', 'weekly', 'monthly')),
  done        BOOLEAN NOT NULL DEFAULT FALSE,
  notified    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引：查询到期未提醒的记录
CREATE INDEX idx_reminders_pending ON reminders (remind_at, notified, done)
  WHERE notified = FALSE AND done = FALSE;

-- Row Level Security（单用户模式，简化权限）
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

-- 允许所有操作（单用户，后续可加认证）
CREATE POLICY "allow_all" ON reminders
  FOR ALL
  USING (true)
  WITH CHECK (true);
