const express = require('express');
const controller = require('./task.controller');
const { requireRole } = require('../../shared/middlewares/requireRole');
const { validate } = require('../../shared/utils/validate');
const { listTasksSchema, getTaskSchema, retryTaskSchema } = require('./task.schema');

const router = express.Router();

/**
 * @openapi
 * /api/tasks:
 *   get:
 *     summary: List tasks
 *     tags:
 *       - Tasks
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: project_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: github_issue_number
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of tasks
 */
router.get('/', requireRole(['admin', 'viewer']), validate(listTasksSchema), controller.listTasks);

/**
 * @openapi
 * /api/tasks/{id}:
 *   get:
 *     summary: Get task by id
 *     tags:
 *       - Tasks
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Task
 */
router.get('/:id', requireRole(['admin', 'viewer']), validate(getTaskSchema), controller.getTask);

/**
 * @openapi
 * /api/tasks/retry/{id}:
 *   post:
 *     summary: Retry task
 *     tags:
 *       - Tasks
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Task retried
 */
router.post('/retry/:id', requireRole(['admin']), validate(retryTaskSchema), controller.retryTask);

module.exports = router;
