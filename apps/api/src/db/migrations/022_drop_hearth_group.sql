-- Who an event is for moves from a fan-out of real copies, tied together by
-- an id hidden in each one's extended properties, to a tag read out of the
-- event's own text. There is only ever one physical event now, so nothing
-- ties copies together any more because there is nothing left to tie.
DROP INDEX IF EXISTS idx_events_group;
ALTER TABLE events DROP COLUMN hearth_group;
