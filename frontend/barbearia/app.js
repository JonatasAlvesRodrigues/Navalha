const tenantSlug = window.location.pathname.split('/')[2] || 'navalha-demo';

const servicesGrid = document.getElementById('servicesGrid');
const barbersGrid = document.getElementById('barbersGrid');
const authFeedback = document.getElementById('authFeedback');
const adminAppointments = document.getElementById('adminAppointments');
const mgmtFeedback = document.getElementById('mgmtFeedback');

const totalAgendamentos = document.getElementById('totalAgendamentos');
const faturamento = document.getElementById('faturamento');
const comissoes = document.getElementById('comissoes');
const noShow = document.getElementById('noShow');

const galleryClientId = document.getElementById('galleryClientId');
const loadGalleryBtn = document.getElementById('loadGallery');
const galleryGrid = document.getElementById('galleryGrid');

const servicesAdminTable = document.getElementById('servicesAdminTable');
const barbersAdminTable = document.getElementById('barbersAdminTable');
const productsAdminTable = document.getElementById('productsAdminTable');
const screenProgress = document.getElementById('screenProgress');
const ownerLoginForm = document.getElementById('ownerLoginForm');
const ownerAuthFeedback = document.getElementById('ownerAuthFeedback');
const ownerBarbershopsTable = document.getElementById('ownerBarbershopsTable');
const ownerTotalBarbershops = document.getElementById('ownerTotalBarbershops');
const ownerActiveBarbershops = document.getElementById('ownerActiveBarbershops');
const ownerTrialBarbershops = document.getElementById('ownerTrialBarbershops');
const ownerTotalBarbers = document.getElementById('ownerTotalBarbers');
const ownerMrr = document.getElementById('ownerMrr');
const ownerPaidShops = document.getElementById('ownerPaidShops');
const ownerConversionRate = document.getElementById('ownerConversionRate');
const ownerChurned = document.getElementById('ownerChurned');
const grantTrialForm = document.getElementById('grantTrialForm');
const trialFeedback = document.getElementById('trialFeedback');
const createBarbershopForm = document.getElementById('createBarbershopForm');
const createBarbershopFeedback = document.getElementById('createBarbershopFeedback');
const updateSubscriptionForm = document.getElementById('updateSubscriptionForm');
const subscriptionFeedback = document.getElementById('subscriptionFeedback');
const editBarbershopForm = document.getElementById('editBarbershopForm');
const editBarbershopFeedback = document.getElementById('editBarbershopFeedback');
const firstAccessPasswordForm = document.getElementById('firstAccessPasswordForm');
const firstAccessFeedback = document.getElementById('firstAccessFeedback');

let session = JSON.parse(localStorage.getItem(`barbearia_session_${tenantSlug}`) || 'null');
let lastRemoved = null;
let ownerRowsCache = [];

const availableScreens = ['inicio', 'dashboard', 'vitrine', 'gestao', 'agendamentos', 'galeria', 'dono'];

function isOwnerSession() {
  return Boolean(session?.token && session?.user?.role === 'DONO_SISTEMA');
}

function updateOwnerUI() {
  document.body.classList.toggle('owner-authenticated', isOwnerSession());
}

function isPasswordChangeRequired() {
  return Boolean(session?.requirePasswordChange);
}

function updateFirstAccessUI() {
  if (!firstAccessPasswordForm) return;
  firstAccessPasswordForm.hidden = !isPasswordChangeRequired();
  if (isPasswordChangeRequired()) {
    authFeedback.textContent = 'Primeiro acesso detectado. Troque a senha para liberar o sistema.';
  }
}

function setActiveScreen(screenName) {
  const target = availableScreens.includes(screenName) ? screenName : 'inicio';
  document.querySelectorAll('.screen').forEach((screen) => {
    screen.classList.toggle('active', screen.id === `screen-${target}`);
  });
  document.querySelectorAll('.screen-link').forEach((link) => {
    link.classList.toggle('active', link.dataset.screen === target);
  });
}

function playScreenProgress() {
  if (!screenProgress) return;
  screenProgress.classList.add('active');
  screenProgress.style.width = '0%';
  requestAnimationFrame(() => {
    screenProgress.style.width = '68%';
  });
  setTimeout(() => {
    screenProgress.style.width = '100%';
  }, 150);
  setTimeout(() => {
    screenProgress.classList.remove('active');
    screenProgress.style.width = '0%';
  }, 420);
}

