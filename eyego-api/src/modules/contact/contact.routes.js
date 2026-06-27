'use strict';

const { Router } = require('express');
const controller = require('./contact.controller');
const authenticate = require('../../middleware/auth');

const router = Router();

router.use(authenticate);

// POST /v1/contact/call — initiate an anonymized contact relay
router.post('/call', controller.initiateCall);

// POST /v1/contact/call/:callId/end — end a call session
router.post('/call/:callId/end', controller.endCall);

module.exports = router;
