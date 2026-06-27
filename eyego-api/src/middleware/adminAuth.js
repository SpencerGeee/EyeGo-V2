'use strict';

const env = require('../config/env');
const { AuthError } = require('../utils/errors');

const authenticateAdmin = (req, res, next) => {
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== env.ADMIN_SECRET_KEY) {
    throw new AuthError('Invalid admin credentials');
  }
  next();
};

module.exports = authenticateAdmin;
