const adminService = require('./admin.service');

async function getDashboardSummary(req, res) {
  try {
    const summary = await adminService.getDashboardSummary();
    return res.json(summary);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

module.exports = { getDashboardSummary };
