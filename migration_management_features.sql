-- migration_management_features.sql

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  barbershop_id BIGINT NOT NULL REFERENCES barbershops(id),
  name VARCHAR(120) NOT NULL,
  current_qty INTEGER NOT NULL DEFAULT 0 CHECK (current_qty >= 0),
  min_qty INTEGER NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
  unit VARCHAR(20) NOT NULL DEFAULT 'un',
  cost_price NUMERIC(10,2) DEFAULT 0 CHECK (cost_price >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (barbershop_id, name)
);

CREATE INDEX IF NOT EXISTS idx_products_barbershop ON products(barbershop_id);

-- Seed de produtos demo
INSERT INTO products (barbershop_id, name, current_qty, min_qty, unit, cost_price)
SELECT b.id, p.name, p.current_qty, p.min_qty, p.unit, p.cost_price
FROM barbershops b
CROSS JOIN (
  VALUES
    ('Pomada Modeladora', 8, 5, 'un', 21.90),
    ('Shampoo Profissional', 3, 4, 'un', 34.50),
    ('Lamina Navalha', 40, 20, 'un', 1.10),
    ('Toalha Descartavel', 12, 15, 'pct', 18.00)
) AS p(name, current_qty, min_qty, unit, cost_price)
WHERE b.slug = 'navalha-demo'
ON CONFLICT (barbershop_id, name) DO NOTHING;
