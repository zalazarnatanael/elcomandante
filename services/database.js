const sql = require('../src/shared/config/db');

function isDbConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

async function getProjectSecrets(projectId) {
  if (!isDbConfigured()) return [];
  const rows = await sql`
    SELECT key_name, encrypted_value
    FROM project_secrets
    WHERE project_id = ${projectId}
  `;
  return rows || [];
}

async function upsertProjectSecrets(projectId, secrets) {
  if (!isDbConfigured()) return 0;
  const rows = Object.entries(secrets).map(([key, encryptedValue]) => ({
    project_id: projectId,
    key_name: key,
    encrypted_value: encryptedValue,
    updated_at: new Date().toISOString()
  }));
  if (rows.length === 0) return 0;
  await sql`
    INSERT INTO project_secrets ${sql(rows)}
    ON CONFLICT (project_id, key_name)
    DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, updated_at = EXCLUDED.updated_at
  `;
  return rows.length;
}

async function insertPlanHistory(taskId, plan, complexity, attemptNumber) {
  if (!isDbConfigured()) return;
  await sql`
    INSERT INTO plan_history (task_id, plan_text, complexity, attempt_number)
    VALUES (${taskId}, ${plan}, ${complexity}, ${attemptNumber})
  `;
}

module.exports = {
  isDbConfigured,
  getProjectSecrets,
  upsertProjectSecrets,
  insertPlanHistory
};
