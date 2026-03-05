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
 *     responses:
 *       200:
 *         description: List of developers
 */
router.get('/', requireRole(['admin', 'viewer']), controller.listDevelopers);

/**
 * @openapi
 * /api/developers/{username}:
 *   get:
 *     summary: Get developer by username
 *     tags:
 *       - Developers
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Developer
 */
router.get('/:username', requireRole(['admin', 'viewer']), validate(getDeveloperSchema), controller.getDeveloper);

/**
 * @openapi
 * /api/developers:
 *   post:
 *     summary: Create or update developer
 *     tags:
 *       - Developers
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
 */
router.post('/', requireRole(['admin']), validate(upsertDeveloperSchema), controller.upsertDeveloper);

/**
 * @openapi
 * /api/developers/{username}:
 *   put:
 *     summary: Update developer
 *     tags:
 *       - Developers
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Developer updated
 */
router.put('/:username', requireRole(['admin']), validate(upsertDeveloperSchema), controller.upsertDeveloper);

/**
 * @openapi
 * /api/developers/{username}:
 *   delete:
 *     summary: Delete developer
 *     tags:
 *       - Developers
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
