'use strict';

const axios = require('axios');
const env = require('../../config/env');

const paystackHttp = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: {
    Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

const MOBILE_MONEY_PROVIDERS = {
  MOMO_MTN: 'mtn',
  MOMO_TELECEL: 'vodafone',
  MOMO_AIRTELTIGO: 'atl',
};

async function initiateMomoCharge({ email, amount, phone, method, reference, metadata = {} }) {
  const provider = MOBILE_MONEY_PROVIDERS[method];
  if (!provider) throw new Error(`Unsupported MoMo method: ${method}`);

  const amountPesewas = Math.round(amount * 100); // Paystack uses pesewas

  const { data } = await paystackHttp.post('/charge', {
    email,
    amount: amountPesewas,
    currency: 'GHS',
    mobile_money: { phone, provider },
    reference,
    metadata,
  });

  return data;
}

async function initiateCardCharge({ email, amount, authorizationCode, reference, metadata = {} }) {
  const amountPesewas = Math.round(amount * 100);

  const { data } = await paystackHttp.post('/transaction/charge_authorization', {
    email,
    amount: amountPesewas,
    authorization_code: authorizationCode,
    reference,
    currency: 'GHS',
    metadata,
  });

  return data;
}

// Initialize a hosted Paystack checkout (used for first-time card payments —
// returns an authorization_url the client opens in a WebView).
async function initializeCheckout({ email, amount, reference, metadata = {} }) {
  const amountPesewas = Math.round(amount * 100);

  const { data } = await paystackHttp.post('/transaction/initialize', {
    email,
    amount: amountPesewas,
    currency: 'GHS',
    reference,
    metadata,
  });

  return data;
}

async function verifyTransaction(reference) {
  const { data } = await paystackHttp.get(`/transaction/verify/${reference}`);
  return data;
}

async function initiateTransfer({ amount, recipient, reason, reference }) {
  const amountPesewas = Math.round(amount * 100);

  const { data } = await paystackHttp.post('/transfer', {
    source: 'balance',
    amount: amountPesewas,
    recipient,
    reason,
    reference,
    currency: 'GHS',
  });

  return data;
}

async function createTransferRecipient({ name, accountNumber, bankCode = '057', recipientType = 'mobile_money' }) {
  // 057 = MTN Ghana MoMo bank code (default, preserved for backward compatibility
  // with callers that don't resolve a real payout account).
  const { data } = await paystackHttp.post('/transferrecipient', {
    type: recipientType,
    name,
    account_number: accountNumber,
    bank_code: bankCode,
    currency: 'GHS',
  });

  return data;
}

// Bank/MoMo provider name fragments we match against Paystack's live GHS bank
// list, keyed by the driver-facing selection. Real routing codes are always
// resolved live from Paystack (never hardcoded here) since a wrong bank_code
// would misroute a driver's real payout.
const MOMO_NAME_MATCH = {
  MTN: /mtn/i,
  TELECEL: /vodafone|telecel/i,
  AIRTELTIGO: /airteltigo|tigo|airtel/i,
};

let bankListCache = null;
let bankListCacheAt = 0;
const BANK_LIST_TTL_MS = 60 * 60 * 1000; // 1h — this list changes rarely

async function getGhanaBankList() {
  if (bankListCache && Date.now() - bankListCacheAt < BANK_LIST_TTL_MS) return bankListCache;
  const { data } = await paystackHttp.get('/bank', { params: { currency: 'GHS' } });
  bankListCache = data?.data ?? [];
  bankListCacheAt = Date.now();
  return bankListCache;
}

/**
 * Resolve a real Paystack bank_code for a driver's saved payout preference.
 * Throws (does not silently guess) if no confident match is found — misrouting
 * a real payout is worse than failing the withdrawal and asking the driver to
 * re-check their payout settings.
 */
async function resolvePayoutBankCode(payoutData) {
  const banks = await getGhanaBankList();

  if (payoutData?.type === 'momo') {
    const matcher = MOMO_NAME_MATCH[payoutData.network];
    const match = matcher && banks.find((b) => b.type === 'mobile_money' && matcher.test(b.name));
    if (!match) {
      throw new Error(`Could not resolve a MoMo routing code for network "${payoutData.network}"`);
    }
    return { bankCode: match.code, recipientType: 'mobile_money', accountNumber: payoutData.phone, name: payoutData.accountName };
  }

  if (payoutData?.type === 'bank') {
    const nameLower = (payoutData.bankName || '').toLowerCase().trim();
    const match = banks.find((b) => b.type !== 'mobile_money' && b.name.toLowerCase().trim() === nameLower)
      || banks.find((b) => b.type !== 'mobile_money' && b.name.toLowerCase().includes(nameLower));
    if (!match) {
      throw new Error(`Could not resolve a bank routing code for "${payoutData.bankName}"`);
    }
    return { bankCode: match.code, recipientType: 'ghipss', accountNumber: payoutData.accountNumber, name: payoutData.accountName };
  }

  return null; // no saved preference — caller falls back to default MTN-via-phone behavior
}

module.exports = {
  initiateMomoCharge,
  initiateCardCharge,
  initializeCheckout,
  verifyTransaction,
  initiateTransfer,
  createTransferRecipient,
  resolvePayoutBankCode,
};
