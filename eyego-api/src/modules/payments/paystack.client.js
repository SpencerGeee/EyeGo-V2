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

async function createTransferRecipient({ name, accountNumber, bankCode = '057' }) {
  // 057 = MTN Ghana MoMo bank code
  const { data } = await paystackHttp.post('/transferrecipient', {
    type: 'mobile_money',
    name,
    account_number: accountNumber,
    bank_code: bankCode,
    currency: 'GHS',
  });

  return data;
}

module.exports = {
  initiateMomoCharge,
  initiateCardCharge,
  initializeCheckout,
  verifyTransaction,
  initiateTransfer,
  createTransferRecipient,
};
