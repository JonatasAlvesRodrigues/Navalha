const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { analyzeClientRecurrenceAndNotify, runDailyReminderSweep } = require('./reminderService');
const { loadSecurityConfig } = require('./securityConfig');
require('dotenv').config();

const app = express();
const port = Number(process.env.PORT || 3000);
const { jwtSecret, ownerEmail, ownerPassword, ownerAuthEnabled } = loadSecurityConfig();
const reminderCron = process.env.REMINDER_CRON || '0 9 * * *';
const reminderTimezone = process.env.REMINDER_TIMEZONE || 'America/Sao_Paulo';
const reminderProvider = process.env.REMINDER_PROVIDER || 'evolution';
const reminderThreshold = Number(process.env.REMINDER_THRESHOLD_DAYS_BEFORE || 2);
const enableReminderCron = String(process.env.REMINDER_CRON_ENABLED || 'true') === 'true';

app.use(cors());
app.use(express.json());

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      fullName: user.full_name,
      email: user.email,
      phone: user.phone,
      tenantId: user.tenant_id,
      tenantSlug: user.tenant_slug,
      forcePasswordChange: Boolean(user.must_change_password),
    },
    jwtSecret,
    { expiresIn: '8h' }
  );
}

function authRequired(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [, token] = authHeader.split(' ');
  if (!token) return res.status(401).json({ error: 'Token ausente.' });

  try {
    req.user = jwt.verify(token, jwtSecret);
    return next();
  } catch (_err) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

function barberOnly(req, res, next) {
  if (req.user.role !== 'BARBEIRO') return res.status(403).json({ error: 'Acesso permitido apenas para barbeiros.' });
  return next();
}

function clientOnly(req, res, next) {
  if (req.user.role !== 'CLIENTE') return res.status(403).json({ error: 'Acesso permitido apenas para clientes.' });
  return next();
}

function ownerOnly(req, res, next) {
  if (req.user.role !== 'DONO_SISTEMA') return res.status(403).json({ error: 'Acesso permitido apenas para o dono do sistema.' });
  return next();
}

async function resolveTenantIdBySlug(slug) {
  if (!slug) return null;
  const { rows } = await pool.query('SELECT id, slug FROM barbershops WHERE slug = $1 AND is_active = true', [slug]);
  return rows[0] || null;
}

function tenantSlugFromReq(req) {
  return req.headers['x-tenant-slug'] || req.query.tenantSlug || req.body?.tenantSlug || null;
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function ensureOwnerTables() {
  await pool.query(`ALTER TABLE barbershops ADD COLUMN IF NOT EXISTS city VARCHAR(120)`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE barbers ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(30)`);
  await pool.query(`ALTER TABLE barbers ADD COLUMN IF NOT EXISTS instagram VARCHAR(120)`);
  await pool.query(`ALTER TABLE barbers ADD COLUMN IF NOT EXISTS city VARCHAR(120)`);
  await pool.query(`ALTER TABLE barbers ADD COLUMN IF NOT EXISTS availability_json JSONB`);

  await pool.query(
    `CREATE TABLE IF NOT EXISTS platform_trials (
      id BIGSERIAL PRIMARY KEY,
      barbershop_id BIGINT NOT NULL UNIQUE,
      granted_by VARCHAR(140),
      notes TEXT,
      trial_starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      trial_ends_at TIMESTAMPTZ NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS platform_subscriptions (
      id BIGSERIAL PRIMARY KEY,
      barbershop_id BIGINT NOT NULL UNIQUE,
      plan_name VARCHAR(60) NOT NULL DEFAULT 'TRIAL',
      monthly_price NUMERIC(10,2) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'TRIAL',
      billing_started_at TIMESTAMPTZ,
      canceled_at TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS onboarding_profiles (
      barbershop_id BIGINT PRIMARY KEY,
      setup_step VARCHAR(40) NOT NULL DEFAULT 'BASICO',
      checklist_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS schedule_blocks (
      id BIGSERIAL PRIMARY KEY,
      barbershop_id BIGINT NOT NULL,
      barber_id BIGINT,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      reason TEXT,
      created_by BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );
}

function normalizeAvailability(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const daysRaw = Array.isArray(raw.days) ? raw.days : [];
  const days = [...new Set(daysRaw.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
  if (!days.length) return null;

  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const start = String(raw.start || '').trim();
  const end = String(raw.end || '').trim();
  if (!timeRegex.test(start) || !timeRegex.test(end)) return null;
  if (start >= end) return null;

  const slot = Number(raw.slotMinutes ?? 30);
  if (!Number.isInteger(slot) || slot < 5 || slot > 120) return null;

  return { days, start, end, slotMinutes: slot };
}

app.get('/api/public/barbershops', async (req, res) => {
  const city = String(req.query.city || '').trim();
  const params = [];
  let where = 'WHERE is_active = true';

  if (city) {
    params.push(`%${city}%`);
    where += ` AND city ILIKE $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT id, name, slug, city
     FROM barbershops
     ${where}
     ORDER BY name ASC
     LIMIT 50`,
    params
  );
  return res.json(rows);
});

app.get('/api/public/cities', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT city
     FROM (
       SELECT b.city
       FROM barbershops b
       WHERE b.is_active = true
       UNION
       SELECT br.city
       FROM barbers br
       JOIN users u ON u.id = br.user_id
       WHERE u.is_active = true
     ) c
     WHERE city IS NOT NULL AND TRIM(city) <> ''
     ORDER BY city ASC`
  );
  return res.json(rows.map((r) => r.city));
});

async function rebalanceBarberCommissions(conn, tenantId, fixedBarberId, fixedCommission) {
  const fixed = Number(fixedCommission);
  if (!Number.isFinite(fixed) || fixed < 0 || fixed > 100) {
    throw new Error('commissionPercent deve estar entre 0 e 100.');
  }

  await conn.query(
    `UPDATE barbers
     SET commission_percent = $1
     WHERE user_id = $2`,
    [fixed, fixedBarberId]
  );

  const { rows: others } = await conn.query(
    `SELECT b.user_id, b.commission_percent
     FROM barbers b
     JOIN users u ON u.id = b.user_id
     WHERE u.barbershop_id = $1
       AND u.is_active = true
       AND b.user_id <> $2`,
    [tenantId, fixedBarberId]
  );

  if (!others.length) return;

  const remaining = 100 - fixed;
  const totalOthers = others.reduce((acc, row) => acc + Number(row.commission_percent || 0), 0);

  let allocations;
  if (totalOthers <= 0) {
    const equal = remaining / others.length;
    allocations = others.map((row) => ({ userId: row.user_id, value: equal }));
  } else {
    allocations = others.map((row) => ({
      userId: row.user_id,
      value: (remaining * Number(row.commission_percent || 0)) / totalOthers,
    }));
  }

  const rounded = allocations.map((a) => ({
    userId: a.userId,
    value: Number(a.value.toFixed(2)),
  }));

  const sumRounded = rounded.reduce((acc, row) => acc + row.value, 0);
  const delta = Number((remaining - sumRounded).toFixed(2));
  rounded[0].value = Number((rounded[0].value + delta).toFixed(2));

  for (const item of rounded) {
    await conn.query(
      `UPDATE barbers
       SET commission_percent = $1
       WHERE user_id = $2`,
      [item.value, item.userId]
    );
  }
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'connected' });
  } catch (error) {
    res.status(500).json({ ok: false, db: 'disconnected', error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, phone, password } = req.body;
  const rawIdentifier = (email || phone || '').trim();
  const identifierEmail = normalizeEmail(rawIdentifier);
  const identifierPhone = normalizePhone(rawIdentifier);
  const tenantSlug = tenantSlugFromReq(req);

  if (!rawIdentifier || !password) {
    return res.status(400).json({ error: 'telefone/email e senha são obrigatórios.' });
  }

  const globalLookup = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.password_hash, u.is_active, u.must_change_password,
            b.id AS tenant_id, b.slug AS tenant_slug
     FROM users u
     JOIN barbershops b ON b.id = u.barbershop_id
     WHERE ((LOWER(COALESCE(u.email, '')) = $1) OR (REGEXP_REPLACE(COALESCE(u.phone, ''), '\\D', '', 'g') = $2))
       AND u.is_active = true
       AND b.is_active = true
     ORDER BY u.id DESC`,
    [identifierEmail, identifierPhone]
  );

  const candidates = globalLookup.rows || [];
  if (!candidates.length) return res.status(401).json({ error: 'Credenciais inválidas.' });

  const validCandidates = [];
  for (const candidate of candidates) {
    const validPassword = await bcrypt.compare(password, candidate.password_hash);
    if (validPassword) validCandidates.push(candidate);
  }
  if (!validCandidates.length) return res.status(401).json({ error: 'Credenciais inválidas.' });

  let user = null;
  if (tenantSlug) {
    user = validCandidates.find((candidate) => candidate.tenant_slug === tenantSlug) || null;
  }
  if (!user && validCandidates.length === 1) {
    user = validCandidates[0];
  }
  if (!user) {
    return res.status(409).json({ error: 'Conta encontrada em outra barbearia. Acesse usando o link/tenant correto.' });
  }

  const token = createToken(user);
  res.json({
    token,
    requirePasswordChange: Boolean(user.must_change_password),
    user: {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      tenantSlug: user.tenant_slug,
    },
  });
});

app.patch('/api/auth/change-password', authRequired, async (req, res) => {
  const userId = Number(req.user?.id);
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'Usuário inválido.' });
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Senha atual e nova senha são obrigatórias.' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'A nova senha deve ter no mínimo 6 caracteres.' });

  const { rows } = await pool.query(
    `SELECT id, password_hash
     FROM users
     WHERE id = $1 AND is_active = true`,
    [userId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const validPassword = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!validPassword) return res.status(401).json({ error: 'Senha atual inválida.' });

  const newHash = await bcrypt.hash(newPassword, 10);
  const { rows: updatedRows } = await pool.query(
    `UPDATE users
     SET password_hash = $1,
         must_change_password = false
     WHERE id = $2
     RETURNING id, full_name, email, phone, role, barbershop_id`,
    [newHash, userId]
  );
  const updatedUser = updatedRows[0];
  const { rows: tenantRows } = await pool.query('SELECT id, slug FROM barbershops WHERE id = $1', [updatedUser.barbershop_id]);
  const token = createToken({
    ...updatedUser,
    tenant_id: tenantRows[0]?.id || null,
    tenant_slug: tenantRows[0]?.slug || null,
    must_change_password: false,
  });
  return res.json({
    ok: true,
    token,
    requirePasswordChange: false,
    user: {
      id: updatedUser.id,
      fullName: updatedUser.full_name,
      email: updatedUser.email,
      phone: updatedUser.phone,
      role: updatedUser.role,
      tenantSlug: tenantRows[0]?.slug || null,
    },
  });
});

app.post('/api/auth/owner-login', async (req, res) => {
  if (!ownerAuthEnabled) {
    return res.status(503).json({ error: 'Login do dono indisponivel. Configure OWNER_EMAIL e OWNER_PASSWORD.' });
  }

  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
  if (email !== ownerEmail.toLowerCase() || password !== ownerPassword) {
    return res.status(401).json({ error: 'Credenciais de dono inválidas.' });
  }

  const ownerUser = {
    id: 0,
    role: 'DONO_SISTEMA',
    full_name: 'Dono do Sistema',
    email: ownerEmail,
    phone: null,
    tenant_id: null,
    tenant_slug: null,
  };
  const token = createToken(ownerUser);
  return res.json({
    token,
    user: {
      id: 0,
      fullName: 'Dono do Sistema',
      email: ownerEmail,
      phone: null,
      role: 'DONO_SISTEMA',
      tenantSlug: null,
    },
  });
});

app.post('/api/auth/register-client', async (req, res) => {
  let conn;
  try {
    conn = await pool.connect();
    const { fullName, phone, email, password } = req.body;
    const tenantSlug = tenantSlugFromReq(req);

    if (!tenantSlug || !fullName || !password) {
      return res.status(400).json({ error: 'tenantSlug, fullName e password são obrigatórios.' });
    }

    const tenant = await resolveTenantIdBySlug(tenantSlug);
    if (!tenant) return res.status(404).json({ error: 'Barbearia não encontrada.' });

    const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
    const normalizedPhone = phone ? String(phone).replace(/\D/g, '') : null;

    if (!normalizedEmail && !normalizedPhone) {
      return res.status(400).json({ error: 'Informe ao menos email ou telefone.' });
    }

    if (normalizedPhone && normalizedPhone.length < 10) {
      return res.status(400).json({ error: 'Telefone inválido (mínimo de 10 dígitos).' });
    }

    const existingParams = [tenant.id];
    const existingConditions = [];

    if (normalizedPhone) {
      existingParams.push(normalizedPhone);
      existingConditions.push(`phone = $${existingParams.length}`);
    }
    if (normalizedEmail) {
      existingParams.push(normalizedEmail);
      existingConditions.push(`email = $${existingParams.length}`);
    }

    const existing = await pool.query(
      `SELECT 1
       FROM users
       WHERE barbershop_id = $1
         AND (${existingConditions.join(' OR ')})`,
      existingParams
    );
    if (existing.rowCount) {
      return res.status(409).json({ error: 'Já existe conta com esse telefone/email nesta barbearia.' });
    }

    const hash = await bcrypt.hash(password, 10);

    await conn.query('BEGIN');
    const userInsert = await conn.query(
      `INSERT INTO users (full_name, email, phone, role, password_hash, barbershop_id, is_active)
       VALUES ($1, $2, $3, 'CLIENTE', $4, $5, true)
       RETURNING id, full_name, email, phone, role`,
      [fullName, normalizedEmail, normalizedPhone, hash, tenant.id]
    );
    const user = userInsert.rows[0];

    await conn.query(
      `INSERT INTO clients (user_id)
       VALUES ($1)`,
      [user.id]
    );
    await conn.query('COMMIT');

    const token = createToken({
      ...user,
      tenant_id: tenant.id,
      tenant_slug: tenant.slug,
    });

    return res.status(201).json({
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        tenantSlug: tenant.slug,
      },
    });
  } catch (error) {
    if (conn) {
      try { await conn.query('ROLLBACK'); } catch (_e) { /* noop */ }
    }
    console.error('[REGISTER CLIENT] error:', error.message);
    return res.status(500).json({ error: `Falha ao cadastrar cliente: ${error.message}` });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/auth/me', authRequired, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, full_name, email, phone, role FROM users WHERE id = $1 AND barbershop_id = $2',
    [req.user.id, req.user.tenantId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado.' });
  return res.json(rows[0]);
});

app.get('/api/client/overview', authRequired, clientOnly, async (req, res) => {
  const clientId = req.user.id;
  const tenantId = req.user.tenantId;

  const [{ rows: totalsRows }, { rows: nextRows }] = await Promise.all([
    pool.query(
      `SELECT
        COUNT(*)::int AS total_appointments,
        COUNT(*) FILTER (WHERE status = 'CONCLUIDO')::int AS completed_appointments,
        COUNT(*) FILTER (WHERE status = 'CANCELADO')::int AS canceled_appointments
       FROM appointments
       WHERE client_id = $1
         AND barbershop_id = $2`,
      [clientId, tenantId]
    ),
    pool.query(
      `SELECT
        a.id,
        a.scheduled_start,
        a.scheduled_end,
        a.status,
        b.full_name AS barber_name,
        COALESCE(SUM(aps.unit_price), 0)::numeric(10,2) AS total
       FROM appointments a
       JOIN users b ON b.id = a.barber_id
       LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
       WHERE a.client_id = $1
         AND a.barbershop_id = $2
         AND a.status IN ('PENDENTE', 'PAGO')
         AND a.scheduled_start >= NOW()
       GROUP BY a.id, a.scheduled_start, a.scheduled_end, a.status, b.full_name
       ORDER BY a.scheduled_start ASC
       LIMIT 1`,
      [clientId, tenantId]
    ),
  ]);

  return res.json({
    totalAppointments: totalsRows[0]?.total_appointments || 0,
    completedAppointments: totalsRows[0]?.completed_appointments || 0,
    canceledAppointments: totalsRows[0]?.canceled_appointments || 0,
    nextAppointment: nextRows[0] || null,
  });
});

app.get('/api/client/appointments', authRequired, clientOnly, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
  const clientId = req.user.id;
  const tenantId = req.user.tenantId;

  const { rows } = await pool.query(
    `SELECT
      a.id,
      a.status,
      a.scheduled_start,
      a.scheduled_end,
      a.notes,
      b.full_name AS barber_name,
      COALESCE(SUM(aps.unit_price), 0)::numeric(10,2) AS total,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT s.name), NULL) AS services
     FROM appointments a
     JOIN users b ON b.id = a.barber_id
     LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
     LEFT JOIN services s ON s.id = aps.service_id
     WHERE a.client_id = $1
       AND a.barbershop_id = $2
     GROUP BY a.id, a.status, a.scheduled_start, a.scheduled_end, a.notes, b.full_name
     ORDER BY a.scheduled_start DESC
     LIMIT $3`,
    [clientId, tenantId, limit]
  );

  return res.json(rows);
});

app.patch('/api/client/appointments/:id/cancel', authRequired, clientOnly, async (req, res) => {
  const appointmentId = Number(req.params.id);
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return res.status(400).json({ error: 'ID inválido.' });
  }

  const { rows } = await pool.query(
    `UPDATE appointments
     SET status = 'CANCELADO', updated_at = NOW()
     WHERE id = $1
       AND client_id = $2
       AND barbershop_id = $3
       AND status IN ('PENDENTE', 'PAGO')
       AND scheduled_start > NOW() + INTERVAL '1 hour'
     RETURNING id, status`,
    [appointmentId, req.user.id, req.user.tenantId]
  );

  if (!rows.length) {
    return res.status(400).json({ error: 'Não foi possível cancelar. Verifique status e antecedência mínima de 1 hora.' });
  }

  return res.json(rows[0]);
});

app.get('/api/services', async (req, res) => {
  const tenantSlug = tenantSlugFromReq(req);
  const tenant = await resolveTenantIdBySlug(tenantSlug);
  if (!tenant) return res.status(400).json({ error: 'tenantSlug inválido.' });

  const { rows } = await pool.query(
    `SELECT id, name, description, price, estimated_minutes
     FROM services
     WHERE is_active = true AND barbershop_id = $1
     ORDER BY price DESC, name ASC`,
    [tenant.id]
  );
  res.json(rows);
});

app.get('/api/barbers', async (req, res) => {
  const tenantSlug = tenantSlugFromReq(req);
  const city = String(req.query.city || '').trim().toLowerCase();
  const tenant = await resolveTenantIdBySlug(tenantSlug);
  if (!tenant) return res.status(400).json({ error: 'tenantSlug inválido.' });

  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.phone, b.commission_percent, b.specialty, b.photo_url, b.whatsapp, b.instagram, COALESCE(b.city, bs.city) AS city, b.availability_json AS availability
     FROM barbers b
     JOIN users u ON u.id = b.user_id
     JOIN barbershops bs ON bs.id = u.barbershop_id
     WHERE u.is_active = true
       AND u.barbershop_id = $1
       AND ($2 = '' OR LOWER(COALESCE(b.city, bs.city, '')) LIKE '%' || $2 || '%')
     ORDER BY u.full_name ASC`,
    [tenant.id, city]
  );
  res.json(rows);
});

app.get('/api/gallery/:clientId', authRequired, async (req, res) => {
  const clientId = Number(req.params.clientId);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ error: 'clientId inválido.' });
  }

  const tenantId = req.user.tenantId;
  const isClientSelf = req.user.role === 'CLIENTE' && req.user.id === clientId;

  if (!isClientSelf) {
    const allowedForBarber = await pool.query(
      `SELECT 1
       FROM clients c
       JOIN users u ON u.id = c.user_id
       WHERE c.user_id = $1
         AND u.barbershop_id = $2`,
      [clientId, tenantId]
    );

    if (!allowedForBarber.rowCount || req.user.role !== 'BARBEIRO') {
      return res.status(403).json({ error: 'Acesso não autorizado para este cliente.' });
    }
  }

  const { rows } = await pool.query(
    `SELECT id, client_id, appointment_id, image_url, caption, created_at
     FROM visual_history
     WHERE client_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [clientId]
  );

  return res.json(rows);
});

app.get('/api/appointments/available-slots', async (req, res) => {
  const barberId = Number(req.query.barberId);
  const date = req.query.date;
  const durationMinutes = Number(req.query.durationMinutes || 0);
  const tenantSlug = tenantSlugFromReq(req);
  const tenant = await resolveTenantIdBySlug(tenantSlug);

  if (!tenant || !Number.isInteger(barberId) || barberId <= 0 || !date) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios: tenantSlug, barberId e date (YYYY-MM-DD).' });
  }

  const [{ rows: existing }, { rows: barberRows }, { rows: blocks }] = await Promise.all([
    pool.query(
      `SELECT scheduled_start, scheduled_end
       FROM appointments
       WHERE barber_id = $1
         AND barbershop_id = $2
         AND status <> 'CANCELADO'
         AND DATE(scheduled_start) = $3::date`,
      [barberId, tenant.id, date]
    ),
    pool.query(
      `SELECT availability_json
       FROM barbers
       WHERE user_id = $1`,
      [barberId]
    ),
    pool.query(
      `SELECT starts_at, ends_at
       FROM schedule_blocks
       WHERE barbershop_id = $1
         AND (barber_id IS NULL OR barber_id = $2)
         AND DATE(starts_at) <= $3::date
         AND DATE(ends_at) >= $3::date`,
      [tenant.id, barberId, date]
    ),
  ]);

  const availability = normalizeAvailability(barberRows[0]?.availability_json || null);
  const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
  const slotMinutes = availability?.slotMinutes || 30;
  const bookingDurationMinutes = Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : slotMinutes;
  const slots = [];
  let workStart = '09:00';
  let workEnd = '20:00';
  if (availability) {
    if (!availability.days.includes(dayOfWeek)) {
      return res.json({ barberId, date, slots: [] });
    }
    workStart = availability.start;
    workEnd = availability.end;
  }

  const [startHour, startMinute] = workStart.split(':').map(Number);
  const [endHour, endMinute] = workEnd.split(':').map(Number);
  const windowStart = new Date(`${date}T${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}:00`);
  const windowEnd = new Date(`${date}T${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}:00`);
  const now = new Date();

  for (let cursor = new Date(windowStart); cursor < windowEnd; cursor = new Date(cursor.getTime() + slotMinutes * 60 * 1000)) {
    const slotStart = new Date(cursor);
    const slotEnd = new Date(slotStart.getTime() + bookingDurationMinutes * 60 * 1000);
    if (slotEnd > windowEnd) break;
    if (slotStart <= now) continue;
    const overlaps = existing.some((item) => {
      const apptStart = new Date(item.scheduled_start);
      const apptEnd = new Date(item.scheduled_end);
      return slotStart < apptEnd && slotEnd > apptStart;
    }) || blocks.some((item) => {
      const blockStart = new Date(item.starts_at);
      const blockEnd = new Date(item.ends_at);
      return slotStart < blockEnd && slotEnd > blockStart;
    });
    if (!overlaps) slots.push(slotStart.toTimeString().slice(0, 5));
  }

  res.json({ barberId, date, slots });
});

app.post('/api/appointments', authRequired, async (req, res) => {
  const { barberId, services, scheduledStart, notes } = req.body;
  if (!barberId || !Array.isArray(services) || services.length === 0 || !scheduledStart) {
    return res.status(400).json({ error: 'barberId, services[] e scheduledStart são obrigatórios.' });
  }

  const tenantId = req.user.tenantId;
  let clientId = req.user.role === 'CLIENTE' ? req.user.id : Number(req.body.clientId);
  if (!clientId) return res.status(400).json({ error: 'clientId é obrigatório para barbeiro.' });

  const client = await pool.query('SELECT 1 FROM clients c JOIN users u ON u.id = c.user_id WHERE c.user_id = $1 AND u.barbershop_id = $2', [clientId, tenantId]);
  const barber = await pool.query('SELECT 1 FROM barbers b JOIN users u ON u.id = b.user_id WHERE b.user_id = $1 AND u.barbershop_id = $2', [barberId, tenantId]);
  if (!client.rowCount || !barber.rowCount) return res.status(404).json({ error: 'Cliente ou barbeiro não encontrado.' });

  const selectedServices = await pool.query(
    `SELECT id, price, estimated_minutes
     FROM services
     WHERE id = ANY($1::bigint[]) AND is_active = true AND barbershop_id = $2`,
    [services, tenantId]
  );
  if (selectedServices.rowCount !== services.length) return res.status(400).json({ error: 'Um ou mais serviços são inválidos.' });

  const totalMinutes = selectedServices.rows.reduce((sum, s) => sum + s.estimated_minutes, 0);
  const start = new Date(scheduledStart);
  if (Number.isNaN(start.getTime())) return res.status(400).json({ error: 'scheduledStart inválido.' });
  const end = new Date(start.getTime() + totalMinutes * 60 * 1000);

  const conflict = await pool.query(
    `SELECT 1
     FROM appointments
     WHERE barber_id = $1
       AND barbershop_id = $2
       AND status <> 'CANCELADO'
       AND scheduled_start < $4
       AND scheduled_end > $3
     LIMIT 1`,
    [barberId, tenantId, start.toISOString(), end.toISOString()]
  );
  if (conflict.rowCount) {
    return res.status(409).json({ error: 'Conflito de agenda: barbeiro indisponível nesse horário.' });
  }

  const clientConn = await pool.connect();
  try {
    await clientConn.query('BEGIN');
    const appointmentInsert = await clientConn.query(
      `INSERT INTO appointments (client_id, barber_id, barbershop_id, scheduled_start, scheduled_end, status, notes)
       VALUES ($1, $2, $3, $4, $5, 'PENDENTE', $6)
       RETURNING id, client_id, barber_id, scheduled_start, scheduled_end, status`,
      [clientId, barberId, tenantId, start.toISOString(), end.toISOString(), notes || null]
    );
    const appointment = appointmentInsert.rows[0];

    for (const service of selectedServices.rows) {
      await clientConn.query(
        `INSERT INTO appointment_services (appointment_id, service_id, unit_price, duration_minutes)
         VALUES ($1, $2, $3, $4)`,
        [appointment.id, service.id, service.price, service.estimated_minutes]
      );
    }

    await clientConn.query('COMMIT');
    res.status(201).json(appointment);
  } catch (error) {
    await clientConn.query('ROLLBACK');
    if (error.message.includes('Conflito de agenda')) return res.status(409).json({ error: error.message });
    res.status(500).json({ error: 'Falha ao criar agendamento.', detail: error.message });
  } finally {
    clientConn.release();
  }
});

app.get('/api/dashboard/summary', authRequired, barberOnly, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT
        COUNT(DISTINCT a.id) AS total_agendamentos,
        COALESCE(SUM(v.gross_amount), 0)::numeric(10,2) AS faturamento,
        COALESCE(SUM(v.barber_commission), 0)::numeric(10,2) AS comissoes,
        COUNT(DISTINCT CASE WHEN a.status = 'NO_SHOW' THEN a.id END) AS no_show
     FROM appointments a
     LEFT JOIN v_appointment_financial v ON v.appointment_id = a.id
     WHERE a.barbershop_id = $1
       AND DATE_TRUNC('month', a.scheduled_start) = DATE_TRUNC('month', NOW())`,
    [req.user.tenantId]
  );
  res.json(rows[0]);
});

app.get('/api/dashboard/advanced', authRequired, barberOnly, async (req, res) => {
  const tenantId = req.user.tenantId;
  const [{ rows: funnelRows }, { rows: retentionRows }, { rows: ticketRows }, { rows: cohortRows }] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)::int AS leads,
         COUNT(*) FILTER (WHERE status IN ('PENDENTE', 'PAGO', 'CONCLUIDO'))::int AS agendados,
         COUNT(*) FILTER (WHERE status = 'CONCLUIDO')::int AS concluidos,
         COUNT(*) FILTER (WHERE status = 'CANCELADO')::int AS cancelados
       FROM appointments
       WHERE barbershop_id = $1
         AND scheduled_start >= NOW() - INTERVAL '90 days'`,
      [tenantId]
    ),
    pool.query(
      `WITH client_totals AS (
         SELECT client_id, COUNT(*)::int AS total
         FROM appointments
         WHERE barbershop_id = $1
           AND status = 'CONCLUIDO'
         GROUP BY client_id
       )
       SELECT
         COUNT(*)::int AS clientes_ativos,
         COUNT(*) FILTER (WHERE total >= 2)::int AS clientes_recorrentes
       FROM client_totals`,
      [tenantId]
    ),
    pool.query(
      `SELECT
         s.name,
         COUNT(*)::int AS total_usos,
         COALESCE(AVG(aps.unit_price), 0)::numeric(10,2) AS ticket_medio
       FROM appointment_services aps
       JOIN appointments a ON a.id = aps.appointment_id
       JOIN services s ON s.id = aps.service_id
       WHERE a.barbershop_id = $1
         AND a.status = 'CONCLUIDO'
         AND a.scheduled_start >= NOW() - INTERVAL '90 days'
       GROUP BY s.name
       ORDER BY total_usos DESC, ticket_medio DESC
       LIMIT 8`,
      [tenantId]
    ),
    pool.query(
      `WITH first_month AS (
         SELECT
           client_id,
           DATE_TRUNC('month', MIN(scheduled_start)) AS cohort_month
         FROM appointments
         WHERE barbershop_id = $1
         GROUP BY client_id
       ),
       monthly_usage AS (
         SELECT
           a.client_id,
           DATE_TRUNC('month', a.scheduled_start) AS usage_month
         FROM appointments a
         WHERE a.barbershop_id = $1
           AND a.status = 'CONCLUIDO'
         GROUP BY a.client_id, DATE_TRUNC('month', a.scheduled_start)
       )
       SELECT
         TO_CHAR(f.cohort_month, 'YYYY-MM') AS cohort,
         TO_CHAR(m.usage_month, 'YYYY-MM') AS mes_uso,
         COUNT(*)::int AS clientes
       FROM first_month f
       JOIN monthly_usage m ON m.client_id = f.client_id
       GROUP BY f.cohort_month, m.usage_month
       ORDER BY f.cohort_month DESC, m.usage_month ASC
       LIMIT 60`,
      [tenantId]
    ),
  ]);

  const ativos = Number(retentionRows[0]?.clientes_ativos || 0);
  const recorrentes = Number(retentionRows[0]?.clientes_recorrentes || 0);
  const retentionRate = ativos ? Number(((recorrentes / ativos) * 100).toFixed(2)) : 0;

  return res.json({
    funnel: funnelRows[0] || { leads: 0, agendados: 0, concluidos: 0, cancelados: 0 },
    retention: {
      clientes_ativos: ativos,
      clientes_recorrentes: recorrentes,
      taxa_recorrencia: retentionRate,
    },
    ticketByService: ticketRows,
    cohorts: cohortRows,
  });
});

