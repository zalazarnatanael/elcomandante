const path = require("path");
require("dotenv").config();

module.exports = {
    REPO_PATH: path.join(process.env.HOME, "openclaw-workspace/repos/v0-ferreteria"),
    REPO_OWNER: "zalazarnatanael",
    REPO_NAME: "v0-ferreteria",
    WORKTREE_ROOT: process.env.WORKTREE_ROOT || path.join(process.env.HOME, "openclaw-workspace/worktrees/v0-ferreteria"),
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || process.env.OPENCLAW_TELEGRAM_CHAT_ID || "",
    VPS_URL: process.env.VPS_URL || "http://TU_IP_PUBLICA:3000", // Cambia esto por tu IP
    LABELS: {
        NEW: "from-notion",
        WAITING_HUMAN: "awaiting-human-intervention",
        WAITING_IA: "awaiting-ia-intervention",
        READY: "ready-for-development",
        WORKING: "bot-working",
        DONE: "pr-generated"
    }
};
