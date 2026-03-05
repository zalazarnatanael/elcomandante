const taskRepository = require('./task.repository');

async function listTasks(filters) {
  const normalized = { ...filters };
  if (filters.github_issue_number !== undefined) {
    normalized.github_issue_number = filters.github_issue_number;
  }
  return taskRepository.listTasks(normalized);
}

async function getTask(id) {
  return taskRepository.getTaskById(id);
}

async function retryTask(id) {
  const record = {
    status: 'pending',
    updated_at: new Date().toISOString()
  };
  return taskRepository.updateTask(id, record);
}

module.exports = {
  listTasks,
  getTask,
  retryTask
};
