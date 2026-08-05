-- Tapping a chore on the board opens its details, so a chore needs something to
-- say: how to do it, where the supplies are, what "done" actually looks like.

ALTER TABLE chores ADD COLUMN description TEXT;
ALTER TABLE extras ADD COLUMN description TEXT;

-- Claims snapshot their extra's title and points at claim time so editing the
-- extra later cannot rewrite what a kid signed up for. The instructions have to
-- travel the same way, for the same reason.
ALTER TABLE claims ADD COLUMN description TEXT;