app.get('/api/admin/onboarding', authRequired, barberOnly, async (req, res) => {
  const tenantId = req.user.tenantId;
  const [{ rows: profileRows }, { rows: countsRows }] = await Promise.all([
    pool.query(
      `SELECT setup_step, checklist_json, completed_at
       FROM onboarding_profiles
       WHERE barbershop_id = $1`,
      [tenantId]
    ),
    pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM services WHERE barbershop_id = $1 AND is_active = true) AS services_count,
         (SELECT COUNT(*)::int FROM users WHERE barbershop_id = $1 AND role = 'BARBEIRO' AND is_active = true) AS barbers_count,
         (SELECT COUNT(*)::int FROM products WHERE barbershop_id = $1) AS products_count`,
      [tenantId]
    ),
  ]);

  const profile = profileRows[0] || { setup_step: 'BASICO', checklist_json: {}, completed_at: null };
  const counts = countsRows[0] || { services_count: 0, barbers_count: 0, products_count: 0 };
  return res.json({ profile, counts });
});

app.post('/api/admin/onboarding', authRequired, barberOnly, async (req, res) => {
  const tenantId = req.user.tenantId;
  const setupStep = String(req.body?.setupStep || 'BASICO').toUpperCase();
  const checklist = req.body?.checklist && typeof req.body.checklist === 'object' ? req.body.checklist : {};
  const completed = Boolean(req.body?.completed);
  const { rows } = await pool.query(
    `INSERT INTO onboarding_profiles (barbershop_id, setup_step, checklist_json, completed_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, NOW())
     ON CONFLICT (barbershop_id)
     DO UPDATE SET
       setup_step = EXCLUDED.setup_step,
       checklist_json = EXCLUDED.checklist_json,
       completed_at = EXCLUDED.completed_at,
       updated_at = NOW()
     RETURNING barbershop_id, setup_step, checklist_json, completed_at`,
    [tenantId, setupStep, JSON.stringify(checklist), completed ? new Date().toISOString() : null]
  );
  return res.json(rows[0]);
});

app.post('/api/admin/onboarding/import-services', authRequired, barberOnly, async (req, res) => {
  const tenantId = req.user.tenantId;
  const raw = String(req.body?.raw || '').trim();
  if (!raw) return res.status(400).json({ error: 'Informe o conteúdo para importação.' });

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return res.status(400).json({ error: 'Nenhuma linha válida para importar.' });

  const inserted = [];
  for (const line of lines) {
    const [nameRaw, priceRaw, minutesRaw] = line.split(';').map((part) => String(part || '').trim());
    if (!nameRaw) continue;
    const price = Number(String(priceRaw || '0').replace(',', '.'));
    const minutes = Number(minutesRaw || 30);
    if (!Number.isFinite(price) || !Number.isFinite(minutes) || minutes <= 0) continue;

    const { rows } = await pool.query(
      `INSERT INTO services (barbershop_id, name, price, estimated_minutes, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, name, price, estimated_minutes`,
      [tenantId, nameRaw, price, minutes]
    );
    inserted.push(rows[0]);
  }

  return res.status(201).json({ imported: inserted.length, services: inserted });
});

app.get('/api/admin/calendar', authRequired, barberOnly, async (req, res) => {
  const tenantId = req.user.tenantId;
  const view = String(req.query.view || 'week');
  const start = String(req.query.start || '').trim();
  if (!start) return res.status(400).json({ error: 'start é obrigatório (YYYY-MM-DD).' });

  const startDate = new Date(`${start}T00:00:00`);
  if (Number.isNaN(startDate.getTime())) return res.status(400).json({ error: 'start inválido.' });
  const days = view === 'month' ? 31 : 7;
  const endDate = new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);

  const [{ rows: appointments }, { rows: blocks }, { rows: barbers }] = await Promise.all([
    pool.query(
      `SELECT a.id, a.barber_id, a.client_id, a.status, a.scheduled_start, a.scheduled_end,
              u.full_name AS barber_name, c.full_name AS client_name
       FROM appointments a
       JOIN users u ON u.id = a.barber_id
       JOIN users c ON c.id = a.client_id
       WHERE a.barbershop_id = $1
         AND a.scheduled_start >= $2
         AND a.scheduled_start < $3
       ORDER BY a.scheduled_start ASC`,
      [tenantId, startDate.toISOString(), endDate.toISOString()]
    ),
    pool.query(
      `SELECT id, barber_id, starts_at, ends_at, reason
       FROM schedule_blocks
       WHERE barbershop_id = $1
         AND starts_at < $3
         AND ends_at > $2
       ORDER BY starts_at ASC`,
      [tenantId, startDate.toISOString(), endDate.toISOString()]
    ),
    pool.query(
      `SELECT u.id, u.full_name
       FROM users u
       WHERE u.barbershop_id = $1
         AND u.role = 'BARBEIRO'
         AND u.is_active = true
       ORDER BY u.full_name`,
      [tenantId]
    ),
  ]);

  return res.json({
    view,
    start,
    end: endDate.toISOString().slice(0, 10),
    barbers,
    appointments,
    blocks,
  });
});

app.post('/api/admin/calendar/blocks', authRequired, barberOnly, async (req, res) => {
  const tenantId = req.user.tenantId;
  const barberId = req.body?.barberId ? Number(req.body.barberId) : null;
  const startsAt = new Date(String(req.body?.startsAt || ''));
  const endsAt = new Date(String(req.body?.endsAt || ''));
  const reason = String(req.body?.reason || '').trim() || null;

  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    return res.status(400).json({ error: 'Período inválido para bloqueio.' });
  }

  if (barberId) {
    const check = await pool.query(
      `SELECT 1 FROM users WHERE id = $1 AND barbershop_id = $2 AND role = 'BARBEIRO' AND is_active = true`,
      [barberId, tenantId]
    );
    if (!check.rowCount) return res.status(404).json({ error: 'Barbeiro não encontrado.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO schedule_blocks (barbershop_id, barber_id, starts_at, ends_at, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, barber_id, starts_at, ends_at, reason`,
    [tenantId, barberId, startsAt.toISOString(), endsAt.toISOString(), reason, req.user.id]
  );
  return res.status(201).json(rows[0]);
});

app.delete('/api/admin/calendar/blocks/:id', authRequired, barberOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido.' });
  const { rows } = await pool.query(
    `DELETE FROM schedule_blocks
     WHERE id = $1 AND barbershop_id = $2
     RETURNING id`,
    [id, req.user.tenantId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Bloqueio não encontrado.' });
  return res.json({ ok: true, id });
});

app.get('/api/admin/appointments', authRequired, barberOnly, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT
      a.id,
      a.status,
      a.scheduled_start,
      a.scheduled_end,
      c.full_name AS client_name,
      b.full_name AS barber_name,
      COALESCE(SUM(aps.unit_price), 0)::numeric(10,2) AS total
     FROM appointments a
     JOIN users c ON c.id = a.client_id
     JOIN users b ON b.id = a.barber_id
     LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
     WHERE a.barbershop_id = $1
     GROUP BY a.id, a.status, a.scheduled_start, a.scheduled_end, c.full_name, b.full_name
     ORDER BY a.scheduled_start DESC
     LIMIT 100`,
    [req.user.tenantId]
  );
  res.json(rows);
});

app.post('/api/admin/services', authRequired, barberOnly, async (req, res) => {
  const { name, description, price, estimatedMinutes } = req.body;
  if (!name || price == null || !estimatedMinutes) {
    return res.status(400).json({ error: 'name, price e estimatedMinutes são obrigatórios.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO services (barbershop_id, name, description, price, estimated_minutes, is_active)
     VALUES ($1, $2, $3, $4, $5, true)
     RETURNING id, name, description, price, estimated_minutes`,
    [req.user.tenantId, name, description || null, price, estimatedMinutes]
  );
  res.status(201).json(rows[0]);
});

