function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    const role = req.user?.app_metadata?.role || req.user?.role || 'authenticated';
    if (!allowedRoles.length || allowedRoles.includes(role)) return next();
    return res.status(403).json({ error: 'Forbidden' });
  };
}

module.exports = { requireRole };
