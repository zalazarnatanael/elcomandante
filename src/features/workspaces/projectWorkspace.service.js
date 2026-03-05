const projectWorkspaceRepository = require('./projectWorkspace.repository');

async function listProjectWorkspaces(projectId) {
  return projectWorkspaceRepository.listProjectWorkspaces(projectId);
}

async function createProjectWorkspace(payload) {
  const record = {
    project_id: payload.project_id,
    notion_workspace_id: payload.notion_workspace_id,
    database_id: payload.database_id || null,
    is_primary: Boolean(payload.is_primary),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  return projectWorkspaceRepository.createProjectWorkspace(record);
}

async function deleteProjectWorkspace(id) {
  return projectWorkspaceRepository.deleteProjectWorkspace(id);
}

module.exports = {
  listProjectWorkspaces,
  createProjectWorkspace,
  deleteProjectWorkspace
};
