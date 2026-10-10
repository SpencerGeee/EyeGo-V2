'use strict';

const contactService = require('./contact.service');
const { ok } = require('../../utils/response');

const initiateCall = async (req, res) => {
  const { tripId, calleeRole, calleeBookingId } = req.body;
  const result = await contactService.initiateCall({
    callerId: req.user.userId || req.user.id,
    callerRole: req.user.role || 'PASSENGER',
    tripId,
    calleeRole,
    calleeBookingId,
  });
  ok(res, result, 'Call relay initiated');
};

/** Africa's Talking voice callback — answers with XML, never JSON. */
const voiceCallback = async (req, res) => {
  res.type('application/xml').send(await contactService.voiceCallback(req.body));
};

const endCall = async (req, res) => {
  const result = await contactService.endCall(req.params.callId, req.user.userId || req.user.id);
  ok(res, { session: result }, 'Call ended');
};

module.exports = { initiateCall, endCall, voiceCallback };
