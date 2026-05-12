const tenantSlug = window.location.pathname.split('/')[2] || 'navalha-demo';

const authCard = document.getElementById('authCard');
const bookingCard = document.getElementById('bookingCard');
const authMsg = document.getElementById('authMsg');
const bookingMsg = document.getElementById('bookingMsg');
const clientProfile = document.getElementById('clientProfile');
const appointmentsList = document.getElementById('appointmentsList');
const nextAppointment = document.getElementById('nextAppointment');
const kpiTotal = document.getElementById('kpiTotal');
const kpiDone = document.getElementById('kpiDone');
const kpiCanceled = document.getElementById('kpiCanceled');

const loginEmailInput = document.getElementById('loginEmail');
const passwordInput = document.getElementById('password');
const regFullName = document.getElementById('regFullName');
const regEmail = document.getElementById('regEmail');
const regPassword = document.getElementById('regPassword');

const barberSelect = document.getElementById('barberId');
const dateInput = document.getElementById('date');
const slotSelect = document.getElementById('slot');
const servicesSelect = document.getElementById('services');
const mobileQuickNav = document.getElementById('mobileQuickNav');
const mobileQuickBtns = Array.from(document.querySelectorAll('.mobile-quick-btn'));

let token = localStorage.getItem(`client_token_${tenantSlug}`) || '';
let currentClient = null;

async function fetchJson(url, options = {}) {
  const headers = options.headers || {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  const data = (() => {
    try { return JSON.parse(text); } catch (_e) { return {}; }
  })();
  if (!res.ok) {
    const message = data.error || data.detail || (text && text.slice(0, 220)) || `Falha na requisição (${res.status})`;
    throw new Error(message);
  }
  return data;
}

function todayLocal() {
  const n = new Date();
  const off = n.getTimezoneOffset();
  return new Date(n.getTime() - off * 60000).toISOString().split('T')[0];
}

function brl(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dt(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('pt-BR');
}

function statusBadge(status) {
  return `<span class="badge status-${status}">${status}</span>`;
}

async function loadBarbers() {
  const rows = await fetchJson(`/api/barbers?tenantSlug=${tenantSlug}`);
  barberSelect.innerHTML = rows.map((b) => `<option value="${b.id}">${b.full_name}</option>`).join('');
}

async function loadServices() {
  const rows = await fetchJson(`/api/services?tenantSlug=${tenantSlug}`);
  servicesSelect.innerHTML = rows.map((s) => `<option value="${s.id}">${s.name} - R$ ${Number(s.price).toFixed(2)}</option>`).join('');
}

async function loadSlots() {
  const barberId = barberSelect.value;
  const date = dateInput.value;
  if (!barberId || !date) return;
  const data = await fetchJson(`/api/appointments/available-slots?tenantSlug=${tenantSlug}&barberId=${barberId}&date=${date}`);
  slotSelect.innerHTML = data.slots.length
    ? data.slots.map((s) => `<option value="${s}">${s}</option>`).join('')
    : '<option value="">Sem horários</option>';
}

function setLoggedInUI(isLogged) {
  authCard.style.display = isLogged ? 'none' : '';
  bookingCard.style.display = isLogged ? '' : 'none';
  document.body.classList.toggle('client-authenticated', isLogged);
  if (mobileQuickNav) mobileQuickNav.hidden = !isLogged;
}

function setQuickActiveByTarget(targetId) {
  mobileQuickBtns.forEach((btn) => {
    const active = btn.dataset.target === targetId;
    btn.classList.toggle('active', active);
  });
}

function initMobileQuickNav() {
  if (!mobileQuickNav) return;

  mobileQuickBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'install') {
        document.getElementById('installAppBtn')?.click();
        return;
      }

      const targetId = btn.dataset.target;
      if (!targetId) return;
      const el = document.getElementById(targetId);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setQuickActiveByTarget(targetId);
    });
  });

  const trackIds = ['section-new-booking', 'nextAppointment', 'section-history-title'];
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible?.target?.id) return;
      setQuickActiveByTarget(visible.target.id);
    },
    { rootMargin: '-25% 0px -55% 0px', threshold: [0.2, 0.4, 0.6] }
  );

  trackIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  });
}

function renderOverview(overview) {
  kpiTotal.textContent = overview.totalAppointments || 0;
  kpiDone.textContent = overview.completedAppointments || 0;
  kpiCanceled.textContent = overview.canceledAppointments || 0;

  if (!overview.nextAppointment) {
    nextAppointment.innerHTML = '<strong>Próximo agendamento</strong><p class="subtle">Nenhum horário futuro no momento.</p>';
    return;
  }

  const next = overview.nextAppointment;
  nextAppointment.innerHTML = `
    <strong>Próximo agendamento</strong>
    <p class="subtle">${dt(next.scheduled_start)} com ${next.barber_name}</p>
    <p class="subtle">Status: ${next.status} • Total: ${brl(next.total)}</p>
  `;
}

function canCancel(appt) {
  if (!['PENDENTE', 'PAGO'].includes(appt.status)) return false;
  return new Date(appt.scheduled_start).getTime() > (Date.now() + 60 * 60 * 1000);
}

