-- seed_barbearia.sql
-- Executar após schema_barbearia.sql

-- Usuários
INSERT INTO users (full_name, email, phone, role) VALUES
('Carlos Tatu', 'carlos@barbearia.com', '11999990001', 'BARBEIRO'),
('Felipe Barcks', 'felipe@barbearia.com', '11999990002', 'BARBEIRO'),
('Joao Silva', 'joao@email.com', '11988887777', 'CLIENTE'),
('Pedro Lima', 'pedro@email.com', '11977776666', 'CLIENTE');

-- Perfis
INSERT INTO barbers (user_id, commission_percent, hired_at)
SELECT id, 40.00, CURRENT_DATE FROM users WHERE email = 'carlos@barbearia.com';

INSERT INTO barbers (user_id, commission_percent, hired_at)
SELECT id, 35.00, CURRENT_DATE FROM users WHERE email = 'felipe@barbearia.com';

INSERT INTO clients (user_id, birth_date, preferences)
SELECT id, DATE '1995-03-10', 'Prefere degradê baixo' FROM users WHERE email = 'joao@email.com';

INSERT INTO clients (user_id, birth_date, preferences)
SELECT id, DATE '1990-07-22', 'Barba desenhada' FROM users WHERE email = 'pedro@email.com';

-- Serviços
INSERT INTO services (name, description, price, estimated_minutes) VALUES
('Cabelo e Barba', 'Corte completo com acabamento de barba', 75.00, 60),
('Barba e Toalha Quente', 'Modelagem de barba com toalha quente', 55.00, 40),
('Corte Infantil', 'Corte para criancas', 55.00, 45),
('Corte e Sobrancelha', 'Corte tradicional + sobrancelha', 65.00, 50);

-- Agendamento exemplo
WITH ids AS (
  SELECT
    (SELECT c.user_id FROM clients c JOIN users u ON u.id = c.user_id WHERE u.email = 'joao@email.com') AS client_id,
    (SELECT b.user_id FROM barbers b JOIN users u ON u.id = b.user_id WHERE u.email = 'carlos@barbearia.com') AS barber_id
)
INSERT INTO appointments (client_id, barber_id, scheduled_start, scheduled_end, status, notes)
SELECT client_id, barber_id, NOW() + INTERVAL '1 day', NOW() + INTERVAL '1 day 1 hour', 'PENDENTE', 'Primeiro atendimento'
FROM ids;

-- Vincular serviço ao agendamento
INSERT INTO appointment_services (appointment_id, service_id, unit_price, duration_minutes)
SELECT a.id, s.id, s.price, s.estimated_minutes
FROM appointments a
JOIN services s ON s.name = 'Cabelo e Barba'
ORDER BY a.id DESC
LIMIT 1;

-- Histórico visual
INSERT INTO visual_history (client_id, appointment_id, image_url, caption)
SELECT a.client_id, a.id, 'https://exemplo.com/fotos/corte-joao-001.jpg', 'Degrade com acabamento lateral'
FROM appointments a
ORDER BY a.id DESC
LIMIT 1;