app.patch('/api/admin/services/:id', authRequired, barberOnly, async (req, res) => {
  const id = Number(req.params.id);
  const { name, description, price, estimatedMinutes, isActive } = req.body;
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido.' });

  const { rows } = await pool.query(
    `UPDATE services
     SET name = COALESCE($1, name),
         description = COALESCE($2, description),
         price = COALESCE($3, price),
         estimated_minutes = COALESCE($4, estimated_minutes),
         is_active = COALESCE($5, is_active)
     WHERE id = $6 AND barbershop_id = $7
     RETURNING id, name, description, price, estimated_minutes, is_active`,
    [name ?? null, description ?? null, price ?? null, estimatedMinutes ?? null, isActive ?? null, id, req.user.tenantId]
  );

  if (!rows.length) return res.status(404).json({ error: 'Serviço não encontrado.' });
  res.json(rows[0]);
});

app.delete('/api/admin/services/:id', authRequired, barberOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido.' });

  const { rowCount } = await pool.query(
    `UPDATE services SET is_active = false WHERE id = $1 AND barbershop_id = $2`,
    [id, req.user.tenantId]
  );
  if (!rowCount) return res.status(404).json({ error: 'Serviço não encontrado.' });
  res.json({ ok: true });
});

app.get('/api/admin/barbers', authRequired, barberOnly, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.phone, u.email, b.commission_percent, b.specialty, b.whatsapp, b.instagram, b.city, b.availability_json AS availability
     FROM barbers b
     JOIN users u ON u.id = b.user_id
     WHERE u.barbershop_id = $1 AND u.is_active = true
     ORDER BY u.full_name`,
    [req.user.tenantId]
  );
  res.json(rows);
});

app.post('/api/admin/barbers', authRequired, barberOnly, async (req, res) => {
  const { fullName, phone, email, password, commissionPercent, specialty, whatsapp, instagram, city, availability } = req.body;
  const commission = Number(commissionPercent);
  if (!fullName || !phone || !password || commissionPercent == null) {
    return res.status(400).json({ error: 'fullName, phone, password e commissionPercent são obrigatórios.' });
  }
  if (!Number.isFinite(commission) || commission < 0 || commission > 100) {
    return res.status(400).json({ error: 'commissionPercent deve estar entre 0 e 100.' });
  }

  const normalizedPhone = normalizePhone(phone);
  const normalizedWhatsapp = whatsapp ? normalizePhone(whatsapp) : null;
  const normalizedEmail = email ? normalizeEmail(email) : null;
  const normalizedAvailability = normalizeAvailability(availability);
  if (normalizedPhone.length < 10) return res.status(400).json({ error: 'Telefone inválido (mínimo de 10 dígitos).' });

  const hash = await bcrypt.hash(password, 10);
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const userInsert = await conn.query(
      `INSERT INTO users (full_name, email, phone, role, password_hash, barbershop_id, is_active)
       VALUES ($1, $2, $3, 'BARBEIRO', $4, $5, true)
       RETURNING id, full_name, phone, email`,
      [fullName, normalizedEmail, normalizedPhone, hash, req.user.tenantId]
    );
    const user = userInsert.rows[0];

    await conn.query(
      `INSERT INTO barbers (user_id, commission_percent, specialty, whatsapp, instagram, city, availability_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user.id, commission, specialty || null, normalizedWhatsapp, instagram || null, city || null, normalizedAvailability]
    );

    await rebalanceBarberCommissions(conn, req.user.tenantId, user.id, commission);
    await conn.query('COMMIT');
    res.status(201).json({ ...user, commission_percent: commission, specialty: specialty || null, whatsapp: whatsapp || null, instagram: instagram || null, city: city || null, availability: normalizedAvailability });
  } catch (error) {
    await conn.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    conn.release();
  }
});

