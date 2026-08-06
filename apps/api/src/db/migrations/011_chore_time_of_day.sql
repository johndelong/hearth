-- A board of a dozen chores reads better in the order the day actually happens.
-- This is a label to group by, not a rule: whether a chore is due is entirely
-- the recurrence rule's business, and nothing here narrows it.

ALTER TABLE chores ADD COLUMN time_of_day TEXT NOT NULL DEFAULT 'any';
