const sql = require('../config/db');

function requireRole(allowedRoles = []) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.sub || req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const rows = await sql`
        SELECT role
        FROM profiles
        WHERE id = ${userId}
        LIMIT 1
      `;

      const role = rows[0]?.role || 'viewer';
      if (!allowedRoles.length || allowedRoles.includes(role)) return next();
      return res.status(403).json({ error: 'Forbidden' });
    } catch (error) {
      return res.status(500).json({ error: 'Role lookup failed' });
    }
  };
}

module.exports = { requireRole };
