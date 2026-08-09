-- Runtime schemas reject invalid API input. These triggers also protect imports,
-- scripts, and future call sites that write directly to the stores.
CREATE TRIGGER validate_extra_insert BEFORE INSERT ON extras
WHEN NEW.points < 0 OR length(trim(NEW.title)) = 0
BEGIN SELECT RAISE(ABORT, 'extra job requires a title and non-negative points'); END;
CREATE TRIGGER validate_extra_update BEFORE UPDATE ON extras
WHEN NEW.points < 0 OR length(trim(NEW.title)) = 0
BEGIN SELECT RAISE(ABORT, 'extra job requires a title and non-negative points'); END;

CREATE TRIGGER validate_reward_insert BEFORE INSERT ON rewards
WHEN NEW.cost <= 0 OR length(trim(NEW.label)) = 0
BEGIN SELECT RAISE(ABORT, 'reward requires a label and positive cost'); END;
CREATE TRIGGER validate_reward_update BEFORE UPDATE ON rewards
WHEN NEW.cost <= 0 OR length(trim(NEW.label)) = 0
BEGIN SELECT RAISE(ABORT, 'reward requires a label and positive cost'); END;

CREATE TRIGGER validate_person_insert BEFORE INSERT ON people
WHEN NEW.hue < -1 OR NEW.hue > 360 OR NEW.role NOT IN ('kid', 'parent') OR length(trim(NEW.name)) = 0
BEGIN SELECT RAISE(ABORT, 'invalid person'); END;
CREATE TRIGGER validate_person_update BEFORE UPDATE ON people
WHEN NEW.hue < -1 OR NEW.hue > 360 OR NEW.role NOT IN ('kid', 'parent') OR length(trim(NEW.name)) = 0
BEGIN SELECT RAISE(ABORT, 'invalid person'); END;

CREATE TRIGGER validate_chore_insert BEFORE INSERT ON chores
WHEN length(trim(NEW.title)) = 0 OR NEW.interval_n < 1 OR NEW.interval_n > 52
BEGIN SELECT RAISE(ABORT, 'invalid chore'); END;
CREATE TRIGGER validate_chore_update BEFORE UPDATE ON chores
WHEN length(trim(NEW.title)) = 0 OR NEW.interval_n < 1 OR NEW.interval_n > 52
BEGIN SELECT RAISE(ABORT, 'invalid chore'); END;
