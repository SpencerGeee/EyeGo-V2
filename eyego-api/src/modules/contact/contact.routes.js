'use strict';

const { Router } = require('express');
const controller = require('./contact.controller');
const { authenticateAny } = require('../../middleware/auth');

const router = Router();

// Africa's Talking voice callback (masked calling). Public — AT posts it — and
// answers only a fresh session named by its unguessable relay token. Must sit
// above the auth middleware below. See contact.service.voiceCallback.
router.post('/voice', controller.voiceCallback);

// Either party (rider or driver) on a trip may be the caller — reject only
// tokens with no valid role at all, not tokens belonging to the "wrong" app.
router.use(authenticateAny);

// POST /v1/contact/call — initiate an anonymized contact relay
router.post('/call', controller.initiateCall);

// POST /v1/contact/call/:callId/end — end a call session
router.post('/call/:callId/end', controller.endCall);

module.exports = router;
