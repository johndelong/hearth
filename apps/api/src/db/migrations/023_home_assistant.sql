CREATE TABLE home_dashboard (
  entity_id    TEXT PRIMARY KEY,
  display_name TEXT,
  sort_order   INTEGER NOT NULL,
  frame_alert  INTEGER NOT NULL DEFAULT 0 CHECK (frame_alert IN (0, 1))
);

-- The last observation makes a temporary Home Assistant outage explicit
-- without turning every entity into an empty card after Hearth restarts.
CREATE TABLE home_state_cache (
  entity_id    TEXT PRIMARY KEY,
  state        TEXT NOT NULL,
  name         TEXT NOT NULL,
  domain       TEXT NOT NULL,
  device_class TEXT,
  area         TEXT,
  unit         TEXT,
  last_changed TEXT,
  observed_at  TEXT NOT NULL
);
