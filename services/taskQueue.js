const { isDbConfigured } = require("./database");
const sql = require('../src/shared/config/db');

async function enqueuePersistentTask(task) {
  if (!isDbConfigured()) return null;
  const taskId = task.id || `task-${task.taskType}-${task.issueNumber || task.number || Date.now()}`;
  const payload = task.payload || {};
  const baseMetadata = task.metadata || {};
  await sql`
    INSERT INTO tasks (id, project_id, github_issue_number, task_type, repo_owner, repo_name, payload,
      github_issue_url, github_labels, notion_page_id, notion_status, last_event, last_event_at, status, updated_at)
    VALUES (
      ${taskId},
      ${task.projectId || null},
      ${task.issueNumber || task.number || null},
      ${task.taskType},
      ${task.owner || null},
      ${task.repo || null},
      ${payload},
      ${baseMetadata.github_issue_url || null},
      ${baseMetadata.github_labels || null},
      ${baseMetadata.notion_page_id || null},
      ${baseMetadata.notion_status || null},
      ${baseMetadata.last_event || null},
      ${baseMetadata.last_event_at || null},
      'pending',
      ${new Date().toISOString()}
    )
    ON CONFLICT (project_id, github_issue_number, task_type)
    DO UPDATE SET
      payload = EXCLUDED.payload,
      github_issue_url = EXCLUDED.github_issue_url,
      github_labels = EXCLUDED.github_labels,
      notion_page_id = EXCLUDED.notion_page_id,
      notion_status = EXCLUDED.notion_status,
      last_event = EXCLUDED.last_event,
      last_event_at = EXCLUDED.last_event_at,
      status = EXCLUDED.status,
      updated_at = EXCLUDED.updated_at
  `;
  return taskId;
}

async function updateTaskStatus(taskId, status, fields = {}) {
  if (!isDbConfigured()) return;
  const update = { status, updated_at: new Date().toISOString(), ...fields };
  await sql`
    UPDATE tasks
    SET ${sql(update)}
    WHERE id = ${taskId}
  `;
}

async function upsertTaskMetadata(fields) {
  if (!isDbConfigured()) return;
  const taskId = fields.id;
  if (!taskId) return;
  const update = { updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(fields)) {
    if (key === "id") continue;
    update[key] = value;
  }
  if (Object.keys(update).length <= 1) return;
  await sql`
    UPDATE tasks
    SET ${sql(update)}
    WHERE id = ${taskId}
  `;
}

async function fetchPendingTasks(limit = 50) {
  if (!isDbConfigured()) return [];
  const rows = await sql`
    SELECT *
    FROM tasks
    WHERE status IN ('pending', 'processing', 'failed')
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;
  return rows || [];
}

module.exports = {
  enqueuePersistentTask,
  updateTaskStatus,
  fetchPendingTasks,
  upsertTaskMetadata
};
