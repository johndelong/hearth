-- "Family" was a placeholder from the seed that used to ship a starter
-- household. It held a shared calendar so those events rendered in neutral
-- slate — but an unassigned calendar already does that, so it was never
-- earning its place. The role went with it.
--
-- Anything a shared entry owned is removed by the CASCADE on people(id).

DELETE FROM people WHERE role = 'shared';

-- The CHECK on people.role still lists 'shared'. Rewriting it means rebuilding
-- the table, and eight tables reference people(id) ON DELETE CASCADE — dropping
-- the parent inside a migration transaction (where PRAGMA foreign_keys cannot
-- be turned off) would cascade those children away. The constraint is left as
-- a wider-than-necessary guard; nothing can write the value now that the Role
-- type and the editor no longer offer it.
