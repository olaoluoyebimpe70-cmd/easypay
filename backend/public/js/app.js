/**
 * Easy Pay — Frontend
 * Talks to the Express backend API.
 */

const API = (window.location.protocol === 'file:' || window.location.port === '8080')
  ? 'http://localhost:3000'
  : ''; // same origin when served by the backend

const TOKEN_KEY = 'easypay_token';

// ---------- Helpers ----------
function $(id) { return document.getElementById(id); }
function formatMoney(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}
function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function showToast(msg, ms = 2800) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), ms);
}

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const res = await fetch(API + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText || 'Request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- State ----------
let currentUser = null;

// ---------- Navigation ----------
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = $('page-' + pageId);
  if (page) page.classList.add('active');

  const loggedIn = !!getToken() && !!currentUser;
  $('navSignIn').classList.toggle('hidden', loggedIn);
  $('navSignUp').classList.toggle('hidden', loggedIn);
  $('navLogout').classList.toggle('hidden', !loggedIn);
  const siM = $('navSignInMobile');
  const suM = $('navSignUpMobile');
  const loM = $('navLogoutMobile');
  if (siM) siM.classList.toggle('hidden', loggedIn);
  if (suM) suM.classList.toggle('hidden', loggedIn);
  if (loM) loM.classList.toggle('hidden', !loggedIn);
  $('mainFooter').classList.toggle('hidden', pageId === 'dashboard');
  $('navLinks').classList.remove('open');
  window.scrollTo(0, 0);

  if (pageId === 'dashboard') {
    if (!getToken()) {
      showPage('signin');
      return;
    }
    loadDashboard();
  }
}

function showPanel(panelId) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const panel = $('panel-' + panelId);
  if (panel) panel.classList.add('active');

  document.querySelectorAll('.side-link').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.panel === panelId);
  });
  document.querySelectorAll('.bnav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.panel === panelId);
  });

  if (panelId === 'history') loadHistory('all');
  if (panelId === 'overview') loadRecent();
  if (panelId === 'receive' && currentUser) {
    $('recvName').textContent = currentUser.name;
    $('recvAccount').textContent = '•••• ' + (currentUser.accountLast4 || '4821');
  }
}

// ---------- Auth ----------
async function handleSignup(e) {
  e.preventDefault();
  const name = $('su-name').value.trim();
  const email = $('su-email').value.trim();
  const password = $('su-password').value;
  const confirm = $('su-confirm').value;
  const err = $('signupError');
  err.classList.add('hidden');

  if (password !== confirm) {
    err.textContent = 'Passwords do not match.';
    err.classList.remove('hidden');
    return;
  }

  try {
    const data = await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name, email, password })
    });
    setToken(data.token);
    currentUser = data.user;
    showToast('Account created! Welcome to Easy Pay.');
    showPage('dashboard');
    e.target.reset();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  }
}

async function handleSignin(e) {
  e.preventDefault();
  const email = $('si-email').value.trim();
  const password = $('si-password').value;
  const err = $('signinError');
  err.classList.add('hidden');

  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    setToken(data.token);
    currentUser = data.user;
    showToast('Welcome back, ' + currentUser.name.split(' ')[0] + '!');
    showPage('dashboard');
    e.target.reset();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  }
}

function logout() {
  clearToken();
  currentUser = null;
  showToast('You have been logged out.');
  showPage('home');
}

// ---------- Dashboard ----------
async function loadDashboard() {
  try {
    const data = await api('/api/auth/me');
    currentUser = data.user;
    renderUser();
    await loadRecent();
    showPanel('overview');
  } catch {
    clearToken();
    currentUser = null;
    showPage('signin');
  }
}

function renderUser() {
  if (!currentUser) return;
  $('userName').textContent = currentUser.name;
  $('userEmail').textContent = currentUser.email;
  $('userAvatar').textContent = currentUser.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  $('greetingName').textContent = currentUser.name.split(' ')[0];
  $('balanceDisplay').textContent = formatMoney(currentUser.balance);
}

