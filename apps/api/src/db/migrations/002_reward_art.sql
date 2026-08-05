-- Prize cards in the catalog are image-led. A reward can carry a photo URL, an
-- icon (an emoji, which needs no asset pipeline and works offline), or neither —
-- in which case the card falls back to the gift glyph on a tint.
ALTER TABLE rewards ADD COLUMN image_url TEXT;
ALTER TABLE rewards ADD COLUMN icon TEXT;

-- Give the seeded rewards something to show straight away.
UPDATE rewards SET icon = '🍦' WHERE id = 'rw0' AND icon IS NULL;
UPDATE rewards SET icon = '📓' WHERE id = 'rw1' AND icon IS NULL;
UPDATE rewards SET icon = '🎬' WHERE id = 'rw2' AND icon IS NULL;
UPDATE rewards SET icon = '🧪' WHERE id = 'rw3' AND icon IS NULL;
UPDATE rewards SET icon = '🛼' WHERE id = 'rw4' AND icon IS NULL;
