const sql = require('../../shared/config/db');

async function listDevelopers() {
  const rows = await sql`
    SELECT github_username, commit_name, commit_email, is_active, created_at, updated_at, notes
    FROM developer_credentials
    ORDER BY github_username ASC
  `;
  return rows || [];
}

async function getDeveloper(username) {
  const rows = await sql`
    SELECT github_username, commit_name, commit_email, is_active, created_at, updated_at, notes
    FROM developer_credentials
    WHERE github_username = ${username}
    LIMIT 1
  `;
  return rows[0] || null;
}

async function upsertDeveloper(payload) {
  const rows = await sql`
    INSERT INTO developer_credentials ${sql(payload)}
    ON CONFLICT (github_username)
    DO UPDATE SET
      api_token_encrypted = COALESCE(EXCLUDED.api_token_encrypted, developer_credentials.api_token_encrypted),
      commit_name = EXCLUDED.commit_name,
      commit_email = EXCLUDED.commit_email,
      is_active = EXCLUDED.is_active,
      notes = EXCLUDED.notes,
      updated_at = EXCLUDED.updated_at
    RETURNING github_username, commit_name, commit_email, is_active, created_at, updated_at, notes
  `;
  return rows[0];
}

async function deleteDeveloper(username) {
  await sql`DELETE FROM developer_credentials WHERE github_username = ${username}`;
  return true;
}

module.exports = {
  listDevelopers,
  getDeveloper,
  upsertDeveloper,
  deleteDeveloper
};