function renderTxItem(tx) {
  const amountClass = tx.amount >= 0 ? 'positive' : 'negative';
  const sign = tx.amount >= 0 ? '+' : '−';
  const abs = Math.abs(tx.amount);
  let iconClass = 'transfer';
  let iconChar = '⇄';
  if (tx.type === 'send') { iconClass = 'out'; iconChar = '↑'; }
  if (tx.type === 'receive') { iconClass = 'in'; iconChar = '↓'; }

  const statusLabel = (tx.status || 'pending').charAt(0).toUpperCase() + (tx.status || 'pending').slice(1);

  return `
    <div class="tx-item">
      <div class="tx-icon ${iconClass}">${iconChar}</div>
      <div class="tx-details">
        <div class="tx-title">${escapeHtml(tx.title)}</div>
        <div class="tx-meta">${formatDate(tx.createdAt || tx.date)} · ${statusLabel}${tx.memo ? ' · ' + escapeHtml(tx.memo) : ''}</div>
      </div>
      <div class="tx-amount ${amountClass}">${sign}${formatMoney(abs)}</div>
    </div>
  `;
}

async function loadRecent() {
  const list = $('recentTx');
  try {
    const data = await api('/api/transactions');
    const recent = (data.transactions || []).slice(0, 5);
    if (!recent.length) {
      list.innerHTML = '<div class="empty-state">No transactions yet. Try sending or receiving money!</div>';
      return;
    }
    list.innerHTML = recent.map(renderTxItem).join('');
  } catch {
    list.innerHTML = '<div class="empty-state">Could not load transactions.</div>';
  }
}

async function loadHistory(filter) {
  const list = $('historyList');
  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === filter);
  });
  try {
    const q = filter && filter !== 'all' ? '?type=' + filter : '';
    const data = await api('/api/transactions' + q);
    const txs = data.transactions || [];
    if (!txs.length) {
      list.innerHTML = '<div class="empty-state">No transactions match this filter.</div>';
      return;
    }
    list.innerHTML = txs.map(renderTxItem).join('');
  } catch {
    list.innerHTML = '<div class="empty-state">Could not load history.</div>';
  }
}

function filterHistory(filter) {
  loadHistory(filter);
}

// ---------- Money actions ----------
async function handleSend(e) {
  e.preventDefault();
  const err = $('sendError');
  err.classList.add('hidden');

  const body = {
    recipientName: $('send-name').value.trim(),
    routingNumber: $('send-routing').value.trim(),
    accountNumber: $('send-account').value.trim(),
    amount: parseFloat($('send-amount').value),
    memo: $('send-memo').value.trim()
  };

  try {
    const data = await api('/api/send', { method: 'POST', body: JSON.stringify(body) });
    currentUser.balance = data.balance;
    $('balanceDisplay').textContent = formatMoney(data.balance);
    showToast('ACH send initiated — ' + formatMoney(body.amount));
    e.target.reset();
    showPanel('overview');
    setTimeout(() => { loadRecent(); }, 3500);
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  }
}

async function handleReceive(e) {
  e.preventDefault();
  const body = {
    fromName: $('recv-from').value.trim(),
    amount: parseFloat($('recv-amount').value),
    memo: $('recv-memo').value.trim()
  };
  try {
    const data = await api('/api/receive', { method: 'POST', body: JSON.stringify(body) });
    currentUser.balance = data.balance;
    $('balanceDisplay').textContent = formatMoney(data.balance);
    showToast('Incoming ACH credited — ' + formatMoney(body.amount));
    e.target.reset();
    showPanel('overview');
  } catch (ex) {
    showToast(ex.message);
  }
}

async function handleTransfer(e) {
  e.preventDefault();
  const err = $('transferError');
  err.classList.add('hidden');

  const body = {
    direction: $('tf-direction').value,
    amount: parseFloat($('tf-amount').value),
    memo: $('tf-memo').value.trim()
  };

  try {
    const data = await api('/api/transfer', { method: 'POST', body: JSON.stringify(body) });
    currentUser.balance = data.balance;
    $('balanceDisplay').textContent = formatMoney(data.balance);
    showToast(body.direction === 'out' ? 'Outbound transfer initiated' : 'Inbound transfer completed');
    e.target.reset();
    showPanel('overview');
    setTimeout(() => { loadRecent(); }, 3500);
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  }
}

// ---------- Mobile menu ----------
$('mobileToggle').addEventListener('click', () => {
  $('navLinks').classList.toggle('open');
});

// ---------- Init ----------
(async function init() {
  if (getToken()) {
    try {
      const data = await api('/api/auth/me');
      currentUser = data.user;
      showPage('dashboard');
      return;
    } catch {
      clearToken();
    }
  }
  showPage('home');
})();
