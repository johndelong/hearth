CREATE TABLE activity_log (
  id         TEXT PRIMARY KEY,
  action     TEXT NOT NULL,
  subject    TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_activity_created ON activity_log(created_at DESC);
