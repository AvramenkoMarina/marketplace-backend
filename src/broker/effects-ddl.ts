export const ORDER_PLACED_EFFECTS_DDL = `
CREATE TABLE IF NOT EXISTS order_placed_effects (
  event_id text PRIMARY KEY,
  order_id text NOT NULL,
  buyer_id text NOT NULL,
  product_id text NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  occurred_at timestamptz NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;
