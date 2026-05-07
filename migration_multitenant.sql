-- migration_multitenant.sql

CREATE TABLE IF NOT EXISTS barbershops (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(120) NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO barbershops (name, slug)
SELECT 'Navalha Demo', 'navalha-demo'
WHERE NOT EXISTS (SELECT 1 FROM barbershops WHERE slug = 'navalha-demo');

ALTER TABLE users ADD COLUMN IF NOT EXISTS barbershop_id BIGINT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS barbershop_id BIGINT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS barbershop_id BIGINT;
ALTER TABLE visual_history ADD COLUMN IF NOT EXISTS barbershop_id BIGINT;

UPDATE users SET barbershop_id = (SELECT id FROM barbershops WHERE slug = 'navalha-demo' LIMIT 1) WHERE barbershop_id IS NULL;
UPDATE services SET barbershop_id = (SELECT id FROM barbershops WHERE slug = 'navalha-demo' LIMIT 1) WHERE barbershop_id IS NULL;
UPDATE appointments SET barbershop_id = (SELECT id FROM barbershops WHERE slug = 'navalha-demo' LIMIT 1) WHERE barbershop_id IS NULL;
UPDATE visual_history SET barbershop_id = (SELECT id FROM barbershops WHERE slug = 'navalha-demo' LIMIT 1) WHERE barbershop_id IS NULL;

ALTER TABLE users ALTER COLUMN barbershop_id SET NOT NULL;
ALTER TABLE services ALTER COLUMN barbershop_id SET NOT NULL;
ALTER TABLE appointments ALTER COLUMN barbershop_id SET NOT NULL;
ALTER TABLE visual_history ALTER COLUMN barbershop_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_users_barbershop') THEN
    ALTER TABLE users ADD CONSTRAINT fk_users_barbershop FOREIGN KEY (barbershop_id) REFERENCES barbershops(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_services_barbershop') THEN
    ALTER TABLE services ADD CONSTRAINT fk_services_barbershop FOREIGN KEY (barbershop_id) REFERENCES barbershops(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_appointments_barbershop') THEN
    ALTER TABLE appointments ADD CONSTRAINT fk_appointments_barbershop FOREIGN KEY (barbershop_id) REFERENCES barbershops(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_visual_history_barbershop') THEN
    ALTER TABLE visual_history ADD CONSTRAINT fk_visual_history_barbershop FOREIGN KEY (barbershop_id) REFERENCES barbershops(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_barbershop ON users(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_services_barbershop ON services(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_appointments_barbershop ON appointments(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_visual_history_barbershop ON visual_history(barbershop_id);
