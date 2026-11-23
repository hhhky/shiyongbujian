-- 使用统计表结构（在 Cloudflare D1 控制台执行一次）
-- 只存匿名计数，不存任何内容、账号或位置

-- 每台设备每天一行：用于「当日使用人数」去重
CREATE TABLE IF NOT EXISTS dau (
  date TEXT NOT NULL,
  device TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (date, device)
);

-- 每天每个部件的使用次数
CREATE TABLE IF NOT EXISTS widget_daily (
  date TEXT NOT NULL,
  widget TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, widget)
);

-- 每天上报的会话数（同一设备多次打开也能看出总使用量）
CREATE TABLE IF NOT EXISTS app_daily (
  date TEXT PRIMARY KEY,
  sessions INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_dau_date ON dau (date);
CREATE INDEX IF NOT EXISTS idx_widget_daily_date ON widget_daily (date);
