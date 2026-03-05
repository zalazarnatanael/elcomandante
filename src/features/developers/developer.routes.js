const express = require('express');
const controller = require('./developer.controller');
const { requireRole } = require('../../shared/middlewares/requireRole');
const { validate } = require('../../shared/utils/validate');
const { upsertDeveloperSchema, getDeveloperSchema, deleteDeveloperSchema } = require('./developer.schema');

const router = express.Router();

/**
 * @openapi
 * /api/developers:
 *   get:
 *     summary: List developers
 *     tags:
 *       - Developers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of developers
  *         content:
  *           application/json:
  *             examples:
  *               success:
  *                 value:
  *                   - github_username: "dev-1"
  *                     commit_name: "Dev One"
  *                     commit_email: "dev-1@users.noreply.github.com"
  *                     is_active: true
 */
router.get('/', requireRole(['admin', 'viewer']), controller.listDevelopers);

/**
 * @openapi
 * /api/developers/{username}:
 *   get:
 *     summary: Get developer by username
 *     tags:
 *       - Developers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Developer
  *         content:
  *           application/json:
  *             examples:
  *               success:
  *                 value:
  *                   github_username: "dev-1"
  *                   commit_name: "Dev One"
  *                   commit_email: "dev-1@users.noreply.github.com"
  *                   is_active: true
 */
router.get('/:username', requireRole(['admin', 'viewer']), validate(getDeveloperSchema), controller.getDeveloper);

/**
 * @openapi
 * /api/developers:
 *   post:
 *     summary: Create or update developer
 *     tags:
 *       - Developers
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [github_username]
 *             properties:
 *               github_username: { type: string }
 *               token: { type: string }
 *               commit_name: { type: string }
 *               commit_email: { type: string }
 *               is_active: { type: boolean }
 *               notes: { type: string }
 *     responses:
 *       200:
 *         description: Developer upserted
  *         content:
  *           application/json:
  *             examples:
  *               success:
  *                 value:
  *                   github_username: "dev-1"
  *                   commit_name: "Dev One"
  *                   commit_email: "dev-1@users.noreply.github.com"
  *                   is_active: true
 */
router.post('/', requireRole(['admin']), validate(upsertDeveloperSchema), controller.upsertDeveloper);

/**
 * @openapi
 * /api/developers/{username}:
 *   put:
 *     summary: Update developer
 *     tags:
 *       - Developers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Developer updated
  *         content:
  *           application/json:
  *             examples:
  *               success:
  *                 value:
  *                   github_username: "dev-1"
  *                   commit_name: "Dev One"
  *                   commit_email: "dev-1@users.noreply.github.com"
  *                   is_active: true
 */
router.put('/:username', requireRole(['admin']), validate(upsertDeveloperSchema), controller.upsertDeveloper);

/**
 * @openapi
 * /api/developers/{username}:
 *   delete:
 *     summary: Delete developer
 *     tags:
 *       - Developers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Developer deleted
 */
router.delete('/:username', requireRole(['admin']), validate(deleteDeveloperSchema), controller.deleteDeveloper);

module.exports = router;
