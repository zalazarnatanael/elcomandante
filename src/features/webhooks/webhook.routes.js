const express = require('express');
const controller = require('./webhook.controller');
const { verifyGithubSignature } = require('../../shared/middlewares/webhookSignature');

const router = express.Router();

/**
 * @openapi
 * /webhook:
 *   post:
 *     summary: GitHub webhook (default project)
 *     tags:
 *       - Webhooks
 *     responses:
 *       200:
 *         description: OK
 */
router.post('/', verifyGithubSignature, controller.handleWebhook);

/**
 * @openapi
 * /webhook/{projectId}:
 *   post:
 *     summary: GitHub webhook (project override)
 *     tags:
 *       - Webhooks
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.post('/:projectId', verifyGithubSignature, controller.handleWebhook);

module.exports = router;
