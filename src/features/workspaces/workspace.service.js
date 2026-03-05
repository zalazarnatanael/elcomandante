const workspaceRepository = require('./workspace.repository');
const { encrypt } = require('../../../services/encryptionService');

async function listWorkspaces() {
  return workspaceRepository.listWorkspaces();
}

async function getWorkspace(id) {
  return workspaceRepository.getWorkspace(id);
}

async function createWorkspace(payload) {
  const record = {
    workspace_id: payload.workspace_id,
    workspace_name: payload.workspace_name,
    api_key_encrypted: encrypt(String(payload.api_key)),
    is_active: payload.is_active !== undefined ? payload.is_active : true,
    notes: payload.notes || null,
    created_by: payload.created_by || null,
    updated_at: new Date().toISOString()
  };
  return workspaceRepository.createWorkspace(record);
}

async function updateWorkspace(id, payload) {
  const record = {
    workspace_name: payload.workspace_name,
    is_active: payload.is_active,
    notes: payload.notes,
    updated_at: new Date().toISOString()
  };
  if (payload.api_key) {
    record.api_key_encrypted = encrypt(String(payload.api_key));
  }
  return workspaceRepository.updateWorkspace(id, record);
}

async function deleteWorkspace(id) {
  return workspaceRepository.deleteWorkspace(id);
}

module.exports = {
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace
};
