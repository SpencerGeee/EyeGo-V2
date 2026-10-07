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

/**
 * EVERY FUNCTION HERE TAKES `amountPesewas` AND SENDS IT UNCHANGED.
 *
 * Paystack's `amount` field has always been in the currency's subunit —
 * pesewas for GHS — so this module used to end each call with
 * `Math.round(amount * 100)` to convert from the cedis the rest of the server
 * spoke. The server now speaks pesewas everywhere (see utils/money.js), so
 * those conversions are DELETED, not adjusted. Leaving one in would multiply a
 * real charge by a hundred.
 *
 * That is also why every parameter was renamed: a caller still passing
 * `{ amount }` now sends `amount: undefined`, which Paystack rejects outright.
 * The alternative — accepting both names — is how a 100× charge ships.
 */
const assertGatewayAmount = (amountPesewas, fn) => {
  if (!Number.isInteger(amountPesewas) || amountPesewas <= 0) {
    throw new Error(
      `${fn}: amountPesewas must be a positive integer number of pesewas, got ${amountPesewas}`,
    );
  }
};

/**
 * The network a Ghanaian mobile number belongs to, by prefix. Used when a
 * caller says only "MOMO" — the rider wallet did, so every live rider top-up
 * failed with "Unsupported MoMo method: MOMO".
 */
function momoMethodForPhone(phone) {
  const local = String(phone ?? '').replace(/\D/g, '').replace(/^233/, '').replace(/^0/, '');
  const p = local.slice(0, 2);
  if (['24', '54', '55', '59', '25', '53'].includes(p)) return 'MOMO_MTN';
  if (['20', '50'].includes(p)) return 'MOMO_TELECEL';
  if (['26', '56', '27', '57'].includes(p)) return 'MOMO_AIRTELTIGO';
  return null;
}

async function initiateMomoCharge({ email, amountPesewas, phone, method, reference, metadata = {} }) {
  assertGatewayAmount(amountPesewas, 'initiateMomoCharge');
  const provider = MOBILE_MONEY_PROVIDERS[method] ?? MOBILE_MONEY_PROVIDERS[momoMethodForPhone(phone)];
  if (!provider) throw new Error(`Unsupported MoMo method: ${method}`);


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

async function initiateCardCharge({ email, amountPesewas, authorizationCode, reference, metadata = {} }) {
  assertGatewayAmount(amountPesewas, 'initiateCardCharge');

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
async function initializeCheckout({ email, amountPesewas, reference, metadata = {} }) {
  assertGatewayAmount(amountPesewas, 'initializeCheckout');

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

/**
 * Send money back to the card or mobile-money account it came from.
 *
 * Paystack's /refund takes the ORIGINAL charge reference, not a customer id,
 * and `amount` in the minor unit — omit it for a full refund. Partial refunds
 * are the common support case (one seat off a five-seat booking), so it is
 * passed through explicitly whenever we have it.
 *
 * The call returns immediately with status `pending`: the money reaches the
 * cardholder days later, on the scheme's timetable, and Paystack confirms via
 * the `refund.processed` webhook. Callers must therefore treat a successful
 * response as "accepted", never as "settled".
 */
async function refundTransaction({ reference, amountPesewas, reason }) {
  const body = { transaction: reference };
  if (amountPesewas != null) {
    assertGatewayAmount(amountPesewas, 'refundTransaction');
    body.amount = amountPesewas;
  }
  if (reason) body.merchant_note = String(reason).slice(0, 250);

  const { data } = await paystackHttp.post('/refund', body);
  return data;
}

async function initiateTransfer({ amountPesewas, recipient, reason, reference }) {
  assertGatewayAmount(amountPesewas, 'initiateTransfer');

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

/**
 * Did Paystack receive this transfer, and how did it end? Used when the
 * initiate call itself failed without a clear answer (timeout, 5xx): the
 * transfer may still have gone out. 404 = Paystack never saw it.
 */
async function verifyTransfer(reference) {
  const { data } = await paystackHttp.get(`/transfer/verify/${encodeURIComponent(reference)}`);
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
/**
 * The app has saved the network as a label ("MTN MoMo"), the top-up enum
 * ("MOMO_MTN") and the key this file wanted ("MTN") at different times. Only
 * the last matched, so every MoMo payout account threw and every cash out
 * failed with "balance restored". Any spelling of the network now resolves.
 */
function momoNetworkKey(network) {
  const s = String(network ?? '');
  if (/mtn/i.test(s)) return 'MTN';
  if (/voda|telecel/i.test(s)) return 'TELECEL';
  if (/airtel|tigo/i.test(s)) return 'AIRTELTIGO';
  return null;
}

/**
 * "Ghana Commercial Bank" is "GCB Bank Limited" on Paystack, and "Ecobank" is
 * "Ecobank Ghana Limited": compare on the distinctive words only.
 */
const BANK_ALIASES = { ghanacommercial: 'gcb', uba: 'unitedforafrica', gtbank: 'guarantytrust', adb: 'agriculturaldevelopment' };
function bankKey(name) {
  const k = String(name ?? '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(bank|limited|ltd|plc|ghana|of|the|company)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');
  return BANK_ALIASES[k] ?? k;
}

async function resolvePayoutBankCode(payoutData) {
  const banks = await getGhanaBankList();

  if (payoutData?.type === 'momo') {
    const matcher = MOMO_NAME_MATCH[momoNetworkKey(payoutData.network)];
    const match = matcher && banks.find((b) => b.type === 'mobile_money' && matcher.test(b.name));
    if (!match) {
      throw new Error(`Could not resolve a MoMo routing code for network "${payoutData.network}"`);
    }
    return { bankCode: match.code, recipientType: 'mobile_money', accountNumber: payoutData.phone, name: payoutData.accountName };
  }

  if (payoutData?.type === 'bank') {
    const want = bankKey(payoutData.bankName);
    const nonMomo = banks.filter((b) => b.type !== 'mobile_money');
    const match = (want && nonMomo.find((b) => bankKey(b.name) === want))
      || (want.length >= 3 && nonMomo.find((b) => bankKey(b.name).startsWith(want) || want.startsWith(bankKey(b.name))));
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
  refundTransaction,
  initiateTransfer,
  verifyTransfer,
  createTransferRecipient,
  resolvePayoutBankCode,
  momoNetworkKey,
  bankKey,
  momoMethodForPhone,
};
