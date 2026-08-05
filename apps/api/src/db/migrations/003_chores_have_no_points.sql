-- Points now come only from extra jobs. Regular chores are simply expected —
-- doing them is the baseline, and picking up something extra is what earns.

-- Retire points already awarded for chores so balances match the new rule.
-- Redemptions and extra-job earnings are untouched.
DELETE FROM point_events WHERE ref_type = 'chore';

-- The per-chore value no longer means anything.
ALTER TABLE chores DROP COLUMN points;
