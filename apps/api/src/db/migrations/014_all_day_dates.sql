-- All-day events are calendar dates, not instants, and are now cached as the
-- bare `YYYY-MM-DD` Google sends. Rows written before this may hold anything
-- from a full instant to a date, so rather than guess a timezone to convert
-- them with, drop them and let the next sync fetch them again in one shape.
--
-- Clearing the sync token is what makes that happen: a null token sends the
-- next sync down the full windowed-pull path instead of the incremental one,
-- which would otherwise only report events that had *changed* at Google and
-- leave these rows sitting here wrong forever.

DELETE FROM events WHERE all_day = 1;

UPDATE calendars SET sync_token = NULL;
