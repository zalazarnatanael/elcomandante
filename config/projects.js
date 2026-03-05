require("dotenv").config();

function buildProjectConfig(id, options) {
  return {
    id,
    name: options.name,
    github: {
      owner: options.githubOwner,
      repo: options.githubRepo
    },
    // NOTE: Notion workspaces are now loaded dynamically from Supabase
    // See: services/notionCredentialsManager.js
    repoPath: options.repoPath,
    worktreeRoot: options.worktreeRoot,
    models: {
      planning: {
        simple: options.planModelSimple,
        medium: options.planModelMedium,
        complex: options.planModelComplex
      },
      build: {
        simple: options.buildModelSimple,
        medium: options.buildModelMedium,
        complex: options.buildModelComplex
      },
      classifier: options.classifierModel
    }
  };
}

const projects = {
  "proyecto-1": buildProjectConfig("proyecto-1", {
    name: process.env.PROJECT_1_NAME || "Proyecto 1",
    githubOwner: process.env.PROJECT_1_GITHUB_OWNER || "zalazarnatanael",
    githubRepo: process.env.PROJECT_1_GITHUB_REPO || "v0-ferreteria",
    repoPath: process.env.PROJECT_1_REPO_PATH || process.env.REPO_PATH,
    worktreeRoot: process.env.PROJECT_1_WORKTREE_ROOT || process.env.WORKTREE_ROOT,
    planModelSimple: process.env.PROJECT_1_PLAN_MODEL_SIMPLE || process.env.PLANNER_MODEL || "opencode/trinity-large-preview-free",
    planModelMedium: process.env.PROJECT_1_PLAN_MODEL_MEDIUM || process.env.PLANNER_MODEL || "opencode/trinity-large-preview-free",
    planModelComplex: process.env.PROJECT_1_PLAN_MODEL_COMPLEX || process.env.PLANNER_MODEL || "opencode/trinity-large-preview-free",
    buildModelSimple: process.env.PROJECT_1_BUILD_MODEL_SIMPLE || process.env.BUILD_MODEL || "github-copilot/claude-haiku-4.5",
    buildModelMedium: process.env.PROJECT_1_BUILD_MODEL_MEDIUM || process.env.BUILD_MODEL || "github-copilot/claude-haiku-4.5",
    buildModelComplex: process.env.PROJECT_1_BUILD_MODEL_COMPLEX || process.env.BUILD_MODEL || "github-copilot/claude-haiku-4.5",
    classifierModel: process.env.PROJECT_1_CLASSIFIER_MODEL || process.env.PLANNER_MODEL || "opencode/trinity-large-preview-free"
  }),
  "proyecto-2": buildProjectConfig("proyecto-2", {
    name: process.env.PROJECT_2_NAME || "Proyecto 2",
    githubOwner: process.env.PROJECT_2_GITHUB_OWNER,
    githubRepo: process.env.PROJECT_2_GITHUB_REPO,
    repoPath: process.env.PROJECT_2_REPO_PATH,
    worktreeRoot: process.env.PROJECT_2_WORKTREE_ROOT,
    planModelSimple: process.env.PROJECT_2_PLAN_MODEL_SIMPLE || process.env.PLANNER_MODEL || "opencode/trinity-large-preview-free",
    planModelMedium: process.env.PROJECT_2_PLAN_MODEL_MEDIUM || process.env.PLANNER_MODEL || "opencode/trinity-large-preview-free",
    planModelComplex: process.env.PROJECT_2_PLAN_MODEL_COMPLEX || process.env.PLANNER_MODEL || "opencode/trinity-large-preview-free",
    buildModelSimple: process.env.PROJECT_2_BUILD_MODEL_SIMPLE || process.env.BUILD_MODEL || "github-copilot/claude-haiku-4.5",
    buildModelMedium: process.env.PROJECT_2_BUILD_MODEL_MEDIUM || process.env.BUILD_MODEL || "github-copilot/claude-haiku-4.5",
    buildModelComplex: process.env.PROJECT_2_BUILD_MODEL_COMPLEX || process.env.BUILD_MODEL || "github-copilot/claude-haiku-4.5",
    classifierModel: process.env.PROJECT_2_CLASSIFIER_MODEL || process.env.PLANNER_MODEL || "opencode/trinity-large-preview-free"
  }),
  "proyecto-3": buildProjectConfig("proyecto-3", {
    name: process.env.PROJECT_3_NAME || "Proyecto 3",
    githubOwner: process.env.PROJECT_3_GITHUB_OWNER,
    githubRepo: process.env.PROJECT_3_GITHUB_REPO,
    repoPath: process.env.PROJECT_3_REPO_PATH,
    worktreeRoot: process.env.PROJECT_3_WORKTREE_ROOT,
    planModelSimple: process.env.PROJECT_3_PLAN_MODEL_SIMPLE || process.env.PLANNER_MODEL || "opencode/trinity-large-preview-free",
    planModelMedium: process.env.PROJECT_3_PLAN_MODEL_MEDIUM || process.env.PLANNER_MODEL || "opencode/trinity-large-preview-free",
    planModelComplex: process.env.PROJECT_3_PLAN_MODEL_COMPLEX || process.env.PLANNER_MODEL || "opencode/trinity-large-preview-free",
    buildModelSimple: process.env.PROJECT_3_BUILD_MODEL_SIMPLE || process.env.BUILD_MODEL || "github-copilot/claude-haiku-4.5",
    buildModelMedium: process.env.PROJECT_3_BUILD_MODEL_MEDIUM || process.env.BUILD_MODEL || "github-copilot/claude-haiku-4.5",
    buildModelComplex: process.env.PROJECT_3_BUILD_MODEL_COMPLEX || process.env.BUILD_MODEL || "github-copilot/claude-haiku-4.5",
    classifierModel: process.env.PROJECT_3_CLASSIFIER_MODEL || process.env.PLANNER_MODEL || "opencode/trinity-large-preview-free"
  }),
  "proyecto-4": buildProjectConfig("proyecto-4", {
    name: process.env.PROJECT_4_NAME || "Proyecto 4",
    githubOwner: process.env.PROJECT_4_GITHUB_OWNER,
    githubRepo: process.env.PROJECT_4_GITHUB_REPO,
    repoPath: process.env.PROJECT_4_REPO_PATH,
    worktreeRoot: process.env.PROJECT_4_WORKTREE_ROOT,
    planModelSimple: process.env.PROJECT_4_PLAN_MODEL_SIMPLE || process.env.PLANNER_MODEL || "opencode/trinity-large-preview-free",
    planModelMedium: process.env.PROJECT_4_PLAN_MODEL_MEDIUM || process.env.PLANNER_MODEL || "opencode/trinity-large-preview-free",
    planModelComplex: process.env.PROJECT_4_PLAN_MODEL_COMPLEX || process.env.PLANNER_MODEL || "opencode/trinity-large-preview-free",
    buildModelSimple: process.env.PROJECT_4_BUILD_MODEL_SIMPLE || process.env.BUILD_MODEL || "github-copilot/claude-haiku-4.5",
    buildModelMedium: process.env.PROJECT_4_BUILD_MODEL_MEDIUM || process.env.BUILD_MODEL || "github-copilot/claude-haiku-4.5",
    buildModelComplex: process.env.PROJECT_4_BUILD_MODEL_COMPLEX || process.env.BUILD_MODEL || "github-copilot/claude-haiku-4.5",
    classifierModel: process.env.PROJECT_4_CLASSIFIER_MODEL || process.env.PLANNER_MODEL || "opencode/trinity-large-preview-free"
  })
};

module.exports = {
  projects,
  buildProjectConfig
};
