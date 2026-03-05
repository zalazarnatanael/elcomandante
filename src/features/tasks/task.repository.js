const sql = require('../../shared/config/db');

async function listTasks(filters = {}) {
  const conditions = [];
  if (filters.status) conditions.push(sql`status = ${filters.status}`);
  if (filters.project_id) conditions.push(sql`project_id = ${filters.project_id}`);
  if (filters.github_issue_number !== undefined) {
    conditions.push(sql`github_issue_number = ${filters.github_issue_number}`);
  }

  const whereClause = conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
  const rows = await sql`
    SELECT *
    FROM tasks
    ${whereClause}
    ORDER BY created_at DESC
  `;
  return rows || [];
}

async function getTaskById(id) {
  const rows = await sql`SELECT * FROM tasks WHERE id = ${id} LIMIT 1`;
  return rows[0] || null;
}

async function updateTask(id, payload) {
  const rows = await sql`
    UPDATE tasks
    SET ${sql(payload)}
    WHERE id = ${id}
    RETURNING *
  `;
  return rows[0];
}

module.exports = {
  listTasks,
  getTaskById,
  updateTask
};
