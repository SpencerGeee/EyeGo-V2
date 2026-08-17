'use strict';

const { formatGhs, assertPesewas, percentOf } = require('../../utils/money');

const cancellationService = require('./cancellation.service');
const { ok } = require('../../utils/response');

const getCancellationFee = async (req, res) => {
  const fee = await cancellationService.calculateCancellationFee(req.params.bookingId, req.user.userId);
  ok(res, { cancellationFeePesewas: fee });
};

const cancelBookingWithFee = async (req, res) => {
  const { reason, note } = req.body || {};
  const result = await cancellationService.cancelBookingWithFee(req.params.bookingId, req.user.userId, { reason, note });
  // A rider who covered a group holds one Booking per seat and cancels all of
  // them at once, so the message has to say how many — "Booking cancelled" for
  // four seats reads as though the other three are still live.
  const what = result.seatCount > 1 ? `${result.seatCount} seats cancelled` : 'Booking cancelled';
  ok(res, result, result.cancellationFeePesewas
    ? `${what}. ${formatGhs(result.cancellationFeePesewas)} cancellation fee applied.`
    : `${what}. Full refund processed.`);
};

const getReceipt = async (req, res) => {
  const receipt = await cancellationService.getReceipt(req.params.bookingId, req.user.userId);
  ok(res, { receipt });
};

const getUserReceipts = async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const result = await cancellationService.getUserReceipts(req.user.userId, Number(page), Number(limit));
  ok(res, result);
};

module.exports = {
  getCancellationFee,
  cancelBookingWithFee,
  getReceipt,
  getUserReceipts,
};
