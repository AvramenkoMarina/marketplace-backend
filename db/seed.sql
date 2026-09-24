INSERT INTO users (email, display_name, created_at)
SELECT
  'user' || g || '@marketplace.ua',
  'Buyer ' || g,
  timestamptz '2023-01-01 00:00:00+00' + make_interval(mins => g)
FROM generate_series(1, 5000) AS g;

INSERT INTO products (seller_id, name, description, price, created_at)
SELECT
  1 + (g % 5000),
  CASE
    WHEN g % 50 = 0 THEN 'Туристичні намети ' || g
    WHEN g % 125 = 1 THEN 'Ремонт каркаса наметів ' || g
    ELSE (
      ARRAY[
        'Двомісний намет',
        'Спальний мішок',
        'Туристичний пальник',
        'Налобний ліхтар',
        'Термос',
        'Похідний рюкзак',
        'Каремат',
        'Трекінгові палиці'
      ]
    )[1 + (g % 8)] || ' ' || g
  END,
  CASE
    WHEN g % 50 = 0 THEN 'Легкі туристичні намети для кемпінгу, модель ' || g
    WHEN g % 125 = 1 THEN 'Запчастини для каркаса наметів, артикул ' || g
    ELSE 'Спорядження для кемпінгу, артикул ' || g || '. Підходить для походу.'
  END,
  (199 + (g % 50000))::numeric / 100,
  timestamptz '2023-06-01 00:00:00+00' + make_interval(mins => g)
FROM generate_series(1, 120000) AS g;

INSERT INTO orders (user_id, status, total, created_at)
SELECT
  1 + (g % 5000),
  CASE
    WHEN g % 100 < 88 THEN 'paid'
    WHEN g % 100 < 98 THEN 'pending'
    ELSE 'cancelled'
  END,
  (499 + (g % 200000))::numeric / 100,
  timestamptz '2024-01-01 00:00:00+00' + make_interval(mins => g * 5)
FROM generate_series(1, 120000) AS g;

INSERT INTO order_items (order_id, product_id, qty, unit_price)
SELECT
  g,
  1 + ((g * 7) % 120000),
  1 + (g % 3),
  (199 + (g % 50000))::numeric / 100
FROM generate_series(1, 120000) AS g;

VACUUM (ANALYZE);
