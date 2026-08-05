-- "Make the bed" is one rule that lands on three kids, each with their own bed
-- and their own checkbox. A chore therefore belongs to a set of people, not one.

CREATE TABLE IF NOT EXISTS chore_people (
  chore_id  TEXT NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (chore_id, person_id)
);

INSERT OR IGNORE INTO chore_people (chore_id, person_id) SELECT id, person_id FROM chores;

CREATE INDEX IF NOT EXISTS idx_chore_people_person ON chore_people(person_id);

-- Completion has to be per person as well as per period, or the first kid to
-- tap "Make the bed" would clear it off everyone else's board too. SQLite can't
-- widen a primary key in place, so the table is rebuilt.
CREATE TABLE chore_completions_new (
  chore_id     TEXT NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
  person_id    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  period       TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (chore_id, person_id, period)
);

-- Existing completions belong to whoever owned the chore at the time.
INSERT INTO chore_completions_new (chore_id, person_id, period, completed_at)
SELECT cc.chore_id, c.person_id, cc.period, cc.completed_at
  FROM chore_completions cc
  JOIN chores c ON c.id = cc.chore_id;

DROP TABLE chore_completions;
ALTER TABLE chore_completions_new RENAME TO chore_completions;

-- The single owner is now derived from chore_people.
DROP INDEX IF EXISTS idx_chores_person;
ALTER TABLE chores DROP COLUMN person_id;
