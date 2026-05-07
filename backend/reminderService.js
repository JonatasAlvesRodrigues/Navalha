const pool = require('./db');

function toDateOnly(dateInput) {
  const date = new Date(dateInput);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function diffDays(a, b) {
  const oneDayMs = 24 * 60 * 60 * 1000;
  return Math.round((b.getTime() - a.getTime()) / oneDayMs);
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

async function simulateWhatsAppSend({ provider = 'evolution', to, message }) {
  const payload = { provider, to, message, sentAt: new Date().toISOString() };

  if (provider === 'twilio') {
    // Simulacao de integração Twilio
    console.log('[SIMULATED TWILIO] Sending WhatsApp:', payload);
    return { ok: true, provider: 'twilio', externalId: `twilio_${Date.now()}`, payload };
  }

  // Simulacao de integração Evolution API
  console.log('[SIMULATED EVOLUTION] Sending WhatsApp:', payload);
  return { ok: true, provider: 'evolution', externalId: `evolution_${Date.now()}`, payload };
}

async function analyzeClientRecurrenceAndNotify({
  clientId,
  thresholdDaysBefore = 2,
  provider = 'evolution',
}) {
  const clientQuery = await pool.query(
    `SELECT u.id, u.full_name, u.phone
     FROM clients c
     JOIN users u ON u.id = c.user_id
     WHERE c.user_id = $1`,
    [clientId]
  );

  if (!clientQuery.rowCount) {
    throw new Error('Cliente nao encontrado.');
  }

  const client = clientQuery.rows[0];

  const appointmentsQuery = await pool.query(
    `SELECT scheduled_start
     FROM appointments
     WHERE client_id = $1
       AND status IN ('PAGO', 'CONCLUIDO')
     ORDER BY scheduled_start ASC`,
    [clientId]
  );

  if (appointmentsQuery.rowCount < 2) {
    return {
      notified: false,
      reason: 'Historico insuficiente para calcular recorrencia (minimo 2 cortes concluidos/pagos).',
      client,
    };
  }

  const dates = appointmentsQuery.rows.map((r) => toDateOnly(r.scheduled_start));
  const intervals = [];
  for (let i = 1; i < dates.length; i += 1) {
    intervals.push(diffDays(dates[i - 1], dates[i]));
  }

  const avgDays = Math.round(average(intervals));
  const lastCutDate = dates[dates.length - 1];
  const today = toDateOnly(new Date());
  const daysSinceLastCut = diffDays(lastCutDate, today);
  const shouldNotify = daysSinceLastCut >= avgDays - thresholdDaysBefore;

  if (!shouldNotify) {
    return {
      notified: false,
      reason: 'Ainda nao atingiu a janela de notificacao.',
      metrics: { avgDays, daysSinceLastCut, thresholdDaysBefore },
      client,
    };
  }

  const message = `Oi, ${client.full_name}. Faz ${daysSinceLastCut} dias desde seu ultimo corte. Sua media e ${avgDays} dias. Quer agendar seu proximo horario na barbearia?`;

  const sendResult = await simulateWhatsAppSend({
    provider,
    to: client.phone || 'SEM_TELEFONE',
    message,
  });

  return {
    notified: true,
    metrics: { avgDays, daysSinceLastCut, thresholdDaysBefore },
    client,
    message,
    sendResult,
  };
}

async function runDailyReminderSweep({
  thresholdDaysBefore = 2,
  provider = 'evolution',
}) {
  const clientsQuery = await pool.query(
    `SELECT c.user_id AS client_id
     FROM clients c
     JOIN users u ON u.id = c.user_id
     WHERE u.is_active = true`
  );

  const results = [];
  for (const row of clientsQuery.rows) {
    try {
      const result = await analyzeClientRecurrenceAndNotify({
        clientId: row.client_id,
        thresholdDaysBefore,
        provider,
      });
      results.push({ clientId: row.client_id, ...result });
    } catch (error) {
      results.push({ clientId: row.client_id, notified: false, error: error.message });
    }
  }

  const notifiedCount = results.filter((r) => r.notified).length;
  return {
    totalClients: results.length,
    notifiedCount,
    skippedCount: results.length - notifiedCount,
    results,
    executedAt: new Date().toISOString(),
  };
}

module.exports = {
  analyzeClientRecurrenceAndNotify,
  runDailyReminderSweep,
};
