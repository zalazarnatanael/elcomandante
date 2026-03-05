const projectService = require('./project.service');

async function listProjects(req, res) {
  try {
    const projects = await projectService.listProjects();
    return res.json(projects);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function getProject(req, res) {
  try {
    const project = await projectService.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    return res.json(project);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function createProject(req, res) {
  try {
    const project = await projectService.createProject(req.validated.body);
    return res.status(201).json(project);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function updateProject(req, res) {
  try {
    const project = await projectService.updateProject(req.params.id, req.validated.body);
    return res.json(project);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function deleteProject(req, res) {
  try {
    await projectService.deleteProject(req.params.id);
    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

module.exports = {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject
};
