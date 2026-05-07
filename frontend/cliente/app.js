const tenantSlug = window.location.pathname.split('/')[2] || 'navalha-demo';

const authCard = document.getElementById('authCard');
const bookingCard = document.getElementById('bookingCard');
const authMsg = document.getElementById('authMsg');
const bookingMsg = document.getElementById('bookingMsg');

const phoneInput = document.getElementById('phone');
const passwordInput = document.getElementById('password');

const barberSelect = document.getElementById('barberId');
const dateInput = document.getElementById('date');
const slotSelect = document.getElementById('slot');
const servicesSelect = document.getElementById('services');

let token = localStorage.getItem(`client_token_${tenantSlug}`) || '';

async function fetchJson(url, options = {}) {
  const headers = options.headers || {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Falha na requisicao');
  return data;
}

function todayLocal() {
  const n = new Date();
  const off = n.getTimezoneOffset();
  return new Date(n.getTime() - off * 60000).toISOString().split('T')[0];
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
    : '<option value="">Sem horarios</option>';
}

function setLoggedInUI(isLogged) {
  authCard.classList.toggle('hidden', isLogged);
  bookingCard.classList.toggle('hidden', !isLogged);
}

document.getElementById('clientLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  authMsg.textContent = 'Entrando...';
  try {
    const data = await fetchJson('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantSlug, phone: phoneInput.value.trim(), password: passwordInput.value }),
    });

    if (data.user.role !== 'CLIENTE') throw new Error('Este acesso e exclusivo para clientes.');

    token = data.token;
    localStorage.setItem(`client_token_${tenantSlug}`, token);
    authMsg.textContent = 'Acesso liberado.';
    setLoggedInUI(true);

    dateInput.value = todayLocal();
    await Promise.all([loadBarbers(), loadServices()]);
    await loadSlots();
  } catch (err) {
    authMsg.textContent = err.message;
  }
});

barberSelect.addEventListener('change', loadSlots);
dateInput.addEventListener('change', loadSlots);

document.getElementById('confirmBtn').addEventListener('click', async () => {
  bookingMsg.textContent = 'Confirmando...';
  try {
    const selectedServices = Array.from(servicesSelect.selectedOptions).map((o) => Number(o.value));
    const date = dateInput.value;
    const slot = slotSelect.value;
    if (!slot) throw new Error('Selecione um horario valido.');

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
    await loadSlots();
  } catch (err) {
    bookingMsg.textContent = err.message;
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  token = '';
  localStorage.removeItem(`client_token_${tenantSlug}`);
  setLoggedInUI(false);
});

(async function init() {
  if (!token) return setLoggedInUI(false);
  try {
    const me = await fetchJson('/api/auth/me');
    if (me.role !== 'CLIENTE') throw new Error('Perfil invalido para esta area.');
    setLoggedInUI(true);
    dateInput.value = todayLocal();
    await Promise.all([loadBarbers(), loadServices()]);
    await loadSlots();
  } catch {
    token = '';
    localStorage.removeItem(`client_token_${tenantSlug}`);
    setLoggedInUI(false);
  }
})();
