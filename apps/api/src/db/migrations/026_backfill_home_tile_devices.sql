UPDATE home_dashboard
SET device_id = (
  SELECT home_state_cache.device_id
  FROM home_state_cache
  WHERE home_state_cache.entity_id = home_dashboard.entity_id
)
WHERE device_id IS NULL;
