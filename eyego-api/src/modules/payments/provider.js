'use strict';

const crypto = require('crypto');
const logger = require('../../utils/logger');
const env = require('../../config/env');
const paystack = require('./paystack.client');

/**
 * THE ONE PLACE THAT KNOWS WHICH PAYMENT GATEWAY WE ARE ON.
 *
 * "you need to wire the top up wallet functionality end to end so when we have
 * the payment gateway, it's just a matter of updating the provider then
 * everything is done."
 *
 * Everything that moved money used to `require('./paystack.client')` directly —
 * the rider wallet routes, the driver wallet service, the payments service, the
 * webhook. Swapping gateway meant finding and editing every one of them, and
 * missing one meant a half-migrated system that charges through one provider and
 * reconciles against another. That is the failure this exists to make impossible.
 *
 * So: ONE module exports the gateway surface, every caller imports THIS, and
 * changing provider is changing `PAYMENT_PROVIDER` (or adding a second `impls`
 * entry). Nothing above this line has to know the name of a gateway.
 *
 * THE SURFACE IS THE CONTRACT. A new provider implements these seven functions
 * and returns Paystack's response SHAPE (`{ status, message, data }`, money in
 * SUBUNITS — pesewas for GHS). Normalising at the edge rather than at every call
 * site is what keeps `verifyTransaction(ref).data.status === 'success'` true
 * regardless of who is behind it.
 *
 * `mock` is not a test stub, it is the pre-gateway mode: it settles a charge
 * immediately and successfully, so the whole flow — intent row, poll, credit,
 * ledger, balance — can be exercised and demoed end to end before a merchant
 * account exists. It refuses to load unless the environment is explicitly
 * non-production, because a payment provider that always says "paid" is the
 * single most dangerous thing that could reach production by accident.
 */

const PROVIDER = String(env.PAYMENT_PROVIDER ?? 'paystack').toLowerCase();

// ── mock ─────────────────────────────────────────────────────────────────────

/** Live charges the mock has "accepted", keyed by reference. */
const mockCharges = new Map();

function mockRef() {
  return `mock_${crypto.randomBytes(8).toString('hex')}`;
}

const mock = {
  async initiateMomoCharge({ email, amountPesewas, phone, method, reference, metadata }) {
    const ref = reference || mockRef();
    mockCharges.set(ref, { amountPesewas, metadata: metadata ?? {}, email, phone, method });
    logger.warn(`[payments:mock] MoMo charge auto-accepted — ${ref} for ${amountPesewas} pesewas`);
    return {
      status: true,
      message: 'Charge attempted',
      data: { reference: ref, status: 'pay_offline', display_text: 'Mock provider — no prompt was sent.' },
    };
  },

  async initiateCardCharge({ amountPesewas, reference, metadata }) {
    const ref = reference || mockRef();
    mockCharges.set(ref, { amountPesewas, metadata: metadata ?? {} });
    return { status: true, message: 'Charge attempted', data: { reference: ref, status: 'success' } };
  },

  async initializeCheckout({ email, amountPesewas, reference, metadata }) {
    const ref = reference || mockRef();
    mockCharges.set(ref, { amountPesewas, metadata: metadata ?? {}, email });
    return {
      status: true,
      message: 'Authorization URL created',
      data: { reference: ref, authorization_url: `https://example.invalid/mock-checkout/${ref}`, access_code: ref },
    };
  },

  async verifyTransaction(reference) {
    const charge = mockCharges.get(reference);
    if (!charge) {
      // An unknown reference is "not paid", never "paid". A mock that invents
      // successes for references it has never seen would credit any string.
      return { status: true, message: 'Verification successful', data: { status: 'failed', reference, gateway_response: 'Unknown reference' } };
    }
    return {
      status: true,
      message: 'Verification successful',
      data: {
        status: 'success',
        reference,
        amount: charge.amountPesewas,
        currency: 'GHS',
        gateway_response: 'Approved by mock provider',
        metadata: charge.metadata,
        // Card-save flows check `authorization.reusable`.
        authorization: { reusable: true, last4: '4242', brand: 'visa', exp_month: '12', exp_year: '2099', authorization_code: `AUTH_${reference}` },
        customer: { email: charge.email ?? 'mock@eyego.app' },
      },
    };
  },

  async initiateTransfer({ amountPesewas, reference }) {
    return { status: true, message: 'Transfer queued', data: { reference: reference || mockRef(), status: 'success', amount: amountPesewas } };
  },

  async createTransferRecipient() {
    return { status: true, message: 'Recipient created', data: { recipient_code: `RCP_${crypto.randomBytes(6).toString('hex')}` } };
  },

  async resolvePayoutBankCode() {
    return 'MOCK';
  },
};

// ── selection ────────────────────────────────────────────────────────────────

const impls = { paystack, mock };

function pick() {
  const impl = impls[PROVIDER];
  if (!impl) {
    logger.error(`PAYMENT_PROVIDER="${PROVIDER}" is not a provider this build knows. Falling back to paystack.`);
    return paystack;
  }
  if (impl === mock && env.NODE_ENV === 'production') {
    // Hard failure, not a warning. A production server that accepts every
    // payment is worse than a production server that accepts none.
    throw new Error(
      'PAYMENT_PROVIDER=mock is refused in production. The mock provider marks every charge successful without taking money.',
    );
  }
  if (impl === mock) {
    logger.warn(
      '[payments] MOCK PROVIDER ACTIVE — every charge settles successfully and no money moves. ' +
        'Set PAYMENT_PROVIDER=paystack once the merchant account is live.',
    );
  }
  return impl;
}

const active = pick();

module.exports = {
  /** Which provider is serving this process. Useful in health output. */
  name: impls[PROVIDER] ? PROVIDER : 'paystack',
  /** True while charges settle without money moving. Never true in production. */
  isMock: active === mock,
  initiateMomoCharge: (...a) => active.initiateMomoCharge(...a),
  initiateCardCharge: (...a) => active.initiateCardCharge(...a),
  initializeCheckout: (...a) => active.initializeCheckout(...a),
  verifyTransaction: (...a) => active.verifyTransaction(...a),
  initiateTransfer: (...a) => active.initiateTransfer(...a),
  createTransferRecipient: (...a) => active.createTransferRecipient(...a),
  resolvePayoutBankCode: (...a) => active.resolvePayoutBankCode(...a),
};
