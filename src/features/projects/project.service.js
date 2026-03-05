const projectRepository = require('./project.repository');

async function listProjects() {
  return projectRepository.listProjects();
}

async function getProject(id) {
  return projectRepository.getProjectById(id);
}

async function createProject(payload) {
  const record = {
    ...payload,
    updated_at: new Date().toISOString()
  };
  return projectRepository.createProject(record);
}

async function updateProject(id, payload) {
  const record = {
    ...payload,
    updated_at: new Date().toISOString()
  };
  return projectRepository.updateProject(id, record);
}

async function deleteProject(id) {
  return projectRepository.deleteProject(id);
}

module.exports = {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject
};
