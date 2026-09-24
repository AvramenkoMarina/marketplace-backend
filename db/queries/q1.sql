SELECT id, user_id, status, total, created_at
FROM orders
WHERE user_id = 42
  AND created_at >= timestamptz '2024-03-01 00:00:00+00'
  AND created_at < timestamptz '2024-06-01 00:00:00+00'
ORDER BY created_at DESC, id DESC
LIMIT 50
