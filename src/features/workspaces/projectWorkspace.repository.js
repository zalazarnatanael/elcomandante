const sql = require('../../shared/config/db');

async function listProjectWorkspaces(projectId) {
  if (projectId) {
    const rows = await sql`
      SELECT *
      FROM project_notion_workspaces
      WHERE project_id = ${projectId}
      ORDER BY created_at ASC
    `;
    return rows || [];
  }
  const rows = await sql`
    SELECT *
    FROM project_notion_workspaces
    ORDER BY created_at ASC
  `;
  return rows || [];
}

async function createProjectWorkspace(payload) {
  const rows = await sql`
    INSERT INTO project_notion_workspaces ${sql(payload)}
    RETURNING *
  `;
  return rows[0];
}

async function deleteProjectWorkspace(id) {
  await sql`DELETE FROM project_notion_workspaces WHERE id = ${id}`;
  return true;
}

module.exports = {
  listProjectWorkspaces,
  createProjectWorkspace,
  deleteProjectWorkspace
};
