const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const { extractBearerToken } = require('../../shared/middlewares/supabaseAuth');

const supabaseUrl = process.env.SUPABASE_URL || process.env.DATABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

function buildSupabaseClient() {
  if (!supabaseUrl) {
    throw new Error('DATABASE_URL not configured');
  }
  if (!supabaseAnonKey) {
    throw new Error('SUPABASE_ANON_KEY not configured');
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function signIn(req, res) {
  try {
    const client = buildSupabaseClient();
    const { email, password } = req.validated.body;
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: error.message });
    return res.json({
      access_token: data.session?.access_token,
      refresh_token: data.session?.refresh_token,
      expires_in: data.session?.expires_in,
      token_type: data.session?.token_type,
      user: data.user
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function getMe(req, res) {
  const token = extractBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return res.status(500).json({ error: 'Auth not configured' });

  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    return res.json({ user: decoded });
  } catch (error) {
    return res.status(403).json({ error: 'Forbidden' });
  }
}

async function refreshToken(req, res) {
  try {
    const client = buildSupabaseClient();
    const { refresh_token } = req.validated.body;
    const { data, error } = await client.auth.refreshSession({ refresh_token });
    if (error) return res.status(401).json({ error: error.message });
    return res.json({
      access_token: data.session?.access_token,
      refresh_token: data.session?.refresh_token,
      expires_in: data.session?.expires_in,
      token_type: data.session?.token_type,
      user: data.user
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function signOut(req, res) {
  try {
    const client = buildSupabaseClient();
    const { access_token, refresh_token } = req.validated.body;
    const { error } = await client.auth.signOut({
      accessToken: access_token,
      refreshToken: refresh_token
    });
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

module.exports = {
  signIn,
  getMe,
  refreshToken,
  signOut
};