app.patch('/api/admin/barbers/:id', authRequired, barberOnly, async (req, res) => {
  const id = Number(req.params.id);
  const { fullName, phone, email, commissionPercent, specialty, isActive, whatsapp, instagram, city, availability } = req.body;
  const normalizedPhone = phone != null ? normalizePhone(phone) : null;
  const normalizedWhatsapp = whatsapp != null ? normalizePhone(whatsapp) : null;
  const normalizedEmail = email != null ? normalizeEmail(email) : null;
  const normalizedAvailability = availability === null ? null : normalizeAvailability(availability);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido.' });
  if (commissionPercent != null) {
    const commission = Number(commissionPercent);
    if (!Number.isFinite(commission) || commission < 0 || commission > 100) {
      return res.status(400).json({ error: 'commissionPercent deve estar entre 0 e 100.' });
    }
  }

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    await conn.query(
      `UPDATE users
       SET full_name = COALESCE($1, full_name),
           phone = COALESCE($2, phone),
           email = COALESCE($3, email),
           is_active = COALESCE($4, is_active)
       WHERE id = $5 AND barbershop_id = $6`,
      [fullName ?? null, normalizedPhone, normalizedEmail, isActive ?? null, id, req.user.tenantId]
    );

    const { rows } = await conn.query(
      `UPDATE barbers
       SET commission_percent = COALESCE($1, commission_percent),
           specialty = COALESCE($2, specialty),
           whatsapp = COALESCE($3, whatsapp),
           instagram = COALESCE($4, instagram),
           city = COALESCE($5, city),
           availability_json = COALESCE($6, availability_json)
       WHERE user_id = $7
       RETURNING commission_percent, specialty, whatsapp, instagram, city, availability_json AS availability`,
      [commissionPercent ?? null, specialty ?? null, normalizedWhatsapp, instagram ?? null, city ?? null, normalizedAvailability, id]
    );

    if (commissionPercent != null) {
      await rebalanceBarberCommissions(conn, req.user.tenantId, id, Number(commissionPercent));
    }

    await conn.query('COMMIT');
    if (!rows.length) return res.status(404).json({ error: 'Barbeiro não encontrado.' });
    res.json({ ok: true, ...rows[0] });
  } catch (error) {
    await conn.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    conn.release();
  }
});

