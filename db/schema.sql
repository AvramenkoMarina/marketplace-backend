CREATE TABLE users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_unique UNIQUE (email),
  CONSTRAINT users_email_not_blank CHECK (length(btrim(email)) > 0),
  CONSTRAINT users_display_name_not_blank CHECK (length(btrim(display_name)) > 0)
);

CREATE TABLE products (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_id bigint NOT NULL REFERENCES users (id),
  name text NOT NULL,
  description text NOT NULL,
  price numeric(12, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', name || ' ' || description)
  ) STORED,
  CONSTRAINT products_price_positive CHECK (price > 0),
  CONSTRAINT products_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT products_description_not_blank CHECK (length(btrim(description)) > 0)
);

CREATE TABLE orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users (id),
  status text NOT NULL,
  total numeric(12, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_status_check CHECK (status IN ('pending', 'paid', 'cancelled')),
  CONSTRAINT orders_total_non_negative CHECK (total >= 0)
);

CREATE TABLE order_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders (id),
  product_id bigint NOT NULL REFERENCES products (id),
  qty integer NOT NULL,
  unit_price numeric(12, 2) NOT NULL,
  CONSTRAINT order_items_qty_positive CHECK (qty > 0),
  CONSTRAINT order_items_unit_price_positive CHECK (unit_price > 0)
);
