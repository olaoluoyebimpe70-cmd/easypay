/**
 * Easy Pay data layer
 * - Default: JSON files (local demo only)
 * - On Render free tier the disk is EPHEMERAL — users disappear after restart.
 *   Set DATABASE_URL to free Neon/Supabase Postgres so accounts persist.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TX_FILE = path.join(DATA_DIR, 'transactions.json');

const usePostgres = !!process.env.DATABASE_URL;
let pgPool = null;

async function init() {
  if (!usePostgres) {
    ensureDataDir();
    console.log('DB: JSON files at', DATA_DIR, '(not persistent on Render free tier)');
    return;
  }
  const { Pool } = require('pg');
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
  });
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      balance DOUBLE PRECISION NOT NULL DEFAULT 0,
      account_last4 TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      username TEXT,
      address TEXT,
      date_of_birth TEXT,
      id_number TEXT,
      marketing_opt_in BOOLEAN DEFAULT FALSE
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS id_number TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN DEFAULT FALSE;
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT,
      amount DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL,
      memo TEXT,
      counterparty_name TEXT,
      counterparty_routing TEXT,
      counterparty_account TEXT,
      provider TEXT,
      provider_ref TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ,
      settled_at TIMESTAMPTZ
    );
  `);
  console.log('DB: Postgres via DATABASE_URL (persistent)');
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({}, null, 2));
  if (!fs.existsSync(TX_FILE)) fs.writeFileSync(TX_FILE, JSON.stringify([], null, 2));
}

function readJson(file) {
  ensureDataDir();
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return file === TX_FILE ? [] : {}; }
}

function writeJson(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    balance: Number(row.balance),
    accountLast4: row.account_last4,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    username: row.username || null,
    address: row.address || null,
    dateOfBirth: row.date_of_birth || null,
    idNumber: row.id_number || null,
    marketingOptIn: !!row.marketing_opt_in
  };
}

function mapTx(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    amount: Number(row.amount),
    status: row.status,
    memo: row.memo,
    counterparty: {
      name: row.counterparty_name,
      routing: row.counterparty_routing,
      accountLast4: row.counterparty_account
    },
    provider: row.provider,
    providerRef: row.provider_ref,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    settledAt: row.settled_at
      ? (row.settled_at instanceof Date ? row.settled_at.toISOString() : row.settled_at)
      : null
  };
}

async function getUserByEmail(email) {
  const key = (email || '').toLowerCase();
  if (usePostgres) {
    const r = await pgPool.query('SELECT * FROM users WHERE email = $1', [key]);
    return mapUser(r.rows[0]);
  }
  return readJson(USERS_FILE)[key] || null;
}

async function getUserById(id) {
  if (usePostgres) {
    const r = await pgPool.query('SELECT * FROM users WHERE id = $1', [id]);
    return mapUser(r.rows[0]);
  }
  return Object.values(readJson(USERS_FILE)).find(u => u.id === id) || null;
}

async function createUser(user) {
  if (usePostgres) {
    await pgPool.query(
      `INSERT INTO users (id, name, email, password_hash, balance, account_last4, created_at, username, address, date_of_birth, id_number, marketing_opt_in)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        user.id, user.name, user.email.toLowerCase(), user.passwordHash, user.balance, user.accountLast4, user.createdAt,
        user.username || null, user.address || null, user.dateOfBirth || null, user.idNumber || null, !!user.marketingOptIn
      ]
    );
    return user;
  }
  const users = readJson(USERS_FILE);
  users[user.email.toLowerCase()] = user;
  writeJson(USERS_FILE, users);
  return user;
}

async function updateUser(user) {
  if (usePostgres) {
    await pgPool.query(
      `UPDATE users SET name=$2, email=$3, password_hash=$4, balance=$5, account_last4=$6 WHERE id=$1`,
      [user.id, user.name, user.email.toLowerCase(), user.passwordHash, user.balance, user.accountLast4]
    );
    return user;
  }
  const users = readJson(USERS_FILE);
  users[user.email.toLowerCase()] = user;
  writeJson(USERS_FILE, users);
  return user;
}

async function getAllTransactions() {
  if (usePostgres) {
    const r = await pgPool.query('SELECT * FROM transactions ORDER BY created_at DESC');
    return r.rows.map(mapTx);
  }
  return readJson(TX_FILE);
}

async function getTransactionsForUser(userId) {
  if (usePostgres) {
    const r = await pgPool.query(
      'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return r.rows.map(mapTx);
  }
  return readJson(TX_FILE)
    .filter(t => t.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function addTransaction(tx) {
  if (usePostgres) {
    await pgPool.query(
      `INSERT INTO transactions
        (id, user_id, type, title, amount, status, memo, counterparty_name, counterparty_routing, counterparty_account, provider, provider_ref, created_at, updated_at, settled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        tx.id, tx.userId, tx.type, tx.title || null, tx.amount, tx.status, tx.memo || null,
        tx.counterparty?.name || null, tx.counterparty?.routing || null, tx.counterparty?.accountLast4 || null,
        tx.provider || null, tx.providerRef || null,
        tx.createdAt || new Date().toISOString(), tx.updatedAt || null, tx.settledAt || null
      ]
    );
    return tx;
  }
  const list = readJson(TX_FILE);
  list.push(tx);
  writeJson(TX_FILE, list);
  return tx;
}

/** updateTransaction(id, patch) — merges patch into existing tx */
async function updateTransaction(id, patch) {
  if (usePostgres) {
    const existing = await getTransactionById(id);
    if (!existing) return null;
    const tx = { ...existing, ...patch, id };
    await pgPool.query(
      `UPDATE transactions SET status=$2, settled_at=$3, title=$4, amount=$5, memo=$6, provider_ref=$7, updated_at=$8 WHERE id=$1`,
      [
        id, tx.status, tx.settledAt || null, tx.title || null, tx.amount,
        tx.memo || null, tx.providerRef || null, new Date().toISOString()
      ]
    );
    return tx;
  }
  const list = readJson(TX_FILE);
  const i = list.findIndex(t => t.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch, updatedAt: new Date().toISOString() };
  writeJson(TX_FILE, list);
  return list[i];
}

async function getTransactionById(id) {
  if (usePostgres) {
    const r = await pgPool.query('SELECT * FROM transactions WHERE id = $1', [id]);
    return mapTx(r.rows[0]);
  }
  return readJson(TX_FILE).find(t => t.id === id) || null;
}

module.exports = {
  init,
  getUserByEmail,
  getUserById,
  createUser,
  updateUser,
  getAllTransactions,
  getTransactionsForUser,
  addTransaction,
  updateTransaction,
  getTransactionById,
  isPostgres: () => usePostgres
};
