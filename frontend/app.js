const servicesGrid = document.getElementById('servicesGrid');
const barbersGrid = document.getElementById('barbersGrid');
const servicesSelect = document.getElementById('services');
const barberSelect = document.getElementById('barberId');
const slotSelect = document.getElementById('slot');
const dateInput = document.getElementById('date');
const feedback = document.getElementById('bookingFeedback');
const authFeedback = document.getElementById('authFeedback');
const adminAppointments = document.getElementById('adminAppointments');

const totalAgendamentos = document.getElementById('totalAgendamentos');
const faturamento = document.getElementById('faturamento');
const comissoes = document.getElementById('comissoes');
const noShow = document.getElementById('noShow');

const galleryClientId = document.getElementById('galleryClientId');
const loadGalleryBtn = document.getElementById('loadGallery');
const galleryGrid = document.getElementById('galleryGrid');
const tenantSlug = window.location.pathname.split('/')[2] || 'navalha-demo';

let session = JSON.parse(localStorage.getItem('session') || 'null');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeImageUrl(value) {
  const fallback = 'https://picsum.photos/500/300?blur=1';
  try {
    const parsed = new URL(String(value || ''), window.location.origin);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
    return fallback;
  } catch (_error) {
    return fallback;
  }
}

function brl(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function fetchJson(url, options = {}) {
  const headers = options.headers || {};
  if (session?.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }

  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Falha na requisição');
  }
  return response.json();
}

async function login(email, password) {
  const data = await fetchJson('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantSlug, email, password }),
  });

  session = data;
  localStorage.setItem('session', JSON.stringify(data));
  authFeedback.textContent = `Conectado como ${data.user.fullName} (${data.user.role}).`;
}

function logout() {
  session = null;
  localStorage.removeItem('session');
  authFeedback.textContent = 'Sessão encerrada.';
  adminAppointments.innerHTML = '<p>Faça login como barbeiro para acessar o painel.</p>';
}

async function loadDashboard() {
  const data = await fetchJson('/api/dashboard/summary');
  totalAgendamentos.textContent = data.total_agendamentos;
  faturamento.textContent = brl(data.faturamento);
  comissoes.textContent = brl(data.comissoes);
  noShow.textContent = data.no_show;
}

async function loadServices() {
  const allServices = await fetchJson(`/api/services?tenantSlug=${tenantSlug}`);
  servicesGrid.innerHTML = allServices.map((s) => `
    <article class="card">
      <h3>${escapeHtml(s.name)}</h3>
      <p class="price">${brl(s.price)}</p>
      <p class="meta">${Number(s.estimated_minutes || 0)} min</p>
      <p>${escapeHtml(s.description || '')}</p>
    </article>
  `).join('');

  servicesSelect.innerHTML = allServices
    .map((s) => `<option value="${Number(s.id)}">${escapeHtml(s.name)} - ${brl(s.price)} (${Number(s.estimated_minutes || 0)} min)</option>`)
    .join('');
}

async function loadBarbers() {
  const barbers = await fetchJson(`/api/barbers?tenantSlug=${tenantSlug}`);

  const normalizePhone = (value) => String(value || '').replace(/\D/g, '');
  const normalizeInstagram = (value) => String(value || '').trim().replace(/^@+/, '');

  barbersGrid.innerHTML = barbers.map((b) => `
    <article class="card">
      <h3>${escapeHtml(b.full_name)}</h3>
      <p class="meta">Comissão fixa: ${Number(b.commission_percent || 0)}%</p>
      <p class="meta">Contato: ${escapeHtml(b.phone || '-')}</p>
      <p class="meta">WhatsApp: ${normalizePhone(b.whatsapp || b.phone) ? `<a href="https://wa.me/55${normalizePhone(b.whatsapp || b.phone)}" target="_blank" rel="noopener noreferrer">Falar no WhatsApp</a>` : '-'}</p>
      <p class="meta">Instagram: ${normalizeInstagram(b.instagram) ? `<a href="https://instagram.com/${encodeURIComponent(normalizeInstagram(b.instagram))}" target="_blank" rel="noopener noreferrer">@${escapeHtml(normalizeInstagram(b.instagram))}</a>` : '-'}</p>
    </article>
  `).join('');

  barberSelect.innerHTML = '<option value="">Selecione...</option>' + barbers
    .map((b) => `<option value="${Number(b.id)}">${escapeHtml(b.full_name)}</option>`)
    .join('');
}

async function loadSlots() {
  const barberId = barberSelect.value;
  const date = dateInput.value;

  if (!barberId || !date) {
    slotSelect.innerHTML = '<option value="">Selecione barbeiro e data</option>';
    return;
  }

  const data = await fetchJson(`/api/appointments/available-slots?tenantSlug=${tenantSlug}&barberId=${barberId}&date=${date}`);
  slotSelect.innerHTML = data.slots.length
    ? data.slots.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')
    : '<option value="">Sem horários</option>';
}

