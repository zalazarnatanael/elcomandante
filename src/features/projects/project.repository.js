const sql = require('../../shared/config/db');

async function listProjects() {
  const rows = await sql`SELECT * FROM projects ORDER BY created_at ASC`;
  return rows || [];
}

async function getProjectById(id) {
  const rows = await sql`SELECT * FROM projects WHERE id = ${id} LIMIT 1`;
  return rows[0] || null;
}

async function createProject(payload) {
  const rows = await sql`INSERT INTO projects ${sql(payload)} RETURNING *`;
  return rows[0];
}

async function updateProject(id, payload) {
  const rows = await sql`
    UPDATE projects
    SET ${sql(payload)}
    WHERE id = ${id}
    RETURNING *
  `;
  return rows[0];
}

async function deleteProject(id) {
  await sql`DELETE FROM projects WHERE id = ${id}`;
  return true;
}

module.exports = {
  listProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject
};
