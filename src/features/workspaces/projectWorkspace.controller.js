const projectWorkspaceService = require('./projectWorkspace.service');

async function listProjectWorkspaces(req, res) {
  try {
    const records = await projectWorkspaceService.listProjectWorkspaces(req.query.projectId);
    return res.json(records);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function createProjectWorkspace(req, res) {
  try {
    const record = await projectWorkspaceService.createProjectWorkspace(req.validated.body);
    return res.status(201).json(record);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function deleteProjectWorkspace(req, res) {
  try {
    await projectWorkspaceService.deleteProjectWorkspace(req.params.id);
    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

module.exports = {
  listProjectWorkspaces,
  createProjectWorkspace,
  deleteProjectWorkspace
};
