const workspaceService = require('./workspace.service');

async function listWorkspaces(req, res) {
  try {
    const workspaces = await workspaceService.listWorkspaces();
    return res.json(workspaces);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function getWorkspace(req, res) {
  try {
    const workspace = await workspaceService.getWorkspace(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    return res.json(workspace);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function createWorkspace(req, res) {
  try {
    const workspace = await workspaceService.createWorkspace(req.validated.body);
    return res.status(201).json(workspace);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function updateWorkspace(req, res) {
  try {
    const workspace = await workspaceService.updateWorkspace(req.params.id, req.validated.body);
    return res.json(workspace);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function deleteWorkspace(req, res) {
  try {
    await workspaceService.deleteWorkspace(req.params.id);
    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

module.exports = {
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace
};