async function loadGallery(clientId) {
  const photos = await fetchJson(`/api/gallery/${clientId}`);
  if (!photos.length) {
    galleryGrid.innerHTML = '<p>Nenhuma foto no histórico visual desse cliente.</p>';
    return;
  }

  galleryGrid.innerHTML = photos.map((photo) => `
    <article class="photo">
      <img src="${safeImageUrl(photo.image_url)}" alt="Corte do cliente" />
      <p>${escapeHtml(photo.caption || 'Sem descrição')}</p>
    </article>
  `).join('');
}

function adminTable(rows) {
  if (!rows.length) {
    return '<p>Sem agendamentos.</p>';
  }

  return `
    <table>
      <thead>
        <tr>
          <th>ID</th><th>Cliente</th><th>Barbeiro</th><th>Início</th><th>Total</th><th>Status</th><th>Ação</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `
          <tr>
            <td>${r.id}</td>
            <td>${escapeHtml(r.client_name)}</td>
            <td>${escapeHtml(r.barber_name)}</td>
            <td>${new Date(r.scheduled_start).toLocaleString('pt-BR')}</td>
            <td>${brl(r.total)}</td>
            <td>${escapeHtml(r.status)}</td>
            <td>
              <select data-id="${Number(r.id)}" class="status-select">
                ${['PENDENTE', 'PAGO', 'NO_SHOW', 'CONCLUIDO', 'CANCELADO'].map((s) => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function loadAdminAppointments() {
  if (!session?.token || session.user.role !== 'BARBEIRO') {
    adminAppointments.innerHTML = '<p>Faça login como barbeiro para acessar o painel.</p>';
    return;
  }

  const rows = await fetchJson('/api/admin/appointments');
  adminAppointments.innerHTML = adminTable(rows);

  document.querySelectorAll('.status-select').forEach((el) => {
    el.addEventListener('change', async (event) => {
      const id = Number(event.target.dataset.id);
      const status = event.target.value;
      try {
        await fetchJson(`/api/admin/appointments/${id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
        await loadDashboard();
      } catch (error) {
        feedback.textContent = error.message;
      }
    });
  });
}

barberSelect.addEventListener('change', loadSlots);
dateInput.addEventListener('change', loadSlots);

document.getElementById('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await login(document.getElementById('loginEmail').value, document.getElementById('loginPassword').value);
    await loadAdminAppointments();
  } catch (error) {
    authFeedback.textContent = error.message;
  }
});

document.getElementById('logoutBtn').addEventListener('click', logout);
document.getElementById('reloadAdmin').addEventListener('click', loadAdminAppointments);

document.getElementById('bookingForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  feedback.textContent = 'Enviando agendamento...';

  try {
    if (!session?.token) {
      throw new Error('Faça login antes de agendar.');
    }

    const selectedServices = Array.from(servicesSelect.selectedOptions).map((o) => Number(o.value));
    const date = dateInput.value;
    const slot = slotSelect.value;
    const start = new Date(`${date}T${slot}:00`);

    const payload = {
      barberId: Number(barberSelect.value),
      services: selectedServices,
      scheduledStart: start.toISOString(),
      notes: document.getElementById('notes').value || null,
    };

    if (session.user.role === 'BARBEIRO') {
      payload.clientId = Number(document.getElementById('clientId').value);
      if (!payload.clientId) {
        throw new Error('Para barbeiro, informe o ID do cliente.');
      }
    }

    await fetchJson('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    feedback.textContent = 'Agendamento criado com sucesso.';
    await loadSlots();
    await loadDashboard();
    await loadAdminAppointments();
  } catch (error) {
    feedback.textContent = error.message;
  }
});

loadGalleryBtn.addEventListener('click', async () => {
  const clientId = Number(galleryClientId.value);
  if (!clientId) {
    galleryGrid.innerHTML = '<p>Informe um ID válido.</p>';
    return;
  }
  try {
    await loadGallery(clientId);
  } catch (error) {
    galleryGrid.textContent = error.message;
  }
});

(async function init() {
  try {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    const localToday = new Date(now.getTime() - offset * 60 * 1000).toISOString().split('T')[0];
    dateInput.value = localToday;

    if (session?.token) {
      authFeedback.textContent = `Sessão ativa: ${session.user.fullName} (${session.user.role}).`;
    }

    await Promise.all([loadDashboard(), loadServices(), loadBarbers()]);
    await loadSlots();
    await loadAdminAppointments();
  } catch (error) {
    feedback.textContent = `Erro ao iniciar app: ${error.message}`;
  }
})();
