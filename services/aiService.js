const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { REPO_PATH } = require("../config/constants");

const LOGS_DIR = path.join(__dirname, "../session_logs");
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

async function runOpenCode(issueNumber, instruction, isProgrammer = false) {
    const sessionId = `ses-ferreteria-i${issueNumber}`;
    const baseCmd = isProgrammer ? `opencode --agent programmer run` : `opencode run`;
    const tempPath = path.join(REPO_PATH, `.prompt-${issueNumber}.txt`);
    
    fs.writeFileSync(tempPath, instruction);

    return new Promise((resolve) => {
        const command = `${baseCmd} "$(cat ${tempPath})" --session "${sessionId}" --continue`;
        const proc = spawn(command, { cwd: REPO_PATH, stdio: ["ignore", "pipe", "pipe"], shell: true });
        
        let history = "";
        proc.stdout.on('data', (d) => { history += d; process.stdout.write(d); });
        proc.stderr.on('data', (d) => { history += d; process.stderr.write(d); });
        
        proc.on("close", () => {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            const logFile = path.join(LOGS_DIR, `issue-${issueNumber}.log`);
            fs.appendFileSync(logFile, `\n\n--- EXEC: ${new Date().toISOString()} ---\n${history}\n`);
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
            return true;
        })
        .join("\n")
        .trim();
}

module.exports = { runOpenCode };
