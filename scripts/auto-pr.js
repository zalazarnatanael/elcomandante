const { Octokit } = require("@octokit/rest");
const simpleGit = require("simple-git");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
require("dotenv").config();

// ============================================================
// CONFIGURACIÓN
// ============================================================
const REPO_PATH = path.join(process.env.HOME, "openclaw-workspace/repos/v0-ferreteria");
const git = simpleGit(REPO_PATH);
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const REPO_OWNER = "zalazarnatanael";
const REPO_NAME = "v0-ferreteria";

const LABEL_NEW = "from-notion";
const LABEL_WAITING_HUMAN = "awaiting-human-intervention";
const LABEL_WAITING_IA = "awaiting-ia-intervention"; 
const LABEL_READY = "ready-for-development"; 
const LABEL_DONE = "pr-generated";

// ============================================================
// UTILIDADES
// ============================================================

function getSessionId(issueNumber) {
    return `ses-ferreteria-i${issueNumber}`;
}

async function runSpawn(commandString, cwd) {
    return new Promise((resolve) => {
        console.log(`\n🚀 EJECUTANDO: ${commandString}`);
        const proc = spawn(commandString, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: true });
        let logHistory = ""; 
        proc.stdout.on('data', (data) => { logHistory += data.toString(); process.stdout.write(data.toString()); });
        proc.stderr.on('data', (data) => { logHistory += data.toString(); process.stderr.write(data.toString()); });
        proc.on("close", (code) => resolve({ code, logHistory }));
        proc.on("error", (err) => resolve({ code: 1, logHistory: err.message }));
    });
}

async function runStep(issue, instruction, isBuild = false) {
    const sessionId = getSessionId(issue.number);
    const baseCmd = isBuild ? `opencode --agent programmer run` : `opencode run`;
    
    // Usamos archivo temporal para evitar errores de escape en Bash/Terminal
    const tempPromptPath = path.join(REPO_PATH, `.prompt-${issue.number}.txt`);
    fs.writeFileSync(tempPromptPath, instruction);

    const command = `${baseCmd} "$(cat ${tempPromptPath})" --session "${sessionId}" --continue`;
    const result = await runSpawn(command, REPO_PATH);
    
    if (fs.existsSync(tempPromptPath)) fs.unlinkSync(tempPromptPath);
    return result;
}

// ============================================================
// ORQUESTADOR DE FLUJO
// ============================================================

