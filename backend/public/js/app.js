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
  $('mainFooter').classList.toggle('hidden', ['dashboard','onboarding','consent','terms','privacy','signup','signin'].includes(pageId));
  $('navLinks').classList.remove('open');
  window.scrollTo(0, 0);
  if (pageId === 'signup') initDobDropdowns();

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
  if (panelId === 'transfer') renderPlaidCard();
  if (panelId === 'receive' && currentUser) {
    $('recvName').textContent = currentUser.name;
    $('recvAccount').textContent = '•••• ' + (currentUser.accountLast4 || '4821');
  }
}


// ---------- Plaid (demo link + optional real Link token) ----------
const PLAID_KEY = 'easypay_linked_bank';

function getLinkedBank() {
  try { return JSON.parse(localStorage.getItem(PLAID_KEY) || 'null'); } catch { return null; }
}
function setLinkedBank(info) {
  if (info) localStorage.setItem(PLAID_KEY, JSON.stringify(info));
  else localStorage.removeItem(PLAID_KEY);
  renderPlaidCard();
}

function renderPlaidCard() {
  const info = getLinkedBank();
  const status = $('plaidStatus');
  const badge = $('plaidBadge');
  const linked = $('plaidLinkedInfo');
  const linkBtn = $('plaidLinkBtn');
  const unlinkBtn = $('plaidUnlinkBtn');
  if (!status) return;
  if (info) {
    status.textContent = 'Your external bank is connected for transfers.';
    if (badge) { badge.textContent = 'Linked'; badge.classList.add('linked'); }
    if (linked) linked.classList.remove('hidden');
    if ($('plaidBankName')) $('plaidBankName').textContent = info.name || 'Linked bank';
    if ($('plaidBankMeta')) $('plaidBankMeta').textContent =
      (info.subtype || 'Checking') + ' · •••• ' + (info.mask || '0000');
    if (linkBtn) linkBtn.classList.add('hidden');
    if (unlinkBtn) unlinkBtn.classList.remove('hidden');
  } else {
    status.textContent = 'No bank linked yet. Connect securely with Plaid.';
    if (badge) { badge.textContent = 'Not linked'; badge.classList.remove('linked'); }
    if (linked) linked.classList.add('hidden');
    if (linkBtn) linkBtn.classList.remove('hidden');
    if (unlinkBtn) unlinkBtn.classList.add('hidden');
  }
}

async function linkBankWithPlaid() {
  // Try backend link-token (real Plaid) — fall back to demo link
  try {
    const data = await api('/api/plaid/link-token', { method: 'POST', body: '{}' });
    if (data.link_token && window.Plaid) {
      const handler = window.Plaid.create({
        token: data.link_token,
        onSuccess: async (public_token, metadata) => {
          try {
            await api('/api/plaid/exchange', {
              method: 'POST',
              body: JSON.stringify({ public_token, metadata })
            });
          } catch (_) { /* demo may not persist server-side */ }
          const acct = (metadata && metadata.accounts && metadata.accounts[0]) || {};
          setLinkedBank({
            name: (metadata && metadata.institution && metadata.institution.name) || 'Linked bank',
            mask: acct.mask || '0000',
            subtype: acct.subtype || 'checking',
            linkedAt: new Date().toISOString()
          });
          showToast('Bank linked with Plaid');
        },
        onExit: () => {}
      });
      handler.open();
      return;
    }
  } catch (_) {
    // no real Plaid keys — demo flow
  }
  // Demo simulation
  setLinkedBank({
    name: 'Chase',
    mask: String(Math.floor(1000 + Math.random() * 9000)),
    subtype: 'checking',
    linkedAt: new Date().toISOString(),
    demo: true
  });
  showToast('Bank linked (demo Plaid flow)');
}

function unlinkBank() {
  setLinkedBank(null);
  showToast('Bank unlinked');
}

// ---------- Auth ----------
function continueFromConsent() {
  const terms = $('consentTerms');
  const marketing = $('consentMarketing');
  const err = $('consentError');
  if (!terms || !terms.checked || !marketing || !marketing.checked) {
    if (err) {
      err.textContent = 'Please check both boxes to continue.';
      err.classList.remove('hidden');
    } else {
      showToast('Please check both boxes to continue.');
    }
    return;
  }
  if (err) err.classList.add('hidden');
  showPage('signup');
}


// ---------- DOB dropdowns (month / day / year) ----------
function daysInMonth(year, month) {
  if (!year || !month) return 31;
  return new Date(Number(year), Number(month), 0).getDate();
}

function fillDobDays() {
  const month = $('su-dob-month') && $('su-dob-month').value;
  const year = $('su-dob-year') && $('su-dob-year').value;
  const daySel = $('su-dob-day');
  if (!daySel) return;
  const prev = daySel.value;
  const max = daysInMonth(year, month);
  daySel.innerHTML = '<option value="">Day</option>';
  for (let d = 1; d <= max; d++) {
    const v = String(d).padStart(2, '0');
    daySel.innerHTML += '<option value="' + v + '">' + d + '</option>';
  }
  if (prev && Number(prev) <= max) daySel.value = prev;
  syncDobHidden();
}

function fillDobYears() {
  const yearSel = $('su-dob-year');
  if (!yearSel || yearSel.options.length > 1) return;
  const now = new Date().getFullYear();
  // Must be 16+: max year = now - 16; min year = 1920
  const maxYear = now - 16;
  const minYear = 1920;
  yearSel.innerHTML = '<option value="">Year</option>';
  for (let y = maxYear; y >= minYear; y--) {
    yearSel.innerHTML += '<option value="' + y + '">' + y + '</option>';
  }
}

function syncDobHidden() {
  const m = $('su-dob-month') && $('su-dob-month').value;
  const d = $('su-dob-day') && $('su-dob-day').value;
  const y = $('su-dob-year') && $('su-dob-year').value;
  const hidden = $('su-dob');
  if (!hidden) return;
  if (m && d && y) hidden.value = y + '-' + m + '-' + d;
  else hidden.value = '';
}

function initDobDropdowns() {
  fillDobYears();
  fillDobDays();
  ['su-dob-month', 'su-dob-day', 'su-dob-year'].forEach(id => {
    const el = $(id);
    if (!el || el._dobBound) return;
    el._dobBound = true;
    el.addEventListener('change', () => {
      if (id !== 'su-dob-day') fillDobDays();
      else syncDobHidden();
    });
  });
}

function isAtLeast16(dobStr) {
  if (!dobStr) return false;
  const dob = new Date(dobStr + 'T00:00:00');
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age >= 16;
}

async function handleSignup(e) {
  e.preventDefault();
  const name = $('su-name').value.trim();
  const address = $('su-address') ? $('su-address').value.trim() : '';
  const dob = $('su-dob') ? $('su-dob').value : '';
  const idNumber = $('su-id') ? $('su-id').value.trim() : '';
  const username = $('su-username') ? $('su-username').value.trim() : '';
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
  if (dob && !isAtLeast16(dob)) {
    err.textContent = 'You must be at least 16 years old to use Easy Pay.';
    err.classList.remove('hidden');
    return;
  }

  try {
    const data = await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        name,
        email,
        password,
        address,
        dateOfBirth: dob,
        idNumber,
        username,
        marketingOptIn: !!( $('consentMarketing') && $('consentMarketing').checked )
      })
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

  if (!getLinkedBank()) {
    err.textContent = 'Link a bank account with Plaid before transferring.';
    err.classList.remove('hidden');
    return;
  }

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
  initDobDropdowns();
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
