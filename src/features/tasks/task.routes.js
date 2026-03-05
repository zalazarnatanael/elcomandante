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
 *     security:
 *       - bearerAuth: []
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
  *         content:
  *           application/json:
  *             examples:
  *               success:
  *                 value:
  *                   - id: "task-1"
  *                     project_id: "proyecto-1"
  *                     github_issue_number: 42
  *                     task_type: "sync"
  *                     status: "pending"
 */
router.get('/', requireRole(['admin', 'viewer']), validate(listTasksSchema), controller.listTasks);

/**
 * @openapi
 * /api/tasks/{id}:
 *   get:
 *     summary: Get task by id
 *     tags:
 *       - Tasks
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Task
  *         content:
  *           application/json:
  *             examples:
  *               success:
  *                 value:
  *                   id: "task-1"
  *                   project_id: "proyecto-1"
  *                   github_issue_number: 42
  *                   task_type: "sync"
  *                   status: "pending"
 */
router.get('/:id', requireRole(['admin', 'viewer']), validate(getTaskSchema), controller.getTask);

/**
 * @openapi
 * /api/tasks/retry/{id}:
 *   post:
 *     summary: Retry task
 *     tags:
 *       - Tasks
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Task retried
  *         content:
  *           application/json:
  *             examples:
  *               success:
  *                 value:
  *                   id: "task-1"
  *                   project_id: "proyecto-1"
  *                   github_issue_number: 42
  *                   task_type: "sync"
  *                   status: "pending"
 */
router.post('/retry/:id', requireRole(['admin']), validate(retryTaskSchema), controller.retryTask);

module.exports = router;
