'use strict';

const walletService = require('./wallet.service');
const { ok } = require('../../utils/response');

const getWallet = async (req, res) => {
  const driverId = req.user?.userId;
  const wallet = await walletService.getWallet(driverId);
  ok(res, wallet);
};

const getBalance = async (req, res) => {
  const driverId = req.user?.userId;
  // `getWallet` returns `balancePesewas`; this used to read `wallet.balance`,
  // a field that has not existed since the server moved to integer pesewas —
  // so /driver/wallet/balance answered `{ balance: undefined }` every time.
  const wallet = await walletService.getWallet(driverId, 1);
  ok(res, {
    balancePesewas: wallet.balancePesewas,
    currency: 'GHS',
    lastUpdated: new Date().toISOString(),
  });
};

const getTransactions = async (req, res) => {
  const driverId = req.user?.userId;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;
  const wallet = await walletService.getWallet(driverId, page * limit);
  const start = (page - 1) * limit;
  const items = wallet.transactions.slice(start, start + limit);
  ok(res, {
    items,
    total: wallet.transactions.length,
    page,
    limit,
    totalPages: Math.ceil(wallet.transactions.length / limit),
  });
};

const topUp = async (req, res) => {
  const driverId = req.user?.userId;
  // PESEWAS, like everywhere else on this server. This used to read `amount`
  // and hand it straight to `assertPesewas`, so a driver sending cedis (which
  // is what the route's own `isFloat({ min: 1 })` validator asked for) was
  // rejected as a non-integer, and one sending pesewas failed the validator.
  // There was no value that worked.
  const { amountPesewas, method } = req.body;
  const result = await walletService.topUp(driverId, amountPesewas, { method });
  ok(
    res,
    result,
    result.simulated
      ? result.message
      : 'Top-up started. Check your phone for the MoMo prompt.',
  );
};

const withdraw = async (req, res) => {
  const driverId = req.user?.userId;
  // Same unit mismatch as topUp above — the driver app has always sent
  // `amountPesewas` (see drivers.api.ts), so `amount` was undefined and the
  // route's own validator rejected every withdrawal before it got here.
  const { amountPesewas } = req.body;
  const result = await walletService.withdraw(driverId, amountPesewas);
  ok(res, result);
};

const getPayoutAccount = async (req, res) => {
  const driverId = req.user?.userId;
  const account = await walletService.getPayoutAccount(driverId);
  ok(res, account ?? {});
};

const updatePayoutAccount = async (req, res) => {
  const driverId = req.user?.userId;
  const account = await walletService.updatePayoutAccount(driverId, req.body);
  ok(res, account, 'Payout account updated');
};

module.exports = { getWallet, getBalance, getTransactions, topUp, withdraw, getPayoutAccount, updatePayoutAccount };