async function processIssues() {
    try {
        console.log("🔍 Escaneando repositorio...");

        // --- FASE 1: PLANIFICACIÓN INICIAL (from-notion) ---
        const { data: newIssues } = await octokit.rest.issues.listForRepo({ owner: REPO_OWNER, repo: REPO_NAME, labels: LABEL_NEW, state: "open" });
        for (const issue of newIssues) {
            console.log(`\n🧠 [PLAN] Creando propuesta para #${issue.number}`);
            const prompt = `Analiza el issue "${issue.title}": ${issue.body}. Genera un plan técnico detallado que empiece con '### 📋 Plan de Implementación'.`;
            const { logHistory } = await runStep(issue, prompt, false);
            
            if (logHistory.length > 50) {
                await octokit.rest.issues.createComment({ owner: REPO_OWNER, repo: REPO_NAME, issue_number: issue.number, body: `✨ **Plan Propuesto**\n\n${logHistory}` });
                await octokit.rest.issues.update({ owner: REPO_OWNER, repo: REPO_NAME, issue_number: issue.number, labels: [LABEL_WAITING_HUMAN] });
            }
        }

        // --- FASE 2: AJUSTE DE PLAN (awaiting-ia-intervention) ---
        const { data: iaIssues } = await octokit.rest.issues.listForRepo({ owner: REPO_OWNER, repo: REPO_NAME, labels: LABEL_WAITING_IA, state: "open" });
        for (const issue of iaIssues) {
            console.log(`\n🔄 [RE-PLAN] Procesando feedback para #${issue.number}`);
            const { data: comments } = await octokit.rest.issues.listComments({ owner: REPO_OWNER, repo: REPO_NAME, issue_number: issue.number });
            const lastUserComment = [...comments].reverse().find(c => !c.user.login.includes("github-actions"))?.body || "Revisa el plan.";
            
            const prompt = `El usuario dice: "${lastUserComment}". Actualiza el plan completo empezando con '### 📋 Plan de Acción Actualizado'.`;
            const { logHistory } = await runStep(issue, prompt, false);
            
            if (logHistory.length > 50) {
                await octokit.rest.issues.createComment({ owner: REPO_OWNER, repo: REPO_NAME, issue_number: issue.number, body: `🔄 **Revisión del Plan**\n\n${logHistory}` });
                await octokit.rest.issues.update({ owner: REPO_OWNER, repo: REPO_NAME, issue_number: issue.number, labels: [LABEL_WAITING_HUMAN] });
            }
        }

        // --- FASE 3: EJECUCIÓN (ready-for-development) ---
        const { data: readyIssues } = await octokit.rest.issues.listForRepo({ owner: REPO_OWNER, repo: REPO_NAME, labels: LABEL_READY, state: "open" });
        for (const issue of readyIssues) {
            console.log(`\n🛠️  [BUILD] Iniciando ejecución técnica para #${issue.number}`);
            const branchName = `task/issue-${issue.number}`;

            // 1. Recuperar el plan aprobado del historial
            const { data: comments } = await octokit.rest.issues.listComments({ owner: REPO_OWNER, repo: REPO_NAME, issue_number: issue.number });
            const planComment = [...comments].reverse().find(c => c.body.includes("### 📋 Plan"));
            const planText = planComment ? planComment.body : "Ejecuta los cambios técnicos según el issue.";

            // 2. Preparar entorno Git
            await git.checkout("main").catch(() => {});
            await git.pull().catch(() => {});
            await git.checkoutLocalBranch(branchName).catch(async () => {
                await git.checkout(branchName);
                await git.merge(['main']).catch(() => {});
            });

            // 3. Forzar ejecución del plan con el agente programmer
            const buildMsg = `Sigue este plan aprobado:\n${planText}\n\nEJECUCIÓN: Aplica los cambios en el código ahora usando write_file o replace_content. No hables, solo programa.`;
            await runStep(issue, buildMsg, true);

            // 4. Verificar cambios y crear/buscar PR
            const status = await git.status();
            if (status.files.length > 0) {
                await git.add("./*");
                await git.commit(`feat: solución #${issue.number}`);
                await git.push("origin", branchName, ["--force"]);
                
                let prUrl = "";
                try {
                    const { data: newPr } = await octokit.rest.pulls.create({ 
                        owner: REPO_OWNER, repo: REPO_NAME, title: `PR: ${issue.title}`, head: branchName, base: "main",
                        body: `Resuelve #${issue.number}\n\nPlan ejecutado automáticamente.`
                    });
                    prUrl = newPr.html_url;
                } catch (e) {
                    const { data: existingPrs } = await octokit.rest.pulls.list({ owner: REPO_OWNER, repo: REPO_NAME, head: `${REPO_OWNER}:${branchName}`, state: "open" });
                    if (existingPrs.length > 0) prUrl = existingPrs[0].html_url;
                }

                if (prUrl) {
                    console.log(`✅ PR LISTO: ${prUrl}`);
                    await octokit.rest.issues.createComment({ owner: REPO_OWNER, repo: REPO_NAME, issue_number: issue.number, body: `🚀 **Código aplicado.**\nRevisar PR: ${prUrl}` });
                }
            } else {
                console.log("⚠️ El agente no detectó cambios que realizar.");
            }

            await octokit.rest.issues.update({ owner: REPO_OWNER, repo: REPO_NAME, issue_number: issue.number, labels: [LABEL_DONE] });
            await git.checkout("main");
        }
    } catch (e) { console.error("❌ ERROR GENERAL:", e.message); }
}

processIssues();
