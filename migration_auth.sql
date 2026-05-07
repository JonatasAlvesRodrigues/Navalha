-- migration_auth.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- Senhas iniciais para ambiente local:
-- barbeiros: admin123
-- clientes: cliente123
UPDATE users
SET password_hash = '$2b$10$SzJi6LZMn2UirSKBEYnOW.T8dA4ag1E5kVx0anabEEn9q.3RdHMO2'
WHERE role = 'BARBEIRO';

UPDATE users
SET password_hash = '$2b$10$f52iX4SZ/XL9ePDZk2XzB.XO/bKWtXTw/7wtCE01U7Nq4lQ4zjBvC'
WHERE role = 'CLIENTE';

ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
