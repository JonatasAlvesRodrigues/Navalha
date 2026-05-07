-- schema_barbearia.sql
-- Banco relacional para sistema de barbearia (PostgreSQL)

-- Tipos de domínio
CREATE TYPE user_role AS ENUM ('BARBEIRO', 'CLIENTE');
CREATE TYPE appointment_status AS ENUM ('PENDENTE', 'PAGO', 'NO_SHOW', 'CANCELADO', 'CONCLUIDO');

-- Usuários (entidade base)
CREATE TABLE users (
    id                  BIGSERIAL PRIMARY KEY,
    full_name           VARCHAR(120) NOT NULL,
    email               VARCHAR(150) UNIQUE,
    phone               VARCHAR(20) UNIQUE,
    role                user_role NOT NULL,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Especialização: Barbeiros (comissão fixa)
CREATE TABLE barbers (
    user_id              BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    commission_percent   NUMERIC(5,2) NOT NULL CHECK (commission_percent >= 0 AND commission_percent <= 100),
    hired_at             DATE,
    notes                TEXT
);

-- Especialização: Clientes
CREATE TABLE clients (
    user_id              BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    birth_date           DATE,
    preferences          TEXT
);

-- Serviços oferecidos
CREATE TABLE services (
    id                   BIGSERIAL PRIMARY KEY,
    name                 VARCHAR(80) NOT NULL UNIQUE,
    description          TEXT,
    price                NUMERIC(10,2) NOT NULL CHECK (price >= 0),
    estimated_minutes    INTEGER NOT NULL CHECK (estimated_minutes > 0),
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Agendamentos
CREATE TABLE appointments (
    id                   BIGSERIAL PRIMARY KEY,
    client_id            BIGINT NOT NULL REFERENCES clients(user_id),
    barber_id            BIGINT NOT NULL REFERENCES barbers(user_id),
    scheduled_start      TIMESTAMP NOT NULL,
    scheduled_end        TIMESTAMP NOT NULL,
    status               appointment_status NOT NULL DEFAULT 'PENDENTE',
    notes                TEXT,
    created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMP NOT NULL DEFAULT NOW(),
    CHECK (scheduled_end > scheduled_start)
);

-- Itens do agendamento (N:N entre agendamento e serviços)
CREATE TABLE appointment_services (
    appointment_id       BIGINT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    service_id           BIGINT NOT NULL REFERENCES services(id),
    unit_price           NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
    duration_minutes     INTEGER NOT NULL CHECK (duration_minutes > 0),
    PRIMARY KEY (appointment_id, service_id)
);

-- Histórico visual de cortes por cliente
CREATE TABLE visual_history (
    id                   BIGSERIAL PRIMARY KEY,
    client_id            BIGINT NOT NULL REFERENCES clients(user_id) ON DELETE CASCADE,
    appointment_id       BIGINT REFERENCES appointments(id) ON DELETE SET NULL,
    image_url            TEXT NOT NULL,
    caption              VARCHAR(200),
    created_at           TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Índices principais
CREATE INDEX idx_appointments_barber_time ON appointments(barber_id, scheduled_start);
CREATE INDEX idx_appointments_client_time ON appointments(client_id, scheduled_start);
CREATE INDEX idx_visual_history_client ON visual_history(client_id, created_at);

-- Trigger genérico para atualizar updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_appointments_updated_at
BEFORE UPDATE ON appointments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Trigger para evitar conflito de horário por barbeiro
CREATE OR REPLACE FUNCTION prevent_barber_schedule_overlap()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM appointments a
        WHERE a.barber_id = NEW.barber_id
          AND a.id <> COALESCE(NEW.id, -1)
          AND a.status <> 'CANCELADO'
          AND (NEW.scheduled_start, NEW.scheduled_end) OVERLAPS (a.scheduled_start, a.scheduled_end)
    ) THEN
        RAISE EXCEPTION 'Conflito de agenda: barbeiro já possui atendimento nesse horário.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_overlap
BEFORE INSERT OR UPDATE ON appointments
FOR EACH ROW EXECUTE FUNCTION prevent_barber_schedule_overlap();

-- VIEW de resumo financeiro por agendamento
CREATE OR REPLACE VIEW v_appointment_financial AS
SELECT
    a.id AS appointment_id,
    a.barber_id,
    a.client_id,
    a.status,
    a.scheduled_start,
    COALESCE(SUM(asv.unit_price), 0)::NUMERIC(10,2) AS gross_amount,
    b.commission_percent,
    (COALESCE(SUM(asv.unit_price), 0) * b.commission_percent / 100.0)::NUMERIC(10,2) AS barber_commission
FROM appointments a
JOIN barbers b ON b.user_id = a.barber_id
LEFT JOIN appointment_services asv ON asv.appointment_id = a.id
GROUP BY a.id, a.barber_id, a.client_id, a.status, a.scheduled_start, b.commission_percent;

-- Query exemplo: comissão mensal por barbeiro (somente pagos/concluídos)
-- Substitua :year e :month pelos valores desejados
-- SELECT
--   v.barber_id,
--   u.full_name AS barber_name,
--   DATE_TRUNC('month', v.scheduled_start) AS month_ref,
--   SUM(v.gross_amount)::NUMERIC(10,2) AS total_faturado,
--   SUM(v.barber_commission)::NUMERIC(10,2) AS total_comissao
-- FROM v_appointment_financial v
-- JOIN users u ON u.id = v.barber_id
-- WHERE v.status IN ('PAGO', 'CONCLUIDO')
--   AND EXTRACT(YEAR FROM v.scheduled_start) = :year
--   AND EXTRACT(MONTH FROM v.scheduled_start) = :month
-- GROUP BY v.barber_id, u.full_name, DATE_TRUNC('month', v.scheduled_start)
-- ORDER BY total_comissao DESC;
