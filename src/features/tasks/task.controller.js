const taskService = require('./task.service');

async function listTasks(req, res) {
  try {
    const tasks = await taskService.listTasks(req.validated.query);
    return res.json(tasks);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function getTask(req, res) {
  try {
    const task = await taskService.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Not found' });
    return res.json(task);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function retryTask(req, res) {
  try {
    const task = await taskService.retryTask(req.params.id);
    return res.json(task);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

module.exports = {
  listTasks,
  getTask,
  retryTask
};
