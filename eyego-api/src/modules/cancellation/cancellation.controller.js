'use strict';

const cancellationService = require('./cancellation.service');
const { ok } = require('../../utils/response');

const getCancellationFee = async (req, res) => {
  const fee = await cancellationService.calculateCancellationFee(req.params.bookingId, req.user.userId);
  ok(res, { cancellationFee: fee });
};

const cancelBookingWithFee = async (req, res) => {
  const { reason, note } = req.body || {};
  const result = await cancellationService.cancelBookingWithFee(req.params.bookingId, req.user.userId, { reason, note });
  ok(res, result, result.cancellationFee
    ? `Booking cancelled. GHS ${result.cancellationFee.toFixed(2)} cancellation fee applied.`
    : 'Booking cancelled. Full refund processed.');
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
