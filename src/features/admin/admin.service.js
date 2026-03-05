const projectRepository = require('../projects/project.repository');
const workspaceRepository = require('../workspaces/workspace.repository');
const developerRepository = require('../developers/developer.repository');
const taskRepository = require('../tasks/task.repository');

async function getDashboardSummary() {
  const [projects, workspaces, developers, tasks] = await Promise.all([
    projectRepository.listProjects(),
    workspaceRepository.listWorkspaces(),
    developerRepository.listDevelopers(),
    taskRepository.listTasks({})
  ]);

  return {
    counts: {
      projects: projects.length,
      workspaces: workspaces.length,
      developers: developers.length,
      tasks: tasks.length
    }
  };
}

module.exports = { getDashboardSummary };