app.delete('/api/admin/barbers/:id', authRequired, barberOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido.' });

  const { rowCount } = await pool.query(
    `UPDATE users SET is_active = false WHERE id = $1 AND barbershop_id = $2 AND role = 'BARBEIRO'`,
    [id, req.user.tenantId]
  );
  if (!rowCount) return res.status(404).json({ error: 'Barbeiro não encontrado.' });
  res.json({ ok: true });
});

app.get('/api/admin/products', authRequired, barberOnly, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, current_qty, min_qty, unit, cost_price,
            CASE WHEN current_qty <= min_qty THEN true ELSE false END AS low_stock
     FROM products
     WHERE barbershop_id = $1
     ORDER BY name`,
    [req.user.tenantId]
  );
  res.json(rows);
});

app.post('/api/admin/products', authRequired, barberOnly, async (req, res) => {
  const { name, currentQty, minQty, unit, costPrice } = req.body;
  if (!name) return res.status(400).json({ error: 'name é obrigatório.' });

  const { rows } = await pool.query(
    `INSERT INTO products (barbershop_id, name, current_qty, min_qty, unit, cost_price)
     VALUES ($1, $2, COALESCE($3,0), COALESCE($4,0), COALESCE($5,'un'), COALESCE($6,0))
     RETURNING id, name, current_qty, min_qty, unit, cost_price`,
    [req.user.tenantId, name, currentQty ?? 0, minQty ?? 0, unit ?? 'un', costPrice ?? 0]
  );
  res.status(201).json(rows[0]);
});

app.patch('/api/admin/products/:id', authRequired, barberOnly, async (req, res) => {
  const id = Number(req.params.id);
  const { name, currentQty, minQty, unit, costPrice } = req.body;
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido.' });

  const { rows } = await pool.query(
    `UPDATE products
     SET name = COALESCE($1, name),
         current_qty = COALESCE($2, current_qty),
         min_qty = COALESCE($3, min_qty),
         unit = COALESCE($4, unit),
         cost_price = COALESCE($5, cost_price)
     WHERE id = $6 AND barbershop_id = $7
     RETURNING id, name, current_qty, min_qty, unit, cost_price`,
    [name ?? null, currentQty ?? null, minQty ?? null, unit ?? null, costPrice ?? null, id, req.user.tenantId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Produto não encontrado.' });
  res.json(rows[0]);
});

app.delete('/api/admin/products/:id', authRequired, barberOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido.' });

  const { rowCount } = await pool.query(
    `DELETE FROM products WHERE id = $1 AND barbershop_id = $2`,
    [id, req.user.tenantId]
  );
  if (!rowCount) return res.status(404).json({ error: 'Produto não encontrado.' });
  res.json({ ok: true });
});

app.patch('/api/admin/appointments/:id/status', authRequired, barberOnly, async (req, res) => {
  const appointmentId = Number(req.params.id);
  const { status } = req.body;
  const valid = ['PENDENTE', 'PAGO', 'NO_SHOW', 'CANCELADO', 'CONCLUIDO'];

  if (!Number.isInteger(appointmentId) || appointmentId <= 0) return res.status(400).json({ error: 'ID inválido.' });
  if (!valid.includes(status)) return res.status(400).json({ error: 'Status inválido.' });

  const { rows } = await pool.query(
    `UPDATE appointments
     SET status = $1, updated_at = NOW()
     WHERE id = $2 AND barbershop_id = $3
     RETURNING id, status`,
    [status, appointmentId, req.user.tenantId]
  );

  if (!rows.length) return res.status(404).json({ error: 'Agendamento não encontrado.' });
  return res.json(rows[0]);
});

app.patch('/api/admin/appointments/:id/reschedule', authRequired, barberOnly, async (req, res) => {
  const appointmentId = Number(req.params.id);
  const nextStartRaw = String(req.body?.scheduledStart || '');
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) return res.status(400).json({ error: 'ID inválido.' });
  const nextStart = new Date(nextStartRaw);
  if (Number.isNaN(nextStart.getTime())) return res.status(400).json({ error: 'scheduledStart inválido.' });

  const tenantId = req.user.tenantId;
  const { rows: currentRows } = await pool.query(
    `SELECT id, barber_id, scheduled_start, scheduled_end, status
     FROM appointments
     WHERE id = $1 AND barbershop_id = $2`,
    [appointmentId, tenantId]
  );
  if (!currentRows.length) return res.status(404).json({ error: 'Agendamento não encontrado.' });
  const current = currentRows[0];
  if (current.status === 'CANCELADO') return res.status(400).json({ error: 'Não é possível remarcar agendamento cancelado.' });

  const durationMs = new Date(current.scheduled_end).getTime() - new Date(current.scheduled_start).getTime();
  const nextEnd = new Date(nextStart.getTime() + Math.max(durationMs, 5 * 60 * 1000));

  const [{ rows: conflicts }, { rows: blocks }] = await Promise.all([
    pool.query(
      `SELECT 1
       FROM appointments
       WHERE barber_id = $1
         AND barbershop_id = $2
         AND id <> $3
         AND status <> 'CANCELADO'
         AND scheduled_start < $5
         AND scheduled_end > $4
       LIMIT 1`,
      [current.barber_id, tenantId, appointmentId, nextStart.toISOString(), nextEnd.toISOString()]
    ),
    pool.query(
      `SELECT 1
       FROM schedule_blocks
       WHERE barbershop_id = $1
         AND (barber_id IS NULL OR barber_id = $2)
         AND starts_at < $4
         AND ends_at > $3
       LIMIT 1`,
      [tenantId, current.barber_id, nextStart.toISOString(), nextEnd.toISOString()]
    ),
  ]);

  if (conflicts.length || blocks.length) {
    return res.status(409).json({ error: 'Conflito na agenda para o novo horário.' });
  }

  const { rows } = await pool.query(
    `UPDATE appointments
     SET scheduled_start = $1,
         scheduled_end = $2,
         updated_at = NOW()
     WHERE id = $3
       AND barbershop_id = $4
     RETURNING id, scheduled_start, scheduled_end`,
    [nextStart.toISOString(), nextEnd.toISOString(), appointmentId, tenantId]
  );
  return res.json(rows[0]);
});

app.patch('/api/admin/appointments/:id/resize', authRequired, barberOnly, async (req, res) => {
  const appointmentId = Number(req.params.id);
  const durationMinutes = Number(req.body?.durationMinutes);
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) return res.status(400).json({ error: 'ID inválido.' });
  if (!Number.isFinite(durationMinutes) || durationMinutes < 15 || durationMinutes > 360) {
    return res.status(400).json({ error: 'durationMinutes deve estar entre 15 e 360.' });
  }

  const tenantId = req.user.tenantId;
  const { rows: currentRows } = await pool.query(
    `SELECT id, barber_id, scheduled_start, scheduled_end, status
     FROM appointments
     WHERE id = $1 AND barbershop_id = $2`,
    [appointmentId, tenantId]
  );
  if (!currentRows.length) return res.status(404).json({ error: 'Agendamento não encontrado.' });
  const current = currentRows[0];
  if (current.status === 'CANCELADO') return res.status(400).json({ error: 'Não é possível redimensionar agendamento cancelado.' });

  const start = new Date(current.scheduled_start);
  const nextEnd = new Date(start.getTime() + durationMinutes * 60 * 1000);

  const [{ rows: conflicts }, { rows: blocks }] = await Promise.all([
    pool.query(
      `SELECT 1
       FROM appointments
       WHERE barber_id = $1
         AND barbershop_id = $2
         AND id <> $3
         AND status <> 'CANCELADO'
         AND scheduled_start < $5
         AND scheduled_end > $4
       LIMIT 1`,
      [current.barber_id, tenantId, appointmentId, start.toISOString(), nextEnd.toISOString()]
    ),
    pool.query(
      `SELECT 1
       FROM schedule_blocks
       WHERE barbershop_id = $1
         AND (barber_id IS NULL OR barber_id = $2)
         AND starts_at < $4
         AND ends_at > $3
       LIMIT 1`,
      [tenantId, current.barber_id, start.toISOString(), nextEnd.toISOString()]
    ),
  ]);

  if (conflicts.length || blocks.length) {
    return res.status(409).json({ error: 'Conflito na agenda para a nova duração.' });
  }

  const { rows } = await pool.query(
    `UPDATE appointments
     SET scheduled_end = $1,
         updated_at = NOW()
     WHERE id = $2
       AND barbershop_id = $3
     RETURNING id, scheduled_start, scheduled_end`,
    [nextEnd.toISOString(), appointmentId, tenantId]
  );
  return res.json(rows[0]);
});

app.post('/api/admin/clients/:clientId/reminder-check', authRequired, barberOnly, async (req, res) => {
  const clientId = Number(req.params.clientId);
  const thresholdDaysBefore = Number(req.body?.thresholdDaysBefore ?? 2);
  const provider = req.body?.provider || 'evolution';

  if (!Number.isInteger(clientId) || clientId <= 0) return res.status(400).json({ error: 'clientId invalido.' });
  if (!Number.isInteger(thresholdDaysBefore) || thresholdDaysBefore < 0 || thresholdDaysBefore > 10) return res.status(400).json({ error: 'thresholdDaysBefore invalido (0-10).' });
  if (!['evolution', 'twilio'].includes(provider)) return res.status(400).json({ error: 'provider invalido. Use evolution ou twilio.' });

  try {
    const result = await analyzeClientRecurrenceAndNotify({ clientId, thresholdDaysBefore, provider });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/api/admin/reminders/sweep', authRequired, barberOnly, async (req, res) => {
  const thresholdDaysBefore = Number(req.body?.thresholdDaysBefore ?? reminderThreshold);
  const provider = req.body?.provider || reminderProvider;
  if (!Number.isInteger(thresholdDaysBefore) || thresholdDaysBefore < 0 || thresholdDaysBefore > 10) return res.status(400).json({ error: 'thresholdDaysBefore invalido (0-10).' });
  if (!['evolution', 'twilio'].includes(provider)) return res.status(400).json({ error: 'provider invalido. Use evolution ou twilio.' });

  const result = await runDailyReminderSweep({ thresholdDaysBefore, provider });
  return res.json(result);
});

app.get('/api/owner/overview', authRequired, ownerOnly, async (_req, res) => {
  const [{ rows: shops }, { rows: barbers }, { rows: trials }] = await Promise.all([
    pool.query(
      `SELECT
        COUNT(*)::int AS total_barbershops,
        COUNT(*) FILTER (WHERE is_active = true)::int AS active_barbershops
       FROM barbershops`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total_barbers
       FROM users
       WHERE role = 'BARBEIRO' AND is_active = true`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS trial_barbershops
       FROM platform_trials
       WHERE is_active = true
         AND trial_ends_at >= NOW()`
    ),
  ]);

  return res.json({
    totalBarbershops: shops[0]?.total_barbershops || 0,
    activeBarbershops: shops[0]?.active_barbershops || 0,
    totalBarbers: barbers[0]?.total_barbers || 0,
    trialBarbershops: trials[0]?.trial_barbershops || 0,
  });
});

app.get('/api/owner/barbershops', authRequired, ownerOnly, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT
      b.id,
      b.name,
      b.city,
      b.slug,
      b.is_active,
      s.plan_name,
      s.monthly_price,
      s.status AS subscription_status,
      t.trial_starts_at,
      t.trial_ends_at,
      t.is_active AS trial_active,
      t.notes AS trial_notes,
      ou.id AS owner_user_id,
      ou.full_name AS owner_full_name,
      ou.email AS owner_email,
      ou.phone AS owner_phone,
      ou.must_change_password AS owner_must_change_password,
      ob.commission_percent AS owner_commission_percent
     FROM barbershops b
     LEFT JOIN platform_subscriptions s ON s.barbershop_id = b.id
     LEFT JOIN platform_trials t ON t.barbershop_id = b.id
     LEFT JOIN LATERAL (
       SELECT u.id, u.full_name, u.email, u.phone, u.must_change_password
       FROM users u
       WHERE u.barbershop_id = b.id
         AND u.role = 'BARBEIRO'
         AND u.is_active = true
       ORDER BY u.id ASC
       LIMIT 1
     ) ou ON true
     LEFT JOIN barbers ob ON ob.user_id = ou.id
     ORDER BY b.id DESC`
  );
  return res.json(rows);
});

