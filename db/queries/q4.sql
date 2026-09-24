SELECT id, name, ts_rank(search_vector, plainto_tsquery('simple', 'туристичні намети')) AS rank
FROM products
WHERE search_vector @@ plainto_tsquery('simple', 'туристичні намети')
ORDER BY rank DESC, id
LIMIT 20
