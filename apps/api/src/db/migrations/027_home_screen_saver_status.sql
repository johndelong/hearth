-- The per-item "show on screen saver" toggle is gone: a door, lock, or cover's
-- open/unlocked status now always shows on the screen saver — the same way a
-- triggered alarm or a low battery always has — with no opt-in required.
ALTER TABLE home_dashboard DROP COLUMN frame_alert;
