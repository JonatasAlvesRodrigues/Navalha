const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { analyzeClientRecurrenceAndNotify, runDailyReminderSweep } = require('./reminderService');
require('dotenv').config();

const app = express();
const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-me';
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

async function resolveTenantIdBySlug(slug) {
  if (!slug) return null;
  const { rows } = await pool.query('SELECT id, slug FROM barbershops WHERE slug = $1 AND is_active = true', [slug]);
  return rows[0] || null;
}

function tenantSlugFromReq(req) {
  return req.headers['x-tenant-slug'] || req.query.tenantSlug || req.body?.tenantSlug || null;
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
  const identifier = (email || phone || '').trim();
  const tenantSlug = tenantSlugFromReq(req);

  if (!identifier || !password || !tenantSlug) {
    return res.status(400).json({ error: 'tenantSlug, telefone/email e senha são obrigatórios.' });
  }

  const tenant = await resolveTenantIdBySlug(tenantSlug);
  if (!tenant) return res.status(404).json({ error: 'Barbearia não encontrada.' });

  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.password_hash, u.is_active,
            b.id AS tenant_id, b.slug AS tenant_slug
     FROM users u
     JOIN barbershops b ON b.id = u.barbershop_id
     WHERE (u.email = $1 OR u.phone = $1)
       AND u.barbershop_id = $2`,
    [identifier, tenant.id]
  );

  if (!rows.length || !rows[0].is_active) return res.status(401).json({ error: 'Credenciais inválidas.' });

  const user = rows[0];
  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) return res.status(401).json({ error: 'Credenciais inválidas.' });

  const token = createToken(user);
  res.json({
    token,
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

app.get('/api/auth/me', authRequired, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, full_name, email, phone, role FROM users WHERE id = $1 AND barbershop_id = $2',
    [req.user.id, req.user.tenantId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado.' });
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
  const tenant = await resolveTenantIdBySlug(tenantSlug);
  if (!tenant) return res.status(400).json({ error: 'tenantSlug inválido.' });

  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.phone, b.commission_percent, b.specialty, b.photo_url
     FROM barbers b
     JOIN users u ON u.id = b.user_id
     WHERE u.is_active = true AND u.barbershop_id = $1
     ORDER BY u.full_name ASC`,
    [tenant.id]
  );
  res.json(rows);
});

app.get('/api/appointments/available-slots', async (req, res) => {
  const barberId = Number(req.query.barberId);
  const date = req.query.date;
  const tenantSlug = tenantSlugFromReq(req);
  const tenant = await resolveTenantIdBySlug(tenantSlug);

  if (!tenant || !Number.isInteger(barberId) || barberId <= 0 || !date) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios: tenantSlug, barberId e date (YYYY-MM-DD).' });
  }

  const { rows: existing } = await pool.query(
    `SELECT scheduled_start, scheduled_end
     FROM appointments
     WHERE barber_id = $1
       AND barbershop_id = $2
       AND status <> 'CANCELADO'
       AND DATE(scheduled_start) = $3::date`,
    [barberId, tenant.id, date]
  );

  const slotMinutes = 30;
  const startHour = 9;
  const endHour = 20;
  const slots = [];

  for (let hour = startHour; hour < endHour; hour += 1) {
    for (let minute = 0; minute < 60; minute += slotMinutes) {
      const slotStart = new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);
      const slotEnd = new Date(slotStart.getTime() + slotMinutes * 60 * 1000);
      const overlaps = existing.some((item) => {
        const apptStart = new Date(item.scheduled_start);
        const apptEnd = new Date(item.scheduled_end);
        return slotStart < apptEnd && slotEnd > apptStart;
      });
      if (!overlaps) slots.push(slotStart.toTimeString().slice(0, 5));
    }
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
    `SELECT u.id, u.full_name, u.phone, u.email, b.commission_percent, b.specialty
     FROM barbers b
     JOIN users u ON u.id = b.user_id
     WHERE u.barbershop_id = $1 AND u.is_active = true
     ORDER BY u.full_name`,
    [req.user.tenantId]
  );
  res.json(rows);
});

app.post('/api/admin/barbers', authRequired, barberOnly, async (req, res) => {
  const { fullName, phone, email, password, commissionPercent, specialty } = req.body;
  if (!fullName || !phone || !password || commissionPercent == null) {
    return res.status(400).json({ error: 'fullName, phone, password e commissionPercent são obrigatórios.' });
  }

  const hash = await bcrypt.hash(password, 10);
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const userInsert = await conn.query(
      `INSERT INTO users (full_name, email, phone, role, password_hash, barbershop_id, is_active)
       VALUES ($1, $2, $3, 'BARBEIRO', $4, $5, true)
       RETURNING id, full_name, phone, email`,
      [fullName, email || null, phone, hash, req.user.tenantId]
    );
    const user = userInsert.rows[0];

    await conn.query(
      `INSERT INTO barbers (user_id, commission_percent, specialty)
       VALUES ($1, $2, $3)`,
      [user.id, commissionPercent, specialty || null]
    );
    await conn.query('COMMIT');
    res.status(201).json({ ...user, commission_percent: commissionPercent, specialty: specialty || null });
  } catch (error) {
    await conn.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    conn.release();
  }
});

app.patch('/api/admin/barbers/:id', authRequired, barberOnly, async (req, res) => {
  const id = Number(req.params.id);
  const { fullName, phone, email, commissionPercent, specialty, isActive } = req.body;
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido.' });

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
      [fullName ?? null, phone ?? null, email ?? null, isActive ?? null, id, req.user.tenantId]
    );

    const { rows } = await conn.query(
      `UPDATE barbers
       SET commission_percent = COALESCE($1, commission_percent),
           specialty = COALESCE($2, specialty)
       WHERE user_id = $3
       RETURNING commission_percent, specialty`,
      [commissionPercent ?? null, specialty ?? null, id]
    );
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

app.use('/cliente', express.static(path.join(__dirname, '..', 'frontend', 'cliente')));
app.use('/barbearia', express.static(path.join(__dirname, '..', 'frontend', 'barbearia')));
app.use('/t/:tenantSlug/cliente', express.static(path.join(__dirname, '..', 'frontend', 'cliente')));
app.use('/t/:tenantSlug/barbearia', express.static(path.join(__dirname, '..', 'frontend', 'barbearia')));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/cliente', (_req, res) => res.redirect('/t/navalha-demo/cliente'));
app.get('/barbearia', (_req, res) => res.redirect('/t/navalha-demo/barbearia'));
app.get('/t/:tenantSlug/cliente', (_req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'cliente', 'index.html')));
app.get('/t/:tenantSlug/barbearia', (_req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'barbearia', 'index.html')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));
app.use((_req, res) => res.redirect('/'));

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);

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
