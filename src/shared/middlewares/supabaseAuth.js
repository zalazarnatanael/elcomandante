const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

function extractBearerToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

function supabaseAuthMiddleware(options = {}) {
  const { allowUnauthenticated = false } = options;

  return async (req, res, next) => {
    const token = extractBearerToken(req);
    if (!token) {
      if (allowUnauthenticated) return next();
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) {
      logger.error('SUPABASE_JWT_SECRET not configured');
      return res.status(500).json({ error: 'Auth not configured' });
    }

    try {
      const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
      req.user = decoded;
    } catch (error) {
      logger.warn('Supabase auth failed:', error.message);
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

module.exports = {
  supabaseAuthMiddleware,
  extractBearerToken
};
