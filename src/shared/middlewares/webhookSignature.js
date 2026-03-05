const crypto = require('crypto');

function verifyGithubSignature(req, res, next) {
  const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';
  const signature = req.headers['x-hub-signature-256'];
  if (!WEBHOOK_SECRET) {
    return res.status(500).send('Webhook secret not configured');
  }
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  const digest = Buffer.from('sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex'), 'utf8');
  const checksum = Buffer.from(signature || '', 'utf8');

  if (!signature || signature.length !== digest.length || !crypto.timingSafeEqual(digest, checksum)) {
    return res.status(401).send('Error de firma');
  }

  return next();
}

module.exports = { verifyGithubSignature };
