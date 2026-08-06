-- A photo is a nice avatar and a poor default: it means finding a URL, and on a
-- kitchen panel nobody does that for a six-year-old. The pack gives everyone
-- something to pick in one tap.
--
-- Kept separate from avatar_url rather than encoded into it, so choosing a face
-- doesn't destroy a photo somebody had already set — and so the column stays a
-- URL rather than a URL-or-secret-keyword.

ALTER TABLE people ADD COLUMN avatar_key TEXT;
