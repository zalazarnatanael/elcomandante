const sql = require('../../shared/config/db');

async function listWorkspaces() {
  const rows = await sql`
    SELECT workspace_id, workspace_name, is_active, created_at, updated_at, notes
    FROM notion_workspaces
    ORDER BY created_at ASC
  `;
  return rows || [];
}

async function getWorkspace(workspaceId) {
  const rows = await sql`
    SELECT workspace_id, workspace_name, is_active, created_at, updated_at, notes
    FROM notion_workspaces
    WHERE workspace_id = ${workspaceId}
    LIMIT 1
  `;
  return rows[0] || null;
}

async function createWorkspace(payload) {
  const rows = await sql`
    INSERT INTO notion_workspaces ${sql(payload)}
    RETURNING workspace_id, workspace_name, is_active, created_at, updated_at, notes
  `;
  return rows[0];
}

async function updateWorkspace(workspaceId, payload) {
  const rows = await sql`
    UPDATE notion_workspaces
    SET ${sql(payload)}
    WHERE workspace_id = ${workspaceId}
    RETURNING workspace_id, workspace_name, is_active, created_at, updated_at, notes
  `;
  return rows[0];
}

async function deleteWorkspace(workspaceId) {
  await sql`DELETE FROM notion_workspaces WHERE workspace_id = ${workspaceId}`;
  return true;
}

module.exports = {
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace
};