function initScreenNavigation() {
  const screenFromHash = (window.location.hash || '').replace('#', '');
  setActiveScreen(screenFromHash || 'inicio');

  document.querySelectorAll('.screen-link').forEach((link) => {
    link.addEventListener('click', () => {
      const screen = link.dataset.screen || 'inicio';
      playScreenProgress();
      setActiveScreen(screen);
      window.location.hash = screen;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  window.addEventListener('hashchange', () => {
    const hashScreen = (window.location.hash || '').replace('#', '');
    playScreenProgress();
    setActiveScreen(hashScreen || 'inicio');
  });
}

function brl(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function maskPhone(value) {
  const d = (value || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function unmaskPhone(value) {
  return (value || '').replace(/\D/g, '');
}

function confirmAction(message) {
  return window.confirm(message);
}

async function fetchJson(url, options = {}) {
  const headers = options.headers || {};
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;
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
  localStorage.setItem(`barbearia_session_${tenantSlug}`, JSON.stringify(data));
  authFeedback.textContent = `Conectado como ${data.user.fullName} (${data.user.role}).`;
  updateOwnerUI();
  updateFirstAccessUI();
}

async function ownerLogin(email, password) {
  const data = await fetchJson('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, tenantSlug }),
  });
  session = data;
  localStorage.setItem(`barbearia_session_${tenantSlug}`, JSON.stringify(data));
  ownerAuthFeedback.textContent = `Conectado como ${data.user.fullName}.`;
  authFeedback.textContent = 'Sessão atual migrada para modo Dono do Sistema.';
  updateOwnerUI();
  updateFirstAccessUI();
}

function logout() {
  session = null;
  localStorage.removeItem(`barbearia_session_${tenantSlug}`);
  authFeedback.textContent = 'Sessão encerrada.';
  ownerAuthFeedback.textContent = '';
  trialFeedback.textContent = '';
  if (firstAccessFeedback) firstAccessFeedback.textContent = '';
  updateOwnerUI();
  updateFirstAccessUI();
  setActiveScreen('inicio');
}

function ownerTable(rows) {
  if (!rows.length) return '<p>Nenhuma barbearia cadastrada.</p>';
  return `<table><thead><tr><th>ID</th><th>Nome</th><th>Cidade</th><th>Slug</th><th>Ativa</th><th>Dono</th><th>Plano</th><th>Preço</th><th>Status</th><th>Trial até</th><th>Ação</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r.id}</td><td>${r.name}</td><td>${r.city || '-'}</td><td>${r.slug}</td><td>${r.is_active ? 'SIM' : 'NAO'}</td><td>${r.owner_full_name || '-'}</td><td>${r.plan_name || 'TRIAL'}</td><td>${brl(r.monthly_price || 0)}</td><td>${r.subscription_status || 'TRIAL'}</td><td>${r.trial_ends_at ? new Date(r.trial_ends_at).toLocaleDateString('pt-BR') : '-'}</td><td><button class="ghost" type="button" onclick="prefillBarbershopEdit(${r.id})">Editar</button></td></tr>`).join('')}</tbody></table>`;
}

async function loadOwnerOverview() {
  if (!isOwnerSession()) return;
  const data = await fetchJson('/api/owner/overview');
  ownerTotalBarbershops.textContent = data.totalBarbershops;
  ownerActiveBarbershops.textContent = data.activeBarbershops;
  ownerTrialBarbershops.textContent = data.trialBarbershops;
  ownerTotalBarbers.textContent = data.totalBarbers;
}

async function loadOwnerBarbershops() {
  if (!isOwnerSession()) return;
  const rows = await fetchJson('/api/owner/barbershops');
  ownerRowsCache = rows;
  ownerBarbershopsTable.innerHTML = ownerTable(rows);
}

window.prefillBarbershopEdit = (id) => {
  const row = ownerRowsCache.find((item) => item.id === Number(id));
  if (!row) return;
  document.getElementById('editShopId').value = row.id;
  document.getElementById('editShopName').value = row.name || '';
  document.getElementById('editShopSlug').value = row.slug || '';
  document.getElementById('editShopCity').value = row.city || '';
  document.getElementById('editShopIsActive').value = row.is_active ? 'true' : 'false';
  document.getElementById('editOwnerName').value = row.owner_full_name || '';
  document.getElementById('editOwnerPhone').value = row.owner_phone || '';
  document.getElementById('editOwnerEmail').value = row.owner_email || '';
  document.getElementById('editOwnerPassword').value = '';
  document.getElementById('editOwnerCommission').value = row.owner_commission_percent ?? '';
  document.getElementById('editSubPlanName').value = row.plan_name || '';
  document.getElementById('editSubMonthlyPrice').value = row.monthly_price ?? '';
  document.getElementById('editSubStatus').value = row.subscription_status || '';
  document.getElementById('editSubNotes').value = row.trial_notes || '';
  if (editBarbershopFeedback) editBarbershopFeedback.textContent = `Dados da barbearia ${row.id} carregados para edição.`;
  setActiveScreen('dono');
  window.location.hash = 'dono';
};

async function loadOwnerFinance() {
  if (!isOwnerSession()) return;
  const data = await fetchJson('/api/owner/finance');
  ownerMrr.textContent = brl(data.mrr);
  ownerPaidShops.textContent = data.paidShops;
  ownerConversionRate.textContent = `${data.conversionRate}%`;
  ownerChurned.textContent = data.churned;
}

function showUndo() {
  if (!lastRemoved) return;
  mgmtFeedback.innerHTML = `${lastRemoved.label} removido. <button id="undoBtn" class="ghost" type="button">Desfazer</button>`;
  document.getElementById('undoBtn').onclick = async () => {
    try {
      if (lastRemoved.type === 'service') {
        await fetchJson('/api/admin/services', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lastRemoved.payload),
        });
        await loadServices();
      }
      if (lastRemoved.type === 'barber') {
        await fetchJson('/api/admin/barbers', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lastRemoved.payload),
        });
        await loadBarbers();
      }
      if (lastRemoved.type === 'product') {
        await fetchJson('/api/admin/products', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lastRemoved.payload),
        });
        await loadProducts();
      }
      mgmtFeedback.textContent = 'Item restaurado.';
      lastRemoved = null;
    } catch (e) {
      mgmtFeedback.textContent = `Não foi possível restaurar: ${e.message}`;
    }
  };
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
  servicesGrid.innerHTML = allServices.map((s) => `<article class="card"><h3>${s.name}</h3><p class="price">${brl(s.price)}</p><p class="meta">${s.estimated_minutes} min</p><p>${s.description || ''}</p></article>`).join('');
  if (!session?.token || session.user.role !== 'BARBEIRO') {
    servicesAdminTable.innerHTML = '<p>Faça login como barbeiro para gerenciar serviços.</p>';
    return;
  }
  servicesAdminTable.innerHTML = `<table><thead><tr><th>ID</th><th>Nome</th><th>Preco</th><th>Min</th><th>Ações</th></tr></thead><tbody>${allServices.map((s) => `<tr><td>${s.id}</td><td><input id="svc-name-${s.id}" value="${s.name}" /></td><td><input id="svc-price-${s.id}" type="number" step="0.01" value="${Number(s.price)}" /></td><td><input id="svc-min-${s.id}" type="number" value="${s.estimated_minutes}" /></td><td><button class='ghost' onclick='saveService(${s.id})'>Salvar</button> <button class='ghost' onclick='deleteService(${s.id})'>Remover</button></td></tr>`).join('')}</tbody></table>`;
}

async function loadBarbers() {
  const barbers = await fetchJson(`/api/barbers?tenantSlug=${tenantSlug}`);
  barbersGrid.innerHTML = barbers.map((b) => `<article class="card"><h3>${b.full_name}</h3><p class="meta">Comissão: ${b.commission_percent}%</p><p class="meta">Contato: ${b.phone || '-'}</p></article>`).join('');

  if (!session?.token || session.user.role !== 'BARBEIRO') {
    barbersAdminTable.innerHTML = '<p>Faça login como barbeiro para gerenciar equipe.</p>';
    return;
  }

  const adminBarbers = await fetchJson('/api/admin/barbers');
  barbersAdminTable.innerHTML = `<table><thead><tr><th>Nome</th><th>Telefone</th><th>Comissão %</th><th>Ações</th></tr></thead><tbody>${adminBarbers.map((b) => `<tr><td><input id="barber-name-${b.id}" value="${b.full_name}" /></td><td><input id="barber-phone-${b.id}" value="${maskPhone(b.phone || '')}" /></td><td><input id="barber-comm-${b.id}" type="number" step="0.01" value="${b.commission_percent}" /></td><td><button class='ghost' onclick='saveBarber(${b.id})'>Salvar</button> <button class='ghost' onclick='removeBarber(${b.id})'>Remover</button></td></tr>`).join('')}</tbody></table>`;

  adminBarbers.forEach((b) => {
    const el = document.getElementById(`barber-phone-${b.id}`);
    if (el) el.addEventListener('input', (e) => { e.target.value = maskPhone(e.target.value); });
  });
}

async function loadProducts() {
  if (!session?.token || session.user.role !== 'BARBEIRO') {
    productsAdminTable.innerHTML = '<p>Faça login como barbeiro para gerenciar produtos.</p>';
    return;
  }
  const rows = await fetchJson('/api/admin/products');
  productsAdminTable.innerHTML = `<table><thead><tr><th>Produto</th><th>Atual</th><th>Mín</th><th>Un</th><th>Ações</th></tr></thead><tbody>${rows.map((p) => `<tr class='${p.low_stock ? 'danger-row' : ''}'><td><input id="prod-name-${p.id}" value="${p.name}" /></td><td><input id="prod-qty-${p.id}" type="number" value="${p.current_qty}" /></td><td><input id="prod-min-${p.id}" type="number" value="${p.min_qty}" /></td><td><input id="prod-unit-${p.id}" value="${p.unit}" /></td><td><button class='ghost' onclick='saveProduct(${p.id})'>Salvar</button> <button class='ghost' onclick='removeProduct(${p.id})'>Remover</button></td></tr>`).join('')}</tbody></table>`;
}

async function loadGallery(clientId) {
  const photos = await fetchJson(`/api/gallery/${clientId}`);
  galleryGrid.innerHTML = photos.length ? photos.map((photo) => `<article class="photo"><img src="${photo.image_url}" alt="Corte" /><p>${photo.caption || 'Sem descrição'}</p></article>`).join('') : '<p>Nenhuma foto.</p>';
}

function adminTable(rows) {
  if (!rows.length) return '<p>Sem agendamentos.</p>';
  return `<table><thead><tr><th>ID</th><th>Cliente</th><th>Barbeiro</th><th>Início</th><th>Total</th><th>Status</th><th>Ação</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r.id}</td><td>${r.client_name}</td><td>${r.barber_name}</td><td>${new Date(r.scheduled_start).toLocaleString('pt-BR')}</td><td>${brl(r.total)}</td><td>${r.status}</td><td><select data-id="${r.id}" class="status-select">${['PENDENTE','PAGO','NO_SHOW','CONCLUIDO','CANCELADO'].map((s) => `<option ${s===r.status?'selected':''}>${s}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table>`;
}

async function loadAdminAppointments() {
  if (!session?.token || session.user.role !== 'BARBEIRO') return (adminAppointments.innerHTML = '<p>Faça login como barbeiro.</p>');
  const rows = await fetchJson('/api/admin/appointments');
  adminAppointments.innerHTML = adminTable(rows);
  document.querySelectorAll('.status-select').forEach((el) => {
    el.addEventListener('change', async (event) => {
      const id = Number(event.target.dataset.id);
      const status = event.target.value;
      await fetchJson(`/api/admin/appointments/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      await loadDashboard();
    });
  });
}

window.deleteService = async (id) => {
  if (!confirmAction('Remover este serviço?')) return;
  try {
    lastRemoved = {
      type: 'service',
      label: 'Serviço',
      payload: {
        name: document.getElementById(`svc-name-${id}`).value,
        price: Number(document.getElementById(`svc-price-${id}`).value),
        estimatedMinutes: Number(document.getElementById(`svc-min-${id}`).value),
      },
    };
    await fetchJson(`/api/admin/services/${id}`, { method: 'DELETE' });
    await loadServices();
    showUndo();
  } catch (e) { mgmtFeedback.textContent = e.message; }
};

window.saveService = async (id) => {
  try {
    await fetchJson(`/api/admin/services/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById(`svc-name-${id}`).value,
        price: Number(document.getElementById(`svc-price-${id}`).value),
        estimatedMinutes: Number(document.getElementById(`svc-min-${id}`).value),
      }),
    });
    mgmtFeedback.textContent = 'Serviço atualizado.';
    await loadServices();
  } catch (e) { mgmtFeedback.textContent = e.message; }
};

window.removeBarber = async (id) => {
  if (!confirmAction('Remover este barbeiro?')) return;
  try {
    lastRemoved = {
      type: 'barber',
      label: 'Barbeiro',
      payload: {
        fullName: document.getElementById(`barber-name-${id}`).value,
        phone: unmaskPhone(document.getElementById(`barber-phone-${id}`).value),
        password: 'temp123',
        commissionPercent: Number(document.getElementById(`barber-comm-${id}`).value),
      },
    };
    await fetchJson(`/api/admin/barbers/${id}`, { method: 'DELETE' });
    await loadBarbers();
    showUndo();
  } catch (e) { mgmtFeedback.textContent = e.message; }
};

window.saveBarber = async (id) => {
  try {
    await fetchJson(`/api/admin/barbers/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: document.getElementById(`barber-name-${id}`).value,
        phone: unmaskPhone(document.getElementById(`barber-phone-${id}`).value),
        commissionPercent: Number(document.getElementById(`barber-comm-${id}`).value),
      }),
    });
    mgmtFeedback.textContent = 'Barbeiro atualizado. Comissões rebalanceadas automaticamente para totalizar 100%.';
    await loadBarbers();
  } catch (e) { mgmtFeedback.textContent = e.message; }
};

window.removeProduct = async (id) => {
  if (!confirmAction('Remover este produto?')) return;
  try {
    lastRemoved = {
      type: 'product',
      label: 'Produto',
      payload: {
        name: document.getElementById(`prod-name-${id}`).value,
        currentQty: Number(document.getElementById(`prod-qty-${id}`).value),
        minQty: Number(document.getElementById(`prod-min-${id}`).value),
        unit: document.getElementById(`prod-unit-${id}`).value,
      },
    };
    await fetchJson(`/api/admin/products/${id}`, { method: 'DELETE' });
    await loadProducts();
    showUndo();
  } catch (e) { mgmtFeedback.textContent = e.message; }
};

window.saveProduct = async (id) => {
  try {
    await fetchJson(`/api/admin/products/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById(`prod-name-${id}`).value,
        currentQty: Number(document.getElementById(`prod-qty-${id}`).value),
        minQty: Number(document.getElementById(`prod-min-${id}`).value),
        unit: document.getElementById(`prod-unit-${id}`).value,
      }),
    });
    mgmtFeedback.textContent = 'Produto atualizado.';
    await loadProducts();
  } catch (e) { mgmtFeedback.textContent = e.message; }
};

document.getElementById('addServiceBtn').addEventListener('click', async () => {
  try {
    await fetchJson('/api/admin/services', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('svcName').value,
        price: Number(document.getElementById('svcPrice').value),
        estimatedMinutes: Number(document.getElementById('svcMinutes').value),
      }),
    });
    mgmtFeedback.textContent = 'Serviço adicionado.';
    await loadServices();
  } catch (e) { mgmtFeedback.textContent = e.message; }
});

