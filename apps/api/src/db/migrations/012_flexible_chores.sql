-- "Mow the yard once a week" has no due day — it has a week it has to happen
-- inside. Pinning it to a weekday invents a deadline nobody meant, and then
-- punishes a kid who gets it done early.
--
-- A flexible chore files its completion under its cycle (`c:2026-08-02`)
-- rather than under the day it was ticked, so a Friday tap satisfies the week
-- and the streak finds it exactly where it comes looking.

ALTER TABLE chores ADD COLUMN flexible INTEGER NOT NULL DEFAULT 0;
