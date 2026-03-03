const path = require("path");

module.exports = {
    REPO_PATH: path.join(process.env.HOME, "openclaw-workspace/repos/v0-ferreteria"),
    REPO_OWNER: "zalazarnatanael",
    REPO_NAME: "v0-ferreteria",
    LABELS: {
        NEW: "from-notion",
        WAITING_HUMAN: "awaiting-human-intervention",
        WAITING_IA: "awaiting-ia-intervention",
        READY: "ready-for-development",
        WORKING: "bot-working",
        DONE: "pr-generated"
    }
};
