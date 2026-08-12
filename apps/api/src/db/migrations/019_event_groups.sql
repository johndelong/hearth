-- Who is going, told to Google instead of kept from it.
--
-- 018 tagged people onto an event locally. It read correctly on the panel and
-- badly everywhere else: the event sat on whichever calendar it was created
-- from, so Google — and a phone looking at Google — showed a family outing as
-- one person's appointment, with no sign of anyone else.
--
-- A shared event is now real copies, one on each attendee's calendar, tied
-- together by an id Hearth writes into each copy's private extended properties.
-- Who is going is then not stored at all: it is which calendars hold a copy,
-- which means it stays true when someone drags a copy onto another calendar in
-- Google, and it is readable on any client without Hearth in the picture.
--
-- The group is carried rather than inferred from matching titles and times.
-- Two kids with separate dentist appointments at three o'clock are two events,
-- and merging them would hide exactly the clash the panel exists to show.
ALTER TABLE events ADD COLUMN hearth_group TEXT;
CREATE INDEX IF NOT EXISTS idx_events_group ON events(hearth_group);

DROP TABLE IF EXISTS event_people;
