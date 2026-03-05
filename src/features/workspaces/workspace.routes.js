const express = require('express');
const controller = require('./workspace.controller');
const { requireRole } = require('../../shared/middlewares/requireRole');
const { validate } = require('../../shared/utils/validate');
const { createWorkspaceSchema, updateWorkspaceSchema, getWorkspaceSchema } = require('./workspace.schema');

const router = express.Router();

/**
 * @openapi
 * /api/workspaces:
 *   get:
 *     summary: List Notion workspaces
 *     tags:
 *       - Workspaces
 *     responses:
 *       200:
 *         description: List of workspaces
 */
router.get('/', requireRole(['admin', 'viewer']), controller.listWorkspaces);

/**
 * @openapi
 * /api/workspaces/{id}:
 *   get:
 *     summary: Get Notion workspace
 *     tags:
 *       - Workspaces
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Workspace
 */
router.get('/:id', requireRole(['admin', 'viewer']), validate(getWorkspaceSchema), controller.getWorkspace);

/**
 * @openapi
 * /api/workspaces:
 *   post:
 *     summary: Create Notion workspace
 *     tags:
 *       - Workspaces
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [workspace_id, workspace_name, api_key]
 *             properties:
 *               workspace_id: { type: string }
 *               workspace_name: { type: string }
 *               api_key: { type: string }
 *               is_active: { type: boolean }
 *               notes: { type: string }
 *     responses:
 *       201:
 *         description: Workspace created
 */
router.post('/', requireRole(['admin']), validate(createWorkspaceSchema), controller.createWorkspace);

/**
 * @openapi
 * /api/workspaces/{id}:
 *   put:
 *     summary: Update Notion workspace
 *     tags:
 *       - Workspaces
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Workspace updated
 */
router.put('/:id', requireRole(['admin']), validate(updateWorkspaceSchema), controller.updateWorkspace);

/**
 * @openapi
 * /api/workspaces/{id}:
 *   delete:
 *     summary: Delete Notion workspace
 *     tags:
 *       - Workspaces
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Workspace deleted
 */
router.delete('/:id', requireRole(['admin']), validate(getWorkspaceSchema), controller.deleteWorkspace);

module.exports = router;
