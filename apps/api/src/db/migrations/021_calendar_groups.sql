-- A calendar can belong to a role instead of one person: "Parents" for a
-- joint calendar two adults share, "Kids" or "All" for one meant even wider.
-- Resolved against people.role wherever the calendar's people are read rather
-- than stored, so it never goes stale — another kid added later is simply
-- already covered, with nothing on this calendar to update.
ALTER TABLE calendars ADD COLUMN group_kind TEXT CHECK (group_kind IN ('parent', 'kid', 'all'));

-- Exactly one assignment, never both fighting over the same calendar's color.
CREATE TRIGGER IF NOT EXISTS calendars_one_assignment_insert
BEFORE INSERT ON calendars
WHEN NEW.person_id IS NOT NULL AND NEW.group_kind IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a calendar takes a person or a group, not both');
END;

CREATE TRIGGER IF NOT EXISTS calendars_one_assignment_update
BEFORE UPDATE OF person_id, group_kind ON calendars
WHEN NEW.person_id IS NOT NULL AND NEW.group_kind IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a calendar takes a person or a group, not both');
END;
