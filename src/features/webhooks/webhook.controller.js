const webhookService = require('./webhook.service');

async function handleWebhook(req, res) {
  const result = await webhookService.handleWebhookEvent(req);
  return res.status(result.status).send(result.body);
}

module.exports = { handleWebhook };
