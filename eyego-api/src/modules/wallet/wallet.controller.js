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
  const wallet = await walletService.getWallet(driverId);
  ok(res, { balance: wallet.balance, currency: 'GHS', lastUpdated: new Date().toISOString() });
};

const getTransactions = async (req, res) => {
  const driverId = req.user?.userId;
  const wallet = await walletService.getWallet(driverId);
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;
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
  const { amount } = req.body;
  const result = await walletService.topUp(driverId, amount);
  ok(res, result, 'Top-up initiated. Check your phone for the MoMo prompt.');
};

const withdraw = async (req, res) => {
  const driverId = req.user?.userId;
  const { amount } = req.body;
  const result = await walletService.withdraw(driverId, amount);
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
