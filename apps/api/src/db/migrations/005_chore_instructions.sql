-- The details modal separates two things 004 had collapsed into one column:
-- `description` says what the chore is, `instructions` says how to do it. A kid
-- reading "Feed Biscuit" wants both, but they are not the same sentence.

ALTER TABLE chores ADD COLUMN instructions TEXT;
ALTER TABLE extras ADD COLUMN instructions TEXT;

-- Snapshotted at claim time, for the same reason description is.
ALTER TABLE claims ADD COLUMN instructions TEXT;