app.post('/api/owner/barbershops', authRequired, ownerOnly, async (req, res) => {
  const { name, slug, city, ownerFullName, ownerPhone, ownerEmail, ownerPassword, commissionPercent } = req.body;
  if (!name || !slug || !ownerFullName || !ownerPhone || !ownerPassword) {
    return res.status(400).json({ error: 'name, slug, ownerFullName, ownerPhone e ownerPassword são obrigatórios.' });
  }

  const normalizedSlug = String(slug).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!normalizedSlug) return res.status(400).json({ error: 'Slug inválido.' });

  const commission = Number(commissionPercent ?? 100);
  if (!Number.isFinite(commission) || commission < 0 || commission > 100) {
    return res.status(400).json({ error: 'commissionPercent deve estar entre 0 e 100.' });
  }

  const normalizedOwnerPhone = normalizePhone(ownerPhone);
  const normalizedOwnerEmail = ownerEmail ? normalizeEmail(ownerEmail) : null;
  const normalizedCity = city ? String(city).trim() : null;
  if (normalizedOwnerPhone.length < 10) {
    return res.status(400).json({ error: 'ownerPhone inválido (mínimo de 10 dígitos).' });
  }

  const hash = await bcrypt.hash(String(ownerPassword), 10);
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const shopInsert = await conn.query(
      `INSERT INTO barbershops (name, slug, city, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING id, name, slug, city, is_active`,
      [String(name).trim(), normalizedSlug, normalizedCity]
    );
    const shop = shopInsert.rows[0];

    const userInsert = await conn.query(
      `INSERT INTO users (full_name, email, phone, role, password_hash, barbershop_id, is_active, must_change_password)
       VALUES ($1, $2, $3, 'BARBEIRO', $4, $5, true, true)
       RETURNING id`,
      [String(ownerFullName).trim(), normalizedOwnerEmail, normalizedOwnerPhone, hash, shop.id]
    );

    await conn.query(
      `INSERT INTO barbers (user_id, commission_percent, specialty, city)
       VALUES ($1, $2, $3, $4)`,
      [userInsert.rows[0].id, commission, 'Responsável', normalizedCity]
    );

    await conn.query(
      `INSERT INTO platform_subscriptions (barbershop_id, plan_name, monthly_price, status, notes)
       VALUES ($1, 'TRIAL', 0, 'TRIAL', 'Criada pelo dono do sistema')
       ON CONFLICT (barbershop_id) DO NOTHING`,
      [shop.id]
    );

    await conn.query('COMMIT');
    return res.status(201).json(shop);
  } catch (error) {
    await conn.query('ROLLBACK');
    return res.status(400).json({ error: error.message });
  } finally {
    conn.release();
  }
});

