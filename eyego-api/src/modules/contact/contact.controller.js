'use strict';

const contactService = require('./contact.service');
const { ok } = require('../../utils/response');

const initiateCall = async (req, res) => {
  const { tripId, calleeRole } = req.body;
  const result = await contactService.initiateCall({
    callerId: req.user.userId || req.user.id,
    callerRole: req.user.role || 'PASSENGER',
    tripId,
    calleeRole,
  });
  ok(res, result, 'Call relay initiated');
};

const endCall = async (req, res) => {
  const result = await contactService.endCall(req.params.callId, req.user.userId || req.user.id);
  ok(res, { session: result }, 'Call ended');
};

module.exports = { initiateCall, endCall };
