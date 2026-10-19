CREATE INDEX idx_orders_user_created_at
  ON orders (user_id, created_at DESC, id DESC);

CREATE INDEX idx_orders_cancelled_created_at
  ON orders (created_at DESC, id DESC)
  WHERE status = 'cancelled';

CREATE INDEX idx_products_lower_name
  ON products ((lower(name)));

CREATE INDEX idx_products_search_vector
  ON products USING GIN (search_vector);
