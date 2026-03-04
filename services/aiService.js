const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { REPO_PATH, WORKTREE_ROOT, ALLOWED_EDIT_PATHS } = require("../config/constants");

const LOGS_DIR = path.join(__dirname, "../session_logs");
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

async function runOpenCode(issueNumber, instruction, isProgrammer = false, options = {}) {
    const sessionId = options.sessionId || `ses-ferreteria-i${issueNumber}`;
    const baseCmd = isProgrammer ? `opencode --agent build run` : `opencode run`;
    const cwd = options.cwd || REPO_PATH;
    const allowedRoots = ALLOWED_EDIT_PATHS || [WORKTREE_ROOT].filter(Boolean);
    if (allowedRoots.length > 0) {
        const isAllowed = allowedRoots.some(root => cwd.startsWith(root));
        if (!isAllowed) {
            throw new Error(`CWD no permitido para edición: ${cwd}`);
        }
    }
    const tempPath = path.join(cwd, `.prompt-${issueNumber}.txt`);
    
    fs.writeFileSync(tempPath, instruction);

    return new Promise((resolve) => {
        const sessionArgs = options.continue === false ? "" : ` --session "${sessionId}" --continue`;
        const command = `${baseCmd} "$(cat ${tempPath})"${sessionArgs} --dir "${cwd}"`;
        const proc = spawn(command, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: true });
        
        let history = "";
        proc.stdout.on('data', (d) => { history += d; process.stdout.write(d); });
        proc.stderr.on('data', (d) => { history += d; process.stderr.write(d); });
        
        proc.on("close", () => {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            const suffix = options.logSuffix ? `.${options.logSuffix}` : "";
            const logFile = path.join(LOGS_DIR, `issue-${issueNumber}${suffix}.log`);
            const traceHeader = options.traceId ? `\n--- TRACE: ${options.traceId} ---\n` : "\n";
            fs.appendFileSync(logFile, `\n\n--- EXEC: ${new Date().toISOString()} ---${traceHeader}${history}\n`);
            resolve(cleanOutput(history));
        });
    });
}

function cleanOutput(text) {
    const noAnsi = text.replace(/\u001b\[[0-9;]*m/g, "");
    return noAnsi
        .split("\n")
        .filter(line => {
            const trimmed = line.trim();
            const dequoted = trimmed.replace(/^>\s*/, "");
            if (!trimmed) return false;
            if (dequoted === "build · gpt-5.2-codex") return false;
            if (dequoted === "programmer · gpt-5.2-codex") return false;
            if (/^(build|programmer) · /i.test(dequoted)) return false;
            if (/^¿?Quer[eé]s? que ejecute/i.test(dequoted)) return false;
            if (/^¿?Quieres que ejecute/i.test(dequoted)) return false;
            if (/^Necesito permiso para editar/i.test(dequoted)) return false;
            if (/^[✱→⚙]/.test(dequoted)) return false;
            if (/^Read\b/.test(dequoted)) return false;
            if (/^Grep\b/.test(dequoted)) return false;
            if (/^Glob\b/.test(dequoted)) return false;
            if (/apply_patch/i.test(dequoted)) return false;
            return true;
        })
        .join("\n")
        .trim();
}

module.exports = { runOpenCode };
