const { supabase, isDbConfigured } = require("./database");

async function enqueuePersistentTask(task) {
  if (!isDbConfigured()) return null;
  const taskId = task.id || `task-${task.taskType}-${task.issueNumber || task.number || Date.now()}`;
  const payload = task.payload || {};
  const baseMetadata = task.metadata || {};
  const { error } = await supabase
    .from("tasks")
    .upsert(
      {
        id: taskId,
        project_id: task.projectId || null,
        github_issue_number: task.issueNumber || task.number || null,
        task_type: task.taskType,
        repo_owner: task.owner || null,
        repo_name: task.repo || null,
        payload,
        github_issue_url: baseMetadata.github_issue_url || null,
        github_labels: baseMetadata.github_labels || null,
        notion_page_id: baseMetadata.notion_page_id || null,
        notion_status: baseMetadata.notion_status || null,
        last_event: baseMetadata.last_event || null,
        last_event_at: baseMetadata.last_event_at || null,
        status: "pending",
        updated_at: new Date().toISOString()
      },
      { onConflict: "project_id,github_issue_number,task_type" }
    );
  if (error) throw error;
  return taskId;
}

async function updateTaskStatus(taskId, status, fields = {}) {
  if (!isDbConfigured()) return;
  const update = { status, updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(fields)) {
    update[key] = value;
  }
  const { error } = await supabase.from("tasks").update(update).eq("id", taskId);
  if (error) throw error;
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
  const { error } = await supabase.from("tasks").update(update).eq("id", taskId);
  if (error) throw error;
}

async function fetchPendingTasks(limit = 50) {
  if (!isDbConfigured()) return [];
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .in("status", ["pending", "processing", "failed"])
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

module.exports = {
  enqueuePersistentTask,
  updateTaskStatus,
  fetchPendingTasks,
  upsertTaskMetadata
};
