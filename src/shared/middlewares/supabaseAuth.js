const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
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

    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
      if (supabaseUrl && supabaseAnonKey) {
        const client = createClient(supabaseUrl, supabaseAnonKey, {
          auth: { persistSession: false, autoRefreshToken: false }
        });
        const { data, error } = await client.auth.getUser(token);
        if (error) {
          logger.warn('Supabase auth failed:', error.message);
          return res.status(403).json({ error: 'Forbidden' });
        }
        req.user = data.user;
        return next();
      }

      const secret = process.env.SUPABASE_JWT_SECRET;
      if (!secret) {
        logger.error('SUPABASE_JWT_SECRET not configured');
        return res.status(500).json({ error: 'Auth not configured' });
      }

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