function renderAppointments(rows) {
  if (!rows.length) {
    appointmentsList.innerHTML = '<p class="subtle">Você ainda não possui agendamentos.</p>';
    return;
  }

  appointmentsList.innerHTML = rows.map((appt) => `
    <article class="appointment-item">
      <div class="appointment-top">
        <strong>${dt(appt.scheduled_start)}</strong>
        ${statusBadge(appt.status)}
      </div>
      <div class="appointment-meta">Barbeiro: ${appt.barber_name} • Total: ${brl(appt.total)}</div>
      <div class="services-line">${(appt.services || []).length ? appt.services.join(', ') : 'Sem serviços detalhados'}</div>
      ${canCancel(appt) ? `<button class="ghost cancel-btn" data-id="${appt.id}" type="button">Cancelar</button>` : ''}
    </article>
  `).join('');

  document.querySelectorAll('.cancel-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const appointmentId = Number(btn.dataset.id);
      if (!appointmentId) return;
      btn.disabled = true;
      bookingMsg.textContent = 'Cancelando agendamento...';
      try {
        await fetchJson(`/api/client/appointments/${appointmentId}/cancel`, { method: 'PATCH' });
        bookingMsg.textContent = 'Agendamento cancelado com sucesso.';
        await loadClientArea();
        await loadSlots();
      } catch (err) {
        bookingMsg.textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    });
  });
}

async function loadClientArea() {
  const [me, overview, appointments] = await Promise.all([
    fetchJson('/api/auth/me'),
    fetchJson('/api/client/overview'),
    fetchJson('/api/client/appointments?limit=20'),
  ]);
  currentClient = me;
  clientProfile.textContent = `${me.full_name} • ${me.phone || 'Sem telefone'}${me.email ? ` • ${me.email}` : ''}`;
  renderOverview(overview);
  renderAppointments(appointments);
}

document.getElementById('clientLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  authMsg.textContent = 'Entrando...';
  try {
    const data = await fetchJson('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantSlug, email: loginEmailInput.value.trim(), password: passwordInput.value }),
    });

    if (data.user.role !== 'CLIENTE') throw new Error('Este acesso é exclusivo para clientes.');

    token = data.token;
    localStorage.setItem(`client_token_${tenantSlug}`, token);
    authMsg.textContent = 'Acesso liberado.';
    setLoggedInUI(true);

    dateInput.value = todayLocal();
    await Promise.all([loadBarbers(), loadServices()]);
    await loadSlots();
    await loadClientArea();
  } catch (err) {
    authMsg.textContent = err.message;
  }
});

document.getElementById('clientRegisterForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  authMsg.textContent = 'Criando conta...';
  try {
    const data = await fetchJson('/api/auth/register-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantSlug,
        fullName: regFullName.value.trim(),
        email: regEmail.value.trim().toLowerCase(),
        password: regPassword.value,
      }),
    });

    token = data.token;
    localStorage.setItem(`client_token_${tenantSlug}`, token);
    authMsg.textContent = 'Conta criada com sucesso. Você já está logado.';
    setLoggedInUI(true);

    dateInput.value = todayLocal();
    await Promise.all([loadBarbers(), loadServices()]);
    await loadSlots();
    await loadClientArea();
  } catch (err) {
    authMsg.textContent = err.message;
  }
});

barberSelect.addEventListener('change', loadSlots);
dateInput.addEventListener('change', loadSlots);

document.getElementById('confirmBtn').addEventListener('click', async () => {
  const confirmBtn = document.getElementById('confirmBtn');
  confirmBtn.disabled = true;
  bookingMsg.textContent = 'Confirmando...';
  try {
    const selectedServices = Array.from(servicesSelect.selectedOptions).map((o) => Number(o.value));
    if (!selectedServices.length) throw new Error('Selecione pelo menos um serviço.');

    const date = dateInput.value;
    const slot = slotSelect.value;
    if (!slot) throw new Error('Selecione um horário válido.');

    const scheduledStart = new Date(`${date}T${slot}:00`).toISOString();

    await fetchJson('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        barberId: Number(barberSelect.value),
        services: selectedServices,
        scheduledStart,
        notes: 'Agendamento via area do cliente Navalha',
      }),
    });

    bookingMsg.textContent = 'Agendamento confirmado.';
    await Promise.all([loadSlots(), loadClientArea()]);
  } catch (err) {
    bookingMsg.textContent = err.message;
  } finally {
    confirmBtn.disabled = false;
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  token = '';
  currentClient = null;
  localStorage.removeItem(`client_token_${tenantSlug}`);
  setLoggedInUI(false);
});

(async function init() {
  initMobileQuickNav();
  if (!token) return setLoggedInUI(false);
  try {
    const me = await fetchJson('/api/auth/me');
    if (me.role !== 'CLIENTE') throw new Error('Perfil inválido para esta área.');
    currentClient = me;
    setLoggedInUI(true);
    dateInput.value = todayLocal();
    await Promise.all([loadBarbers(), loadServices()]);
    await loadSlots();
    await loadClientArea();
  } catch {
    token = '';
    currentClient = null;
    localStorage.removeItem(`client_token_${tenantSlug}`);
    setLoggedInUI(false);
  }
})();
