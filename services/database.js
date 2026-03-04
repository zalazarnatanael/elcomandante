const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function isDbConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

const supabase = isDbConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

async function getProjectSecrets(projectId) {
  if (!isDbConfigured()) return [];
  const { data, error } = await supabase
    .from("project_secrets")
    .select("key_name, encrypted_value")
    .eq("project_id", projectId);
  if (error) throw error;
  return data || [];
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
  const { error } = await supabase
    .from("project_secrets")
    .upsert(rows, { onConflict: "project_id,key_name" });
  if (error) throw error;
  return rows.length;
}

async function insertPlanHistory(taskId, plan, complexity, attemptNumber) {
  if (!isDbConfigured()) return;
  const { error } = await supabase
    .from("plan_history")
    .insert({
      task_id: taskId,
      plan_text: plan,
      complexity,
      attempt_number: attemptNumber
    });
  if (error) throw error;
}

module.exports = {
  supabase,
  isDbConfigured,
  getProjectSecrets,
  upsertProjectSecrets,
  insertPlanHistory
};
