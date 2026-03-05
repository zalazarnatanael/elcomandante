const express = require('express');
const controller = require('./project.controller');
const { requireRole } = require('../../shared/middlewares/requireRole');
const { validate } = require('../../shared/utils/validate');
const { createProjectSchema, updateProjectSchema, getProjectSchema } = require('./project.schema');

const router = express.Router();

/**
 * @openapi
 * /api/projects:
 *   get:
 *     summary: List projects
 *     tags:
 *       - Projects
 *     responses:
 *       200:
 *         description: List of projects
 */
router.get('/', requireRole(['admin', 'viewer']), controller.listProjects);

/**
 * @openapi
 * /api/projects/{id}:
 *   get:
 *     summary: Get project by id
 *     tags:
 *       - Projects
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Project
 */
router.get('/:id', requireRole(['admin', 'viewer']), validate(getProjectSchema), controller.getProject);

/**
 * @openapi
 * /api/projects:
 *   post:
 *     summary: Create project
 *     tags:
 *       - Projects
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, github_owner, github_repo]
 *             properties:
 *               id: { type: string }
 *               name: { type: string }
 *               github_owner: { type: string }
 *               github_repo: { type: string }
 *               notion_database_id: { type: string }
 *               is_active: { type: boolean }
 *     responses:
 *       201:
 *         description: Project created
 */
router.post('/', requireRole(['admin']), validate(createProjectSchema), controller.createProject);

/**
 * @openapi
 * /api/projects/{id}:
 *   put:
 *     summary: Update project
 *     tags:
 *       - Projects
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Project updated
 */
router.put('/:id', requireRole(['admin']), validate(updateProjectSchema), controller.updateProject);

/**
 * @openapi
 * /api/projects/{id}:
 *   delete:
 *     summary: Delete project
 *     tags:
 *       - Projects
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Project deleted
 */
router.delete('/:id', requireRole(['admin']), validate(getProjectSchema), controller.deleteProject);

module.exports = router;
