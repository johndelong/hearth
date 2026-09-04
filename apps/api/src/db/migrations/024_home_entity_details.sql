ALTER TABLE home_state_cache ADD COLUMN device_id TEXT;
ALTER TABLE home_state_cache ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}';