app.patch('/api/owner/barbershops/:id', authRequired, ownerOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido.' });

  const {
    name,
    slug,
    city,
    isActive,
    ownerFullName,
    ownerPhone,
    ownerEmail,
    ownerPassword,
    ownerCommissionPercent,
    planName,
    monthlyPrice,
    status,
    notes,
  } = req.body || {};

  if (status && !['TRIAL', 'ATIVA', 'BLOQUEADA', 'CANCELADA'].includes(status)) {
    return res.status(400).json({ error: 'status inválido.' });
  }
  const commission = ownerCommissionPercent == null ? null : Number(ownerCommissionPercent);
  if (commission != null && (!Number.isFinite(commission) || commission < 0 || commission > 100)) {
    return res.status(400).json({ error: 'ownerCommissionPercent deve estar entre 0 e 100.' });
  }
  const price = monthlyPrice == null ? null : Number(monthlyPrice);
  if (price != null && (!Number.isFinite(price) || price < 0)) {
    return res.status(400).json({ error: 'monthlyPrice inválido.' });
  }

  let normalizedSlug = null;
  if (slug != null && String(slug).trim() !== '') {
    normalizedSlug = String(slug).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!normalizedSlug) return res.status(400).json({ error: 'Slug inválido.' });
  }

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const shopResult = await conn.query(
      `UPDATE barbershops
       SET name = COALESCE($1, name),
           slug = COALESCE($2, slug),
           city = COALESCE($3, city),
           is_active = COALESCE($4, is_active)
       WHERE id = $5
       RETURNING id`,
      [name ? String(name).trim() : null, normalizedSlug, city ? String(city).trim() : null, isActive ?? null, id]
    );
    if (!shopResult.rowCount) throw new Error('Barbearia não encontrada.');

    const { rows: ownerRows } = await conn.query(
      `SELECT u.id
       FROM users u
       WHERE u.barbershop_id = $1
         AND u.role = 'BARBEIRO'
         AND u.is_active = true
       ORDER BY u.id ASC
       LIMIT 1`,
      [id]
    );

    if (ownerRows.length) {
      const ownerId = ownerRows[0].id;
      await conn.query(
        `UPDATE users
         SET full_name = COALESCE($1, full_name),
             phone = COALESCE($2, phone),
             email = COALESCE($3, email)
         WHERE id = $4`,
        [
          ownerFullName ? String(ownerFullName).trim() : null,
          ownerPhone ? normalizePhone(ownerPhone) : null,
          ownerEmail === '' ? null : (ownerEmail ? normalizeEmail(ownerEmail) : null),
          ownerId,
        ]
      );

      if (commission != null) {
        await rebalanceBarberCommissions(conn, id, ownerId, commission);
      }

      if (ownerPassword != null && String(ownerPassword).trim() !== '') {
        const hash = await bcrypt.hash(String(ownerPassword), 10);
        await conn.query(
          `UPDATE users
           SET password_hash = $1,
               must_change_password = true
           WHERE id = $2`,
          [hash, ownerId]
        );
      }
    }

    if (planName != null || price != null || status != null || notes != null) {
      await conn.query(
        `INSERT INTO platform_subscriptions (barbershop_id, plan_name, monthly_price, status, notes, billing_started_at, canceled_at, updated_at)
         VALUES ($1, COALESCE($2, 'TRIAL'), COALESCE($3, 0), COALESCE($4, 'TRIAL'), $5,
                 CASE WHEN $4 = 'ATIVA' THEN NOW() ELSE NULL END,
                 CASE WHEN $4 = 'CANCELADA' THEN NOW() ELSE NULL END,
                 NOW())
         ON CONFLICT (barbershop_id)
         DO UPDATE SET
           plan_name = COALESCE(EXCLUDED.plan_name, platform_subscriptions.plan_name),
           monthly_price = COALESCE(EXCLUDED.monthly_price, platform_subscriptions.monthly_price),
           status = COALESCE(EXCLUDED.status, platform_subscriptions.status),
           notes = COALESCE(EXCLUDED.notes, platform_subscriptions.notes),
           billing_started_at = CASE
             WHEN COALESCE(EXCLUDED.status, platform_subscriptions.status) = 'ATIVA'
               THEN COALESCE(platform_subscriptions.billing_started_at, NOW())
             ELSE platform_subscriptions.billing_started_at
           END,
           canceled_at = CASE
             WHEN COALESCE(EXCLUDED.status, platform_subscriptions.status) = 'CANCELADA' THEN NOW()
             ELSE platform_subscriptions.canceled_at
           END,
           updated_at = NOW()`,
        [id, planName ?? null, price, status ?? null, notes ?? null]
      );
    }

    await conn.query('COMMIT');
    return res.json({ ok: true });
  } catch (error) {
    await conn.query('ROLLBACK');
    return res.status(400).json({ error: error.message });
  } finally {
    conn.release();
  }
});

