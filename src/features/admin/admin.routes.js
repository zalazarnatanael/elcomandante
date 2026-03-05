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
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Summary metrics
  *         content:
  *           application/json:
  *             examples:
  *               success:
  *                 value:
  *                   counts:
  *                     projects: 4
  *                     workspaces: 2
  *                     developers: 2
  *                     tasks: 12
 */
router.get('/summary', requireRole(['admin', 'viewer']), controller.getDashboardSummary);

module.exports = router;
