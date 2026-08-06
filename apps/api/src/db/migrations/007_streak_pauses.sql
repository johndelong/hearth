-- Streaks are computed from completion history rather than stored, so pausing
-- one has to be a fact about a span of days, not a flag about right now. A bare
-- boolean could not tell you which days to skip when the streak is recomputed.
--
-- `ended_on` NULL means the pause is still running.

CREATE TABLE IF NOT EXISTS streak_pauses (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  started_on TEXT NOT NULL,
  ended_on   TEXT
);

CREATE INDEX IF NOT EXISTS idx_streak_pauses_person ON streak_pauses(person_id, started_on);
