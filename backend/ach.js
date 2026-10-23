/**
 * ACH Service Layer
 * ----------------
 * Modes (set via ACH_MODE in .env):
 *   simulate  – local demo, auto-settles after a few seconds
 *   manual    – creates pending records for ops to process offline
 *   automatic – calls a real provider SDK/API (scaffold only)
 *
 * IMPORTANT: This is a demonstration scaffold.
 * Real ACH requires a licensed bank partner or an approved
 * ACH processor (Dwolla, Stripe Treasury, Modern Treasury, Column, etc.)
 * plus full BSA/AML, KYC, and NACHA compliance.
 */

const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const MODE = (process.env.ACH_MODE || 'simulate').toLowerCase();
const PROVIDER = (process.env.ACH_PROVIDER || 'dwolla').toLowerCase();

/**
 * Initiate an ACH transfer.
 * @param {object} opts
 * @param {string} opts.userId
 * @param {'send'|'receive'|'transfer'} opts.type
 * @param {number} opts.amount  positive number
 * @param {string} opts.direction  'debit' | 'credit'  (from user's perspective: debit = money leaves)
 * @param {object} opts.counterparty  { name, routing?, account?, accountLast4? }
 * @param {string} [opts.memo]
 * @returns {Promise<object>} transaction record
 */
async function initiateACH(opts) {
  const {
    userId,
    type,
    amount,
    direction,
    counterparty,
    memo = ''
  } = opts;

  const signedAmount = direction === 'debit' ? -Math.abs(amount) : Math.abs(amount);

  const tx = {
    id: uuidv4(),
    userId,
    type,
    title: buildTitle(type, direction, counterparty),
    amount: signedAmount,
    memo,
    status: 'pending',
    counterparty: {
      name: counterparty.name || 'Unknown',
      routing: counterparty.routing || null,
      accountLast4: counterparty.accountLast4 ||
        (counterparty.account ? String(counterparty.account).slice(-4) : null)
    },
    provider: MODE === 'automatic' ? PROVIDER : 'local',
    providerRef: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settledAt: null
  };

  // Update user balance immediately for demo UX (real systems often hold funds)
  const user = await db.getUserById(userId);
  if (!user) throw new Error('User not found');

  if (direction === 'debit' && user.balance < amount) {
    const err = new Error('Insufficient funds');
    err.code = 'INSUFFICIENT_FUNDS';
    throw err;
  }

  user.balance = Math.round((user.balance + signedAmount) * 100) / 100;
  await db.updateUser(user);
  await db.addTransaction(tx);

  // Route by mode
  if (MODE === 'simulate') {
    scheduleSimulatedSettlement(tx.id);
  } else if (MODE === 'manual') {
    // Leave as pending – ops will call /api/admin/settle/:id
    console.log(`[ACH MANUAL] Pending transfer ${tx.id} – amount ${signedAmount} for user ${userId}`);
  } else if (MODE === 'automatic') {
    try {
      const ref = await callRealProvider(tx, user);
      await db.updateTransaction(tx.id, { providerRef: ref, status: 'submitted' });
      tx.providerRef = ref;
      tx.status = 'submitted';
    } catch (e) {
      await db.updateTransaction(tx.id, { status: 'failed', memo: (memo || '') + ' | Provider error: ' + e.message });
      // Reverse the balance change on failure
      user.balance = Math.round((user.balance - signedAmount) * 100) / 100;
      await db.updateUser(user);
      throw e;
    }
  }

  return tx;
}

function buildTitle(type, direction, cp) {
  if (type === 'send') return `Sent to ${cp.name || 'recipient'}`;
  if (type === 'receive') return `Received from ${cp.name || 'sender'}`;
  if (type === 'transfer') {
    return direction === 'debit'
      ? 'Transfer to External Account'
      : 'Transfer from External Account';
  }
  return 'ACH Transaction';
}

