const path = require("path");
require("dotenv").config();

const { projects } = require("./projects");

const defaultProject = projects[process.env.DEFAULT_PROJECT_ID || "proyecto-1"] || projects["proyecto-1"];

module.exports = {
    REPO_PATH: defaultProject?.repoPath || path.join(process.env.HOME, "openclaw-workspace/repos/v0-ferreteria"),
    REPO_OWNER: defaultProject?.github?.owner || "zalazarnatanael",
    REPO_NAME: defaultProject?.github?.repo || "v0-ferreteria",
    WORKTREE_ROOT: defaultProject?.worktreeRoot || process.env.WORKTREE_ROOT || path.join(process.env.HOME, "openclaw-workspace/worktrees/v0-ferreteria"),
    ALLOWED_EDIT_PATHS: (process.env.ALLOWED_EDIT_PATHS || "")
        .split(",")
        .map(p => p.trim())
        .filter(Boolean),
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || process.env.OPENCLAW_TELEGRAM_CHAT_ID || "",
    VPS_URL: process.env.VPS_URL || "http://TU_IP_PUBLICA:3000",
    LABELS: {
        NEW: "from-notion",
        WAITING_HUMAN: "awaiting-human-intervention",
        WAITING_IA: "awaiting-ia-intervention",
        READY: "ready-for-development",
        WORKING: "bot-working",
        DONE: "pr-generated"
    }
};