app.patch('/api/owner/barbershops/:id/subscription', authRequired, ownerOnly, async (req, res) => {
  const id = Number(req.params.id);
  const { planName, monthlyPrice, status, notes, isActive } = req.body;
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido.' });
  if (status && !['TRIAL', 'ATIVA', 'BLOQUEADA', 'CANCELADA'].includes(status)) {
    return res.status(400).json({ error: 'status inválido.' });
  }

  const price = monthlyPrice == null ? null : Number(monthlyPrice);
  if (price != null && (!Number.isFinite(price) || price < 0)) {
    return res.status(400).json({ error: 'monthlyPrice inválido.' });
  }

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    await conn.query(
      `UPDATE barbershops
       SET is_active = COALESCE($1, is_active)
       WHERE id = $2`,
      [isActive ?? null, id]
    );

    const { rows } = await conn.query(
      `INSERT INTO platform_subscriptions (barbershop_id, plan_name, monthly_price, status, notes, billing_started_at, canceled_at, updated_at)
       VALUES ($1, COALESCE($2, 'TRIAL'), COALESCE($3, 0), COALESCE($4, 'TRIAL'), $5,
               CASE WHEN $4 = 'ATIVA' THEN NOW() ELSE NULL END,
               CASE WHEN $4 = 'CANCELADA' THEN NOW() ELSE NULL END,
               NOW())
       ON CONFLICT (barbershop_id)
       DO UPDATE SET
         plan_name = COALESCE(EXCLUDED.plan_name, platform_subscriptions.plan_name),
         monthly_price = COALESCE(EXCLUDED.monthly_price, platform_subscriptions.monthly_price),
         status = COALESCE(EXCLUDED.status, platform_subscriptions.status),
         notes = COALESCE(EXCLUDED.notes, platform_subscriptions.notes),
         billing_started_at = CASE
           WHEN COALESCE(EXCLUDED.status, platform_subscriptions.status) = 'ATIVA'
             THEN COALESCE(platform_subscriptions.billing_started_at, NOW())
           ELSE platform_subscriptions.billing_started_at
         END,
         canceled_at = CASE
           WHEN COALESCE(EXCLUDED.status, platform_subscriptions.status) = 'CANCELADA' THEN NOW()
           ELSE platform_subscriptions.canceled_at
         END,
         updated_at = NOW()
       RETURNING barbershop_id, plan_name, monthly_price, status`,
      [id, planName ?? null, price, status ?? null, notes ?? null]
    );

    await conn.query('COMMIT');
    return res.json({ ok: true, ...rows[0] });
  } catch (error) {
    await conn.query('ROLLBACK');
    return res.status(400).json({ error: error.message });
  } finally {
    conn.release();
  }
});

app.post('/api/owner/barbershops/:id/block', authRequired, ownerOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido.' });

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const shopUpdate = await conn.query(
      `UPDATE barbershops
       SET is_active = false
       WHERE id = $1
       RETURNING id, slug`,
      [id]
    );
    if (!shopUpdate.rowCount) throw new Error('Barbearia não encontrada.');

    await conn.query(
      `INSERT INTO platform_subscriptions (barbershop_id, plan_name, monthly_price, status, notes, updated_at)
       VALUES ($1, 'TRIAL', 0, 'BLOQUEADA', 'Bloqueada por inadimplência', NOW())
       ON CONFLICT (barbershop_id)
       DO UPDATE SET
         status = 'BLOQUEADA',
         notes = 'Bloqueada por inadimplência',
         updated_at = NOW()`,
      [id]
    );

    await conn.query('COMMIT');
    return res.json({ ok: true, id });
  } catch (error) {
    await conn.query('ROLLBACK');
    return res.status(400).json({ error: error.message });
  } finally {
    conn.release();
  }
});

app.delete('/api/owner/barbershops/:id', authRequired, ownerOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido.' });

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const shopUpdate = await conn.query(
      `UPDATE barbershops
       SET is_active = false
       WHERE id = $1
       RETURNING id`,
      [id]
    );
    if (!shopUpdate.rowCount) throw new Error('Barbearia não encontrada.');

    await conn.query(
      `UPDATE users
       SET is_active = false
       WHERE barbershop_id = $1`,
      [id]
    );

    await conn.query(
      `INSERT INTO platform_subscriptions (barbershop_id, plan_name, monthly_price, status, notes, updated_at)
       VALUES ($1, 'TRIAL', 0, 'CANCELADA', 'Barbearia excluída pelo dono do sistema', NOW())
       ON CONFLICT (barbershop_id)
       DO UPDATE SET
         status = 'CANCELADA',
         notes = 'Barbearia excluída pelo dono do sistema',
         canceled_at = NOW(),
         updated_at = NOW()`,
      [id]
    );

    await conn.query('COMMIT');
    return res.json({ ok: true, id });
  } catch (error) {
    await conn.query('ROLLBACK');
    return res.status(400).json({ error: error.message });
  } finally {
    conn.release();
  }
});

app.get('/api/owner/finance', authRequired, ownerOnly, async (_req, res) => {
  const [{ rows: mrrRows }, { rows: trialRows }, { rows: churnRows }] = await Promise.all([
    pool.query(
      `SELECT
        COALESCE(SUM(monthly_price) FILTER (WHERE status = 'ATIVA' AND monthly_price > 0), 0)::numeric(10,2) AS mrr,
        COUNT(*) FILTER (WHERE status = 'ATIVA')::int AS paid_shops
       FROM platform_subscriptions`
    ),
    pool.query(
      `SELECT
        COUNT(*)::int AS total_trials,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM platform_subscriptions s
            WHERE s.barbershop_id = t.barbershop_id
              AND s.status = 'ATIVA'
              AND s.monthly_price > 0
          )
        )::int AS converted_trials
       FROM platform_trials t`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS churned
       FROM platform_subscriptions
       WHERE status = 'CANCELADA'`
    ),
  ]);

  const mrr = Number(mrrRows[0]?.mrr || 0);
  const totalTrials = Number(trialRows[0]?.total_trials || 0);
  const convertedTrials = Number(trialRows[0]?.converted_trials || 0);
  const conversionRate = totalTrials > 0 ? Number(((convertedTrials / totalTrials) * 100).toFixed(2)) : 0;

  return res.json({
    mrr,
    paidShops: Number(mrrRows[0]?.paid_shops || 0),
    totalTrials,
    convertedTrials,
    conversionRate,
    churned: Number(churnRows[0]?.churned || 0),
  });
});

app.post('/api/owner/trials/grant', authRequired, ownerOnly, async (req, res) => {
  const slug = String(req.body?.barbershopSlug || '').trim();
  const days = Number(req.body?.days);
  const notes = String(req.body?.notes || '').trim() || null;
  if (!slug) return res.status(400).json({ error: 'barbershopSlug é obrigatório.' });
  if (!Number.isInteger(days) || days < 1 || days > 90) return res.status(400).json({ error: 'days deve ser um inteiro entre 1 e 90.' });

  const { rows: shopRows } = await pool.query('SELECT id, slug FROM barbershops WHERE slug = $1', [slug]);
  if (!shopRows.length) return res.status(404).json({ error: 'Barbearia não encontrada para esse slug.' });
  const shop = shopRows[0];

  const { rows } = await pool.query(
    `INSERT INTO platform_trials (barbershop_id, granted_by, notes, trial_starts_at, trial_ends_at, is_active, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW() + ($4::text || ' days')::interval, true, NOW())
     ON CONFLICT (barbershop_id)
     DO UPDATE SET
       granted_by = EXCLUDED.granted_by,
       notes = EXCLUDED.notes,
       trial_starts_at = NOW(),
       trial_ends_at = NOW() + ($4::text || ' days')::interval,
       is_active = true,
       updated_at = NOW()
     RETURNING barbershop_id, trial_starts_at, trial_ends_at, is_active`,
    [shop.id, req.user.fullName || 'Dono do Sistema', notes, days]
  );

  return res.status(201).json({
    ok: true,
    slug: shop.slug,
    ...rows[0],
  });
});

app.use('/api', (_req, res) => {
  return res.status(404).json({ error: 'Endpoint de API não encontrado.' });
});

app.use('/cliente', express.static(path.join(__dirname, '..', 'frontend', 'cliente')));
app.use('/barbearia', express.static(path.join(__dirname, '..', 'frontend', 'barbearia')));
app.use('/t/:tenantSlug/cliente', express.static(path.join(__dirname, '..', 'frontend', 'cliente')));
app.use('/t/:tenantSlug/barbearia', express.static(path.join(__dirname, '..', 'frontend', 'barbearia')));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/cliente', (_req, res) => res.redirect('/t/navalha-demo/cliente'));
app.get('/barbearia', (_req, res) => res.redirect('/t/navalha-demo/barbearia'));
app.get('/t/:tenantSlug/cliente', (_req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'cliente', 'index.html')));
app.get('/t/:tenantSlug/barbearia', (_req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'barbearia', 'index.html')));
app.get('/barbearia/:screen', (_req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'barbearia', 'index.html')));
app.get('/t/:tenantSlug/barbearia/:screen', (_req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'barbearia', 'index.html')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));
app.use((_req, res) => res.redirect('/'));

ensureOwnerTables()
  .then(() => console.log('[OWNER] platform_trials table ready'))
  .catch((error) => console.error('[OWNER] table init error:', error.message));

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
  if (!ownerAuthEnabled) {
    console.warn('[OWNER AUTH] disabled: configure OWNER_EMAIL and OWNER_PASSWORD to enable /api/auth/owner-login');
  }

  if (enableReminderCron) {
    cron.schedule(
      reminderCron,
      async () => {
        try {
          const result = await runDailyReminderSweep({
            thresholdDaysBefore: reminderThreshold,
            provider: reminderProvider,
          });
          console.log(`[REMINDER CRON] executedAt=${result.executedAt} total=${result.totalClients} notified=${result.notifiedCount}`);
        } catch (error) {
          console.error('[REMINDER CRON] error:', error.message);
        }
      },
      { timezone: reminderTimezone }
    );

    console.log(`[REMINDER CRON] enabled schedule='${reminderCron}' timezone='${reminderTimezone}' provider='${reminderProvider}' threshold=${reminderThreshold}`);
  } else {
    console.log('[REMINDER CRON] disabled by REMINDER_CRON_ENABLED=false');
  }
});
