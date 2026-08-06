-- Four canned repeats (Daily/Weekdays/Weekly/Weekends) could not say "Monday
-- and Thursday", let alone "every other week". A chore now carries the same
-- recurrence rule Google Calendar and Outlook put behind "Custom repeat": a
-- frequency, an interval, and the days it lands on.

ALTER TABLE chores ADD COLUMN freq TEXT NOT NULL DEFAULT 'weekly';
ALTER TABLE chores ADD COLUMN interval_n INTEGER NOT NULL DEFAULT 1;
-- Days of the week as a sorted CSV of 0–6, Sunday first. A bitmask would be
-- tidier to index, but nothing here queries by day and a human reading the
-- table with sqlite3 should be able to see what a chore does.
ALTER TABLE chores ADD COLUMN by_day TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6';
-- Monthly rules: exactly one of these is set, matching Google's either/or of
-- "on day 15" versus "on the third Monday".
ALTER TABLE chores ADD COLUMN by_month_day INTEGER;
ALTER TABLE chores ADD COLUMN by_set_pos INTEGER;
-- Both the first day the chore can appear and the anchor the interval counts
-- from — "every 2 weeks" needs to know which week is week one.
ALTER TABLE chores ADD COLUMN starts_on TEXT NOT NULL DEFAULT '1970-01-01';

UPDATE chores SET by_day = CASE repeat
  WHEN 'Weekdays' THEN '1,2,3,4,5'
  WHEN 'Weekends' THEN '0,6'
  -- 'Weekly' meant Sunday, which is the only day the old isDue() let it through.
  WHEN 'Weekly'   THEN '0'
  ELSE '0,1,2,3,4,5,6'
END;

-- A chore is not due before it starts, so an existing chore has to start no
-- later than its own history or past boards would suddenly read as empty.
-- Chores never completed have no history to protect and simply start today.
-- `completed_at` is UTC, `starts_on` is compared against local dates. Taking
-- the first ten characters would read an evening completion as the next day
-- and start the chore after its own history.
UPDATE chores SET starts_on = COALESCE(
  (SELECT MIN(date(cc.completed_at, 'localtime')) FROM chore_completions cc WHERE cc.chore_id = chores.id),
  date('now', 'localtime')
);

ALTER TABLE chores DROP COLUMN repeat;