document.getElementById('addBarberBtn').addEventListener('click', async () => {
  try {
    await fetchJson('/api/admin/barbers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: document.getElementById('barberName').value,
        phone: unmaskPhone(document.getElementById('barberPhone').value),
        email: document.getElementById('barberEmail').value,
        password: document.getElementById('barberPass').value,
        commissionPercent: Number(document.getElementById('barberCommission').value),
      }),
    });
    mgmtFeedback.textContent = 'Barbeiro adicionado. Comissões rebalanceadas automaticamente para totalizar 100%.';
    await loadBarbers();
  } catch (e) { mgmtFeedback.textContent = e.message; }
});

document.getElementById('barberPhone').addEventListener('input', (e) => {
  e.target.value = maskPhone(e.target.value);
});

document.getElementById('addProductBtn').addEventListener('click', async () => {
  try {
    await fetchJson('/api/admin/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('prodName').value,
        currentQty: Number(document.getElementById('prodQty').value || 0),
        minQty: Number(document.getElementById('prodMin').value || 0),
        unit: document.getElementById('prodUnit').value || 'un',
      }),
    });
    mgmtFeedback.textContent = 'Produto adicionado.';
    await loadProducts();
  } catch (e) { mgmtFeedback.textContent = e.message; }
});

document.getElementById('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await login(document.getElementById('loginEmail').value, document.getElementById('loginPassword').value);
    await Promise.all([loadBarbers(), loadServices()]);
    if (isPasswordChangeRequired()) return;
    if (session?.user?.role === 'BARBEIRO') {
      await Promise.all([loadDashboard(), loadAdminAppointments(), loadProducts()]);
    }
    if (isOwnerSession()) {
      await Promise.all([loadOwnerOverview(), loadOwnerBarbershops(), loadOwnerFinance()]);
      setActiveScreen('dono');
      window.location.hash = 'dono';
    }
  } catch (error) { authFeedback.textContent = error.message; }
});

firstAccessPasswordForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    if (!session?.token) throw new Error('Faça login primeiro.');
    const currentPassword = document.getElementById('firstAccessCurrentPassword').value;
    const newPassword = document.getElementById('firstAccessNewPassword').value;
    const confirmPassword = document.getElementById('firstAccessNewPasswordConfirm').value;
    if (newPassword !== confirmPassword) throw new Error('A confirmação da nova senha não confere.');
    const result = await fetchJson('/api/auth/change-password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    session = result;
    localStorage.setItem(`barbearia_session_${tenantSlug}`, JSON.stringify(result));
    firstAccessPasswordForm.reset();
    firstAccessFeedback.textContent = 'Senha atualizada com sucesso. Acesso liberado.';
    updateFirstAccessUI();
    if (session?.user?.role === 'BARBEIRO') {
      await Promise.all([loadDashboard(), loadAdminAppointments(), loadProducts()]);
    }
  } catch (error) {
    firstAccessFeedback.textContent = error.message;
  }
});

document.getElementById('logoutBtn').addEventListener('click', logout);
document.getElementById('reloadAdmin').addEventListener('click', loadAdminAppointments);

ownerLoginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await ownerLogin(
      document.getElementById('ownerEmail').value,
      document.getElementById('ownerPassword').value
    );
    await Promise.all([loadOwnerOverview(), loadOwnerBarbershops(), loadOwnerFinance()]);
    setActiveScreen('dono');
    window.location.hash = 'dono';
  } catch (error) {
    ownerAuthFeedback.textContent = error.message;
  }
});

grantTrialForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    if (!isOwnerSession()) throw new Error('Faça login como dono para conceder trial.');
    const slug = document.getElementById('trialBarbershopSlug').value.trim();
    const days = Number(document.getElementById('trialDays').value || 7);
    const notes = document.getElementById('trialNotes').value.trim();
    const result = await fetchJson('/api/owner/trials/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barbershopSlug: slug, days, notes }),
    });
    trialFeedback.textContent = `Trial concedido para ${result.slug} até ${new Date(result.trial_ends_at).toLocaleDateString('pt-BR')}.`;
    await Promise.all([loadOwnerOverview(), loadOwnerBarbershops(), loadOwnerFinance()]);
  } catch (error) {
    trialFeedback.textContent = error.message;
  }
});

createBarbershopForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    if (!isOwnerSession()) throw new Error('Faça login como dono para criar barbearias.');
    const payload = {
      name: document.getElementById('newShopName').value.trim(),
      slug: document.getElementById('newShopSlug').value.trim(),
      city: document.getElementById('newShopCity').value.trim() || null,
      ownerFullName: document.getElementById('newOwnerName').value.trim(),
      ownerPhone: document.getElementById('newOwnerPhone').value.trim(),
      ownerEmail: document.getElementById('newOwnerEmail').value.trim() || null,
      ownerPassword: document.getElementById('newOwnerPassword').value,
      commissionPercent: Number(document.getElementById('newOwnerCommission').value || 100),
    };
    const result = await fetchJson('/api/owner/barbershops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    createBarbershopFeedback.textContent = `Barbearia criada: ${result.name} (${result.slug}).`;
    await Promise.all([loadOwnerOverview(), loadOwnerBarbershops(), loadOwnerFinance()]);
  } catch (error) {
    createBarbershopFeedback.textContent = error.message;
  }
});

updateSubscriptionForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    if (!isOwnerSession()) throw new Error('Faça login como dono para atualizar planos.');
    const id = Number(document.getElementById('subShopId').value);
    if (!id) throw new Error('Informe o ID da barbearia.');
    const isActiveRaw = document.getElementById('subIsActive').value;
    const payload = {
      planName: document.getElementById('subPlanName').value.trim() || null,
      monthlyPrice: document.getElementById('subMonthlyPrice').value ? Number(document.getElementById('subMonthlyPrice').value) : null,
      status: document.getElementById('subStatus').value || null,
      isActive: isActiveRaw === '' ? null : isActiveRaw === 'true',
      notes: document.getElementById('subNotes').value.trim() || null,
    };
    await fetchJson(`/api/owner/barbershops/${id}/subscription`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    subscriptionFeedback.textContent = `Assinatura da barbearia ${id} atualizada com sucesso.`;
    await Promise.all([loadOwnerOverview(), loadOwnerBarbershops(), loadOwnerFinance()]);
  } catch (error) {
    subscriptionFeedback.textContent = error.message;
  }
});

editBarbershopForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    if (!isOwnerSession()) throw new Error('Faça login como dono para editar barbearias.');
    const id = Number(document.getElementById('editShopId').value);
    if (!id) throw new Error('Informe o ID da barbearia.');
    const isActiveRaw = document.getElementById('editShopIsActive').value;
    const payload = {
      name: document.getElementById('editShopName').value.trim() || null,
      slug: document.getElementById('editShopSlug').value.trim() || null,
      city: document.getElementById('editShopCity').value.trim() || null,
      isActive: isActiveRaw === '' ? null : isActiveRaw === 'true',
      ownerFullName: document.getElementById('editOwnerName').value.trim() || null,
      ownerPhone: document.getElementById('editOwnerPhone').value.trim() || null,
      ownerEmail: document.getElementById('editOwnerEmail').value.trim() || null,
      ownerPassword: document.getElementById('editOwnerPassword').value || null,
      ownerCommissionPercent: document.getElementById('editOwnerCommission').value ? Number(document.getElementById('editOwnerCommission').value) : null,
      planName: document.getElementById('editSubPlanName').value.trim() || null,
      monthlyPrice: document.getElementById('editSubMonthlyPrice').value ? Number(document.getElementById('editSubMonthlyPrice').value) : null,
      status: document.getElementById('editSubStatus').value || null,
      notes: document.getElementById('editSubNotes').value.trim() || null,
    };
    await fetchJson(`/api/owner/barbershops/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    editBarbershopFeedback.textContent = `Barbearia ${id} atualizada com sucesso.`;
    await Promise.all([loadOwnerOverview(), loadOwnerBarbershops(), loadOwnerFinance()]);
  } catch (error) {
    editBarbershopFeedback.textContent = error.message;
  }
});

loadGalleryBtn.addEventListener('click', async () => {
  const clientId = Number(galleryClientId.value);
  if (!clientId) return (galleryGrid.innerHTML = '<p>Informe um ID válido.</p>');
  try { await loadGallery(clientId); } catch (error) { galleryGrid.innerHTML = `<p>${error.message}</p>`; }
});

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

(async function init() {
  try {
    updateOwnerUI();
    updateFirstAccessUI();
    initScreenNavigation();
    await Promise.all([loadServices(), loadBarbers()]);
    if (session?.token && session.user.role === 'BARBEIRO' && !isPasswordChangeRequired()) {
      authFeedback.textContent = `Sessão ativa: ${session.user.fullName} (${session.user.role}).`;
      await Promise.all([loadDashboard(), loadAdminAppointments(), loadProducts()]);
    }
    if (isOwnerSession()) {
      ownerAuthFeedback.textContent = `Sessão ativa: ${session.user.fullName}.`;
      await Promise.all([loadOwnerOverview(), loadOwnerBarbershops(), loadOwnerFinance()]);
      setActiveScreen('dono');
    }
  } catch (error) {
    mgmtFeedback.textContent = `Erro ao iniciar app: ${error.message}`;
  }
})();
