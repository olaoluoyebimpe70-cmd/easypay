/**
 * Easy Pay Backend
 * Express API with JWT auth, file DB, and ACH service (simulate / manual / automatic)
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const db = require('./db');
const ach = require('./ach');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const STARTING_BALANCE = parseFloat(process.env.STARTING_BALANCE || '1000');

app.use(cors());
app.use(express.json());

// Serve the frontend static files
// Prefer backend/public (works when Render Root Directory = backend)
// Fallback to ../frontend for local monorepo development
const fs = require('fs');
const publicDir = path.join(__dirname, 'public');
const frontendDir = path.join(__dirname, '../frontend');
const staticDir = fs.existsSync(path.join(publicDir, 'index.html'))
  ? publicDir
  : frontendDir;
app.use(express.static(staticDir));
console.log('Serving static files from:', staticDir);

// ---------- Auth middleware ----------
async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await db.getUserById(payload.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username || null,
    address: user.address || null,
    dateOfBirth: user.dateOfBirth || null,
    balance: user.balance,
    accountLast4: user.accountLast4,
    createdAt: user.createdAt
  };
}

// ---------- Health ----------
app.get('/api/health', async (req, res) => {
  res.json({
    status: 'ok',
    service: 'Easy Pay API',
    achMode: ach.MODE,
    provider: ach.MODE === 'automatic' ? ach.PROVIDER : null,
    db: db.isPostgres() ? 'postgres' : 'json-ephemeral',
    time: new Date().toISOString()
  });
});

// ---------- Auth routes ----------
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password, address, dateOfBirth, idNumber, username, marketingOptIn } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }
    if (!username || String(username).trim().length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }
    if (!address || !String(address).trim()) {
      return res.status(400).json({ error: 'Home address is required' });
    }
    if (!dateOfBirth) {
      return res.status(400).json({ error: 'Date of birth is required' });
    }
    // Age 16+
    {
      const dob = new Date(String(dateOfBirth) + 'T00:00:00');
      const now = new Date();
      let age = now.getFullYear() - dob.getFullYear();
      const mm = now.getMonth() - dob.getMonth();
      if (mm < 0 || (mm === 0 && now.getDate() < dob.getDate())) age--;
      if (isNaN(dob.getTime()) || age < 16) {
        return res.status(400).json({ error: 'You must be at least 16 years old to use Easy Pay' });
      }
    }
    if (!idNumber || !String(idNumber).trim()) {
      return res.status(400).json({ error: "Driver's license or state ID number is required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (await db.getUserByEmail(email)) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = {
      id: uuidv4(),
      name: name.trim(),
      email: email.trim().toLowerCase(),
      username: String(username).trim().toLowerCase(),
      address: String(address).trim(),
      dateOfBirth: String(dateOfBirth),
      idNumber: String(idNumber).trim(),
      marketingOptIn: !!marketingOptIn,
      passwordHash: hash,
      balance: STARTING_BALANCE,
      accountLast4: String(Math.floor(1000 + Math.random() * 9000)),
      createdAt: new Date().toISOString()
    };
    await db.createUser(user);

    // Welcome transaction
    await ach.initiateACH({
      userId: user.id,
      type: 'receive',
      amount: STARTING_BALANCE,
      direction: 'credit',
      counterparty: { name: 'Easy Pay' },
      memo: 'Welcome bonus / starting balance'
    });

    // Re-fetch because balance was already set
    const fresh = await db.getUserById(user.id);
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      token,
      user: publicUser(fresh)
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const user = await db.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/auth/me', auth, async (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// ---------- Account ----------
app.get('/api/account', auth, async (req, res) => {
  res.json({
    user: publicUser(req.user),
    routingNumber: '021000021', // demo routing
    accountNumberMasked: '•••• ' + req.user.accountLast4
  });
});

// ---------- Transactions ----------
app.get('/api/transactions', auth, async (req, res) => {
  const filter = req.query.type; // send | receive | transfer | all
  let txs = await db.getTransactionsForUser(req.user.id);
  if (filter && filter !== 'all') {
    txs = txs.filter(t => t.type === filter);
  }
  res.json({ transactions: txs });
});

// ---------- Send (ACH debit from user) ----------
app.post('/api/send', auth, async (req, res) => {
  try {
    const { recipientName, routingNumber, accountNumber, amount, memo } = req.body;
    const amt = parseFloat(amount);

    if (!recipientName || !routingNumber || !accountNumber || isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: 'Missing or invalid fields' });
    }
    if (!/^\d{9}$/.test(String(routingNumber))) {
      return res.status(400).json({ error: 'Routing number must be exactly 9 digits' });
    }

    const tx = await ach.initiateACH({
      userId: req.user.id,
      type: 'send',
      amount: amt,
      direction: 'debit',
      counterparty: {
        name: recipientName.trim(),
        routing: String(routingNumber),
        account: String(accountNumber),
        accountLast4: String(accountNumber).slice(-4)
      },
      memo: memo || ''
    });

    const user = await db.getUserById(req.user.id);
    res.status(201).json({ transaction: tx, balance: user.balance });
  } catch (e) {
    if (e.code === 'INSUFFICIENT_FUNDS') {
      return res.status(400).json({ error: e.message });
    }
    console.error(e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

// ---------- Receive (simulate incoming ACH credit) ----------
app.post('/api/receive', auth, async (req, res) => {
  try {
    const { fromName, amount, memo } = req.body;
    const amt = parseFloat(amount);
    if (!fromName || isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: 'Missing or invalid fields' });
    }

    const tx = await ach.initiateACH({
      userId: req.user.id,
      type: 'receive',
      amount: amt,
      direction: 'credit',
      counterparty: { name: fromName.trim() },
      memo: memo || 'Incoming ACH credit'
    });

    const user = await db.getUserById(req.user.id);
    res.status(201).json({ transaction: tx, balance: user.balance });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

// ---------- Transfer (to/from linked external) ----------
app.post('/api/transfer', auth, async (req, res) => {
  try {
    const { direction, amount, memo } = req.body; // direction: 'out' | 'in'
    const amt = parseFloat(amount);
    if (!['out', 'in'].includes(direction) || isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: 'Missing or invalid fields' });
    }

    const tx = await ach.initiateACH({
      userId: req.user.id,
      type: 'transfer',
      amount: amt,
      direction: direction === 'out' ? 'debit' : 'credit',
      counterparty: { name: 'Linked External Account' },
      memo: memo || (direction === 'out' ? 'ACH outbound transfer' : 'ACH inbound transfer')
    });

    const user = await db.getUserById(req.user.id);
    res.status(201).json({ transaction: tx, balance: user.balance });
  } catch (e) {
    if (e.code === 'INSUFFICIENT_FUNDS') {
      return res.status(400).json({ error: e.message });
    }
    console.error(e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

// ---------- Admin helpers (for manual ACH mode) ----------
// In production protect these with strong admin auth / IP allow-list
app.post('/api/admin/settle/:id', async (req, res) => {
  const tx = await ach.settleTransaction(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Transaction not found or already settled' });
  res.json({ transaction: tx });
});

app.post('/api/admin/fail/:id', async (req, res) => {
  const tx = await ach.failTransaction(req.params.id, req.body.reason || 'Manual failure');
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  res.json({ transaction: tx });
});

app.get('/api/admin/pending', async (req, res) => {
  const pending = (await db.getAllTransactions()).filter(t => t.status === 'pending' || t.status === 'submitted');
  res.json({ transactions: pending });
});


// ---------- Plaid (optional — needs PLAID_CLIENT_ID + PLAID_SECRET) ----------
app.post('/api/plaid/link-token', auth, async (req, res) => {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = process.env.PLAID_ENV || 'sandbox';
  if (!clientId || !secret) {
    return res.status(501).json({
      error: 'Plaid not configured',
      demo: true,
      message: 'Set PLAID_CLIENT_ID and PLAID_SECRET for real Link. Frontend will use demo link.'
    });
  }
  try {
    const host = env === 'production' ? 'https://production.plaid.com' : 'https://sandbox.plaid.com';
    const r = await fetch(host + '/link/token/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        secret,
        user: { client_user_id: String(req.user.id) },
        client_name: 'Easy Pay',
        products: ['auth', 'transfer'],
        country_codes: ['US'],
        language: 'en'
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: data.error_message || 'Plaid error', details: data });
    res.json({ link_token: data.link_token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create Plaid link token' });
  }
});

app.post('/api/plaid/exchange', auth, async (req, res) => {
  // Scaffold: exchange public_token for access_token when Plaid is configured
  res.json({ ok: true, demo: !(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET) });
});

// ---------- Webhook endpoint (for automatic providers) ----------
app.post('/api/webhooks/ach', express.raw({ type: 'application/json' }), (req, res) => {
  // Verify signature with ACH_WEBHOOK_SECRET in production
  // Then update transaction status based on provider event
  console.log('[Webhook] Received ACH event (scaffold – implement verification & handling)');
  res.json({ received: true });
});

// SPA fallback (only for non-API routes that are not real files)
app.get('*', async (req, res) => {
  const indexPath = path.join(staticDir, 'index.html');
  res.sendFile(indexPath);
});

async function start() {
  await db.init();
  app.listen(PORT, () => {
  console.log(`\n  Easy Pay API running on http://localhost:${PORT}`);
  console.log(`  ACH mode: ${ach.MODE}${ach.MODE === 'automatic' ? ' (' + ach.PROVIDER + ')' : ''}`);
  console.log(`  Database: ${db.isPostgres() ? 'Postgres (persistent)' : 'JSON files (ephemeral on Render)'}`);
  console.log(`  Frontend static dir resolved at startup\n`);
});
}

start().catch(err => {
  console.error("Failed to start:", err);
  process.exit(1);
});
