-- Flexible chores turned out to solve the wrong problem. "Once per cycle, any
-- day" could not describe M/W/F without silently collapsing three occurrences
-- into one, and every attempt to fix that grew a second scheduling vocabulary
-- alongside the recurrence rule.
--
-- Being early is not a property of the schedule. It is a property of one tick:
-- the completion already records which occurrence it satisfies (`period`) and
-- when it actually happened (`completed_at`), and letting those two differ is
-- the whole feature. See 014.

ALTER TABLE chores DROP COLUMN flexible;
