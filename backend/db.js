/**
 * Simple file-based JSON database for the demo.
 * In production replace with PostgreSQL / MongoDB / etc.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TX_FILE = path.join(DATA_DIR, 'transactions.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({}, null, 2));
  }
  if (!fs.existsSync(TX_FILE)) {
    fs.writeFileSync(TX_FILE, JSON.stringify([], null, 2));
  }
}

function readJson(file) {
  ensureDataDir();
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return file === TX_FILE ? [] : {};
  }
}

function writeJson(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ---------- Users ----------
function getUsers() {
  return readJson(USERS_FILE);
}

function saveUsers(users) {
  writeJson(USERS_FILE, users);
}

function getUserByEmail(email) {
  const users = getUsers();
  return users[email.toLowerCase()] || null;
}

function getUserById(id) {
  const users = getUsers();
  return Object.values(users).find(u => u.id === id) || null;
}

function createUser(user) {
  const users = getUsers();
  users[user.email.toLowerCase()] = user;
  saveUsers(users);
  return user;
}

function updateUser(user) {
  const users = getUsers();
  users[user.email.toLowerCase()] = user;
  saveUsers(users);
  return user;
}

// ---------- Transactions ----------
function getAllTransactions() {
  return readJson(TX_FILE);
}

function getTransactionsForUser(userId) {
  return getAllTransactions()
    .filter(t => t.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function addTransaction(tx) {
  const list = getAllTransactions();
  list.push(tx);
  writeJson(TX_FILE, list);
  return tx;
}

function updateTransaction(id, updates) {
  const list = getAllTransactions();
  const idx = list.findIndex(t => t.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...updates, updatedAt: new Date().toISOString() };
  writeJson(TX_FILE, list);
  return list[idx];
}

module.exports = {
  getUsers,
  getUserByEmail,
  getUserById,
  createUser,
  updateUser,
  getTransactionsForUser,
  addTransaction,
  updateTransaction,
  getAllTransactions
};