function scheduleSimulatedSettlement(txId) {
  // Simulate network + settlement delay (2–4 seconds)
  const delay = 2000 + Math.random() * 2000;
  setTimeout(async () => {
    const updated = await db.updateTransaction(txId, {
      status: 'settled',
      settledAt: new Date().toISOString()
    });
    if (updated) {
      console.log(`[ACH SIM] Settled ${txId}`);
    }
  }, delay);
}

/**
 * Scaffold for real provider integration.
 * You must implement the actual SDK calls after obtaining API keys
 * and completing the provider's onboarding / compliance process.
 */
async function callRealProvider(tx, user) {
  switch (PROVIDER) {
    case 'dwolla':
      return callDwolla(tx, user);
    case 'stripe_treasury':
      return callStripeTreasury(tx, user);
    case 'modern_treasury':
      return callModernTreasury(tx, user);
    case 'column':
      return callColumn(tx, user);
    default:
      throw new Error(`Unknown ACH_PROVIDER: ${PROVIDER}`);
  }
}

/* ------------------------------------------------------------------
 * Provider stubs – replace with real SDK calls
 * ------------------------------------------------------------------ */

async function callDwolla(tx, user) {
  // 1. Create or retrieve Dwolla Customer for the user
  // 2. Create Funding Source (bank account)
  // 3. Initiate Transfer
  // Docs: https://developers.dwolla.com/docs/balance/transfers
  //
  // Example (pseudo):
  // const dwolla = require('dwolla-v2');
  // const client = new dwolla.Client({ key: process.env.DWOLLA_KEY, secret: process.env.DWOLLA_SECRET, environment: process.env.DWOLLA_ENV });
  // const transfer = await client.post('transfers', { ... });
  // return transfer.body.id;

  console.warn('[ACH] Dwolla integration is a stub. Set real credentials and implement SDK calls.');
  throw new Error('Dwolla automatic mode not fully configured. See README and ach.js stubs.');
}

async function callStripeTreasury(tx, user) {
  // Docs: https://stripe.com/docs/treasury
  // Use Stripe Financial Accounts + Outbound/Inbound Payments
  console.warn('[ACH] Stripe Treasury integration is a stub.');
  throw new Error('Stripe Treasury automatic mode not fully configured. See README.');
}

async function callModernTreasury(tx, user) {
  // Docs: https://docs.moderntreasury.com
  // Create Payment Order
  console.warn('[ACH] Modern Treasury integration is a stub.');
  throw new Error('Modern Treasury automatic mode not fully configured. See README.');
}

async function callColumn(tx, user) {
  // Docs: https://column.com/docs
  // Create ACH Transfer
  console.warn('[ACH] Column integration is a stub.');
  throw new Error('Column automatic mode not fully configured. See README.');
}

/**
 * Manually settle a pending transaction (used in manual mode or admin).
 */
async function settleTransaction(txId) {
  const tx = await db.getAllTransactions().find(t => t.id === txId);
  if (!tx) return null;
  if (tx.status === 'settled') return tx;
  return await db.updateTransaction(txId, {
    status: 'settled',
    settledAt: new Date().toISOString()
  });
}

/**
 * Cancel / fail a pending transaction and reverse balance if needed.
 */
async function failTransaction(txId, reason = '') {
  const tx = await db.getAllTransactions().find(t => t.id === txId);
  if (!tx || tx.status === 'settled') return null;

  // Reverse balance
  const user = await db.getUserById(tx.userId);
  if (user) {
    user.balance = Math.round((user.balance - tx.amount) * 100) / 100;
    await db.updateUser(user);
  }

  return await db.updateTransaction(txId, {
    status: 'failed',
    memo: (tx.memo || '') + (reason ? ` | ${reason}` : ''),
    settledAt: null
  });
}

module.exports = {
  initiateACH,
  settleTransaction,
  failTransaction,
  MODE,
  PROVIDER
};
