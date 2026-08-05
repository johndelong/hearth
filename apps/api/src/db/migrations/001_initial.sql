-- Schema for the family dashboard. Applied idempotently at boot by db/index.ts.

CREATE TABLE IF NOT EXISTS people (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  hue          INTEGER NOT NULL DEFAULT 258,
  role         TEXT NOT NULL CHECK (role IN ('kid', 'parent', 'shared')),
  bday         TEXT,
  byear        INTEGER,
  on_chores    INTEGER NOT NULL DEFAULT 1,
  on_cal       INTEGER NOT NULL DEFAULT 1,
  goal_reward_id TEXT,
  avatar_url   TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chores (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  repeat     TEXT NOT NULL DEFAULT 'Daily',
  points     INTEGER NOT NULL DEFAULT 5,
  active     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chores_person ON chores(person_id);

-- One row per chore per board period. The board "resetting" is really just the
-- period key moving on, so history is never destroyed.
CREATE TABLE IF NOT EXISTS chore_completions (
  chore_id     TEXT NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
  period       TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (chore_id, period)
);

CREATE TABLE IF NOT EXISTS extras (
  id     TEXT PRIMARY KEY,
  title  TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 10,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS claims (
  id           TEXT PRIMARY KEY,
  extra_id     TEXT NOT NULL REFERENCES extras(id) ON DELETE CASCADE,
  person_id    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  points       INTEGER NOT NULL,
  done         INTEGER NOT NULL DEFAULT 0,
  claimed_at   TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_claims_person ON claims(person_id);

CREATE TABLE IF NOT EXISTS rewards (
  id     TEXT PRIMARY KEY,
  label  TEXT NOT NULL,
  cost   INTEGER NOT NULL DEFAULT 50,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS redemptions (
  id          TEXT PRIMARY KEY,
  person_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  reward_id   TEXT,
  label       TEXT NOT NULL,
  cost        INTEGER NOT NULL,
  redeemed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redemptions_person ON redemptions(person_id);

-- Append-only ledger; a person's balance is SUM(delta).
CREATE TABLE IF NOT EXISTS point_events (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  ref_type   TEXT NOT NULL,
  ref_id     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_points_person ON point_events(person_id);
-- Guarantees a chore can only ever pay out once per board period.
CREATE UNIQUE INDEX IF NOT EXISTS idx_points_ref ON point_events(ref_type, ref_id)
  WHERE ref_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS google_accounts (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  refresh_token TEXT NOT NULL,
  access_token  TEXT,
  expiry        INTEGER,
  connected_at  TEXT NOT NULL,
  last_sync_at  TEXT,
  error         TEXT
);

CREATE TABLE IF NOT EXISTS calendars (
  id                 TEXT PRIMARY KEY,
  account_id         TEXT NOT NULL REFERENCES google_accounts(id) ON DELETE CASCADE,
  google_calendar_id TEXT NOT NULL,
  summary            TEXT NOT NULL,
  description        TEXT,
  person_id          TEXT REFERENCES people(id) ON DELETE SET NULL,
  enabled            INTEGER NOT NULL DEFAULT 1,
  read_only          INTEGER NOT NULL DEFAULT 1,
  is_primary         INTEGER NOT NULL DEFAULT 0,
  sync_token         TEXT,
  time_zone          TEXT,
  UNIQUE (account_id, google_calendar_id)
);

-- Local cache of Google events so the wall panel renders instantly and keeps
-- working when the network or Google is down.
CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  calendar_id  TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  google_id    TEXT NOT NULL,
  title        TEXT NOT NULL,
  location     TEXT,
  description  TEXT,
  start_utc    TEXT NOT NULL,
  end_utc      TEXT NOT NULL,
  all_day      INTEGER NOT NULL DEFAULT 0,
  status       TEXT,
  updated_at   TEXT,
  UNIQUE (calendar_id, google_id)
);
CREATE INDEX IF NOT EXISTS idx_events_span ON events(start_utc, end_utc);
