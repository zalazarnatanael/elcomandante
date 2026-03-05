const express = require('express');
const controller = require('./admin.controller');
const { requireRole } = require('../../shared/middlewares/requireRole');

const router = express.Router();

/**
 * @openapi
 * /api/admin/summary:
 *   get:
 *     summary: Admin dashboard summary
 *     tags:
 *       - Admin
 *     responses:
 *       200:
 *         description: Summary metrics
 */
router.get('/summary', requireRole(['admin', 'viewer']), controller.getDashboardSummary);

module.exports = router;
