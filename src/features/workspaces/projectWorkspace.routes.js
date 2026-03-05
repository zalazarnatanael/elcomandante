const express = require('express');
const controller = require('./projectWorkspace.controller');
const { requireRole } = require('../../shared/middlewares/requireRole');
const { validate } = require('../../shared/utils/validate');
const { createProjectWorkspaceSchema, deleteProjectWorkspaceSchema } = require('./projectWorkspace.schema');

const router = express.Router();

/**
 * @openapi
 * /api/project-workspaces:
 *   get:
 *     summary: List project-workspace mappings
 *     tags:
 *       - ProjectWorkspaces
 *     parameters:
 *       - in: query
 *         name: projectId
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of mappings
 */
router.get('/', requireRole(['admin', 'viewer']), controller.listProjectWorkspaces);

/**
 * @openapi
 * /api/project-workspaces:
 *   post:
 *     summary: Create project-workspace mapping
 *     tags:
 *       - ProjectWorkspaces
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [project_id, notion_workspace_id]
 *             properties:
 *               project_id: { type: string }
 *               notion_workspace_id: { type: string }
 *               database_id: { type: string }
 *               is_primary: { type: boolean }
 *     responses:
 *       201:
 *         description: Mapping created
 */
router.post('/', requireRole(['admin']), validate(createProjectWorkspaceSchema), controller.createProjectWorkspace);

/**
 * @openapi
 * /api/project-workspaces/{id}:
 *   delete:
 *     summary: Delete project-workspace mapping
 *     tags:
 *       - ProjectWorkspaces
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Mapping deleted
 */
router.delete('/:id', requireRole(['admin']), validate(deleteProjectWorkspaceSchema), controller.deleteProjectWorkspace);

module.exports = router;
