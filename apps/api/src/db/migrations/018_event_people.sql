-- Who is actually going to an event, which is not the same question as whose
-- calendar it sits on. A swim meet on Mum's calendar can be two of the five
-- people in the house, and per-person calendars cannot say that without
-- duplicating the event onto each one.
--
-- Kept local rather than pushed to Google as attendees: attendees are keyed by
-- email address, the kids have none, and adding them would send real
-- invitations and carry RSVP state nobody asked for.

-- The series an instance belongs to, when Google expanded one for us. Tagging
-- is keyed on this where it exists, so "who is going to swim practice" is
-- answered once rather than every Tuesday for the rest of the year.
ALTER TABLE events ADD COLUMN recurring_event_id TEXT;

-- Deliberately keyed on the Google id and not on events.id: a full window pull
-- sweeps away rows that fall outside the window and gives them a new id if they
-- come back, which would silently drop everyone tagged on them. The Google id
-- outlives that. Nothing references events(id), so nothing cascades from it.
CREATE TABLE IF NOT EXISTS event_people (
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  event_key   TEXT NOT NULL,
  person_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (calendar_id, event_key, person_id)
);

CREATE INDEX IF NOT EXISTS idx_event_people_person ON event_people(person_id);
