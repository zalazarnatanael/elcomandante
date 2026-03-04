const { Octokit } = require("@octokit/rest");
const simpleGit = require("simple-git");
const { REPO_PATH, REPO_OWNER, REPO_NAME, LABELS } = require("./config/constants");
const { runOpenCode } = require("./services/aiService");
const { withRetry, classifyGithubError } = require("./services/githubRetry");
const { sendTelegramMessage } = require("./services/telegramNotify");
const { ensureWorktree } = require("./services/worktreeManager");
const { loadSession, saveSession, updateSessionWithComments, buildPlanPrompt } = require("./services/sessionContext");
require("dotenv").config();

function summarizeFeedback(items, maxLength = 500) {
    if (!items || items.length === 0) return "";
    const joined = items
        .map(item => `${item.author}: ${item.body.replace(/\s+/g, " ").trim()}`)
        .join(" | ");
    if (joined.length <= maxLength) return joined;
    return `${joined.slice(0, maxLength)}…`;
}

function extractNotionUrl(text) {
    if (!text) return null;
    const match = text.match(/https:\/\/www\.notion\.so\/[^\s)]+/i);
    return match ? match[0] : null;
}

function buildSummaryFromPlan(plan, maxItems = 5) {
    if (!plan) return [];
    const lines = plan.split("\n");
    const bullets = lines
        .map(line => line.trim())
        .filter(line => line.startsWith("- "))
        .map(line => line.replace(/^-\s+/, ""))
        .filter(Boolean);
    return bullets.slice(0, maxItems);
}

function buildPrBody(issue, plan) {
    const summaryItems = buildSummaryFromPlan(plan);
    const summaryLines = summaryItems.length > 0 ? summaryItems : [`Actualizar lo solicitado en #${issue.number}.`];
    const notionUrl = extractNotionUrl(issue.body);
    const notes = ["No se ejecutaron tests automáticos."];
    if (notionUrl) notes.push(`Notion: ${notionUrl}`);

    return `## Summary\n${summaryLines.map(item => `- ${item}`).join("\n")}\n\n## Notas\n${notes.map(item => `- ${item}`).join("\n")}\n\nResolves #${issue.number}`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function gitPushWithRetry(gitClient, remote, branch, options = {}) {
    const maxAttempts = Number(options.maxAttempts || 3);
    const baseDelayMs = Number(options.baseDelayMs || 800);
    let lastErr;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await gitClient.push(remote, branch, ["--force"]);
            return;
        } catch (err) {
            lastErr = err;
            if (attempt === maxAttempts) break;
            const delay = baseDelayMs * Math.pow(2, attempt - 1);
            await sleep(delay);
        }
    }

    throw lastErr;
}

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const git = simpleGit(REPO_PATH);

async function updateLabels(issueNumber, newLabels) {
    await withRetry(() => octokit.rest.issues.update({ owner: REPO_OWNER, repo: REPO_NAME, issue_number: issueNumber, labels: newLabels }));
}

async function getIssueLabels(issueNumber) {
    const { data: issue } = await withRetry(() => octokit.rest.issues.get({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        issue_number: issueNumber
    }));
    return (issue.labels || []).map(l => typeof l === "string" ? l : l.name).filter(Boolean);
}

async function addIssueLabel(issueNumber, labelToAdd) {
    const labels = await getIssueLabels(issueNumber);
    if (!labels.includes(labelToAdd)) labels.push(labelToAdd);
    await updateLabels(issueNumber, labels);
}

async function removeIssueLabel(issueNumber, labelToRemove) {
    const labels = await getIssueLabels(issueNumber);
    const next = labels.filter(l => l !== labelToRemove);
    await updateLabels(issueNumber, next);
}

async function hasPlanComment(issueNumber) {
    const { data: comments } = await withRetry(() => octokit.rest.issues.listComments({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        issue_number: issueNumber
    }));
    return comments.some(c => c.body && c.body.includes("### 📋 Plan"));
}

async function notifyFailure(issueNumber, stage, err, context = {}) {
    const info = classifyGithubError(err);
    const status = info.status || 'N/A';
    const requestId = info.requestId ? ` (request_id: ${info.requestId})` : '';
    const owner = context.owner || REPO_OWNER;
    const repo = context.repo || REPO_NAME;

    let body;
    if (info.isAuth) {
        body = `❌ No pude continuar en **${stage}** por autenticación inválida o expirada (status ${status}).${requestId}\nRevisar \`GITHUB_TOKEN\` del bot.`;
    } else if (info.status && info.isRetryable) {
        body = `⚠️ No pude continuar en **${stage}** por un error temporal de GitHub (status ${status}).${requestId}\nReintentar en unos minutos.`;
    } else if (info.status) {
        body = `❌ No pude continuar en **${stage}** (status ${status}).${requestId}`;
    } else {
        body = `❌ No pude continuar en **${stage}**: ${info.message}`;
    }

    try {
        await withRetry(() => octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: issueNumber,
            body
        }), { maxAttempts: 2, baseDelayMs: 400 });
    } catch (commentErr) {
        console.error(`⚠️ [NOTIFY] Fallo comentario en #${issueNumber}:`, commentErr.message);
    }

    const telegramMessage = `OpenClaw error | repo=${owner}/${repo} | issue=${issueNumber} | stage=${stage} | status=${status} | msg=${info.message}`;
    await sendTelegramMessage(telegramMessage);
}

async function runPlanFlow(issue) {
    console.log(`🧠 [PLAN] #${issue.number}`);
    let workingAdded = false;
    const sessionId = `ses-ferreteria-i${issue.number}-${Date.now()}`;
    const traceId = issue.traceId || "";
    try {
        try {
            await addIssueLabel(issue.number, LABELS.WORKING);
            workingAdded = true;
        } catch (e) {
            console.log(`⚠️ [PLAN] No se pudo agregar ${LABELS.WORKING} en #${issue.number}: ${e.message}`);
        }
        const isNew = issue.labels.some(l => l.name === LABELS.NEW);
        if (isNew && await hasPlanComment(issue.number)) {
            console.log(`ℹ️ [PLAN] Ya existe un plan para #${issue.number}. Se omite duplicado.`);
            await addIssueLabel(issue.number, LABELS.WAITING_HUMAN);
            return;
        }

        const { data: comments } = await withRetry(() => octokit.rest.issues.listComments({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            issue_number: issue.number
        }));

        const session = loadSession(issue.number);
        const prevFeedbackLen = session.feedback.length;
        updateSessionWithComments(session, comments);
        saveSession(issue.number, session);

        const newFeedback = session.feedback.slice(prevFeedbackLen);
        if (newFeedback.length > 0) {
            console.log(`🧩 [CONTEXT] ${issue.title}`);
            console.log(`🧩 [CONTEXT] Feedback: ${summarizeFeedback(newFeedback)}`);
        }

        const instruction = buildPlanPrompt(issue, session, isNew);

        const res = await runOpenCode(issue.number, instruction, false, { sessionId, continue: false, logSuffix: "plan", traceId });
        session.plans.push({
            createdAt: new Date().toISOString(),
            body: res
        });
        saveSession(issue.number, session);
        if (isNew && await hasPlanComment(issue.number)) {
            console.log(`ℹ️ [PLAN] Plan ya publicado durante ejecución para #${issue.number}.`);
            await addIssueLabel(issue.number, LABELS.WAITING_HUMAN);
            await removeIssueLabel(issue.number, LABELS.WAITING_IA);
            await removeIssueLabel(issue.number, LABELS.NEW);
            await removeIssueLabel(issue.number, LABELS.WORKING);
            return;
        }
        await withRetry(() => octokit.rest.issues.createComment({ owner: REPO_OWNER, repo: REPO_NAME, issue_number: issue.number, body: res }));
        await addIssueLabel(issue.number, LABELS.WAITING_HUMAN);
        await removeIssueLabel(issue.number, LABELS.WAITING_IA);
        await removeIssueLabel(issue.number, LABELS.NEW);
    } catch (err) {
        console.error(`❌ Error en #${issue.number}:`, err.message);
        await notifyFailure(issue.number, 'PLAN', err);
    } finally {
        if (workingAdded) {
            try {
                await removeIssueLabel(issue.number, LABELS.WORKING);
            } catch (e) {
                console.log(`⚠️ [PLAN] No se pudo remover ${LABELS.WORKING} en #${issue.number}: ${e.message}`);
            }
        }
    }
}

async function runBuildFlow(issue) {
    console.log(`🛠️ [BUILD] #${issue.number}`);
    let workingAdded = false;
    try {
        try {
            await addIssueLabel(issue.number, LABELS.WORKING);
            workingAdded = true;
        } catch (e) {
            console.log(`⚠️ [BUILD] No se pudo agregar ${LABELS.WORKING} en #${issue.number}: ${e.message}`);
        }
        const branch = `task/issue-${issue.number}`;

        const worktreePath = await ensureWorktree(issue.number, branch);
        console.log(`🧰 [WORKTREE] #${issue.number} -> ${worktreePath}`);
        const worktreeGit = simpleGit(worktreePath);
        await worktreeGit.checkout(branch).catch(() => {});
        const traceId = issue.traceId || "";

        const baseDiff = await git.status();
        if (baseDiff.files.length > 0) {
            const baseFiles = baseDiff.files.map(f => f.path).slice(0, 10);
            console.log(`⚠️ [BUILD] Cambios detectados en repo base (${baseDiff.files.length}). Se ignoran para evitar mezclas.`);
            if (baseFiles.length > 0) {
                console.log(`⚠️ [BUILD] Archivos en repo base: ${baseFiles.join(", ")}`);
            }
        }

        const { data: comments } = await withRetry(() => octokit.rest.issues.listComments({ owner: REPO_OWNER, repo: REPO_NAME, issue_number: issue.number }));
        const session = loadSession(issue.number);
        const lastPlan = session.plans.length > 0 ? session.plans[session.plans.length - 1].body : null;
        const plan = lastPlan || comments.reverse().find(c => c.body.includes("### 📋 Plan"))?.body || "Aplica cambios técnicos.";

        const planSummary = plan.replace(/\s+/g, " ").trim().slice(0, 500);
        console.log(`🧩 [CONTEXT] ${issue.title}`);
        console.log(`🧩 [CONTEXT] Plan: ${planSummary}${planSummary.length === 500 ? "…" : ""}`);

        const sessionId = `ses-ferreteria-i${issue.number}-${Date.now()}`;
        await runOpenCode(issue.number, `Sigue este plan:\n${plan}\n\nEJECUTA AHORA.`, true, { cwd: worktreePath, sessionId, continue: false, logSuffix: "build", traceId });

        const status = await worktreeGit.status();
        if (status.files.length > 0) {
            await worktreeGit.add("./*").commit(`feat: fix #${issue.number}`);
            try {
                console.log(`🚀 [GIT] Push branch ${branch}`);
                await gitPushWithRetry(worktreeGit, "origin", branch, { maxAttempts: 3, baseDelayMs: 1000 });
            } catch (pushErr) {
                console.error(`❌ Error push en #${issue.number}:`, pushErr.message);
                await notifyFailure(issue.number, 'BUILD', pushErr);
                return;
            }
            try {
                console.log(`🧾 [PR] Creando PR para ${branch}`);
                const prBody = buildPrBody(issue, plan);
                const { data: pr } = await withRetry(() => octokit.rest.pulls.create({
                    owner: REPO_OWNER,
                    repo: REPO_NAME,
                    title: `PR: ${issue.title}`,
                    head: branch,
                    base: "main",
                    body: prBody
                }));
                console.log(`✅ PR creado: ${pr.html_url}`);
            } catch (e) {
                try {
                    const { data: existingPrs } = await withRetry(() => octokit.rest.pulls.list({
                        owner: REPO_OWNER,
                        repo: REPO_NAME,
                        head: `${REPO_OWNER}:${branch}`,
                        state: "open"
                    }));
                    const existing = existingPrs[0];
                    if (existing) {
                        const body = existing.body || "";
                        if (!body.includes(`Resolves #${issue.number}`) || !body.includes("## Summary")) {
                            const prBody = buildPrBody(issue, plan);
                            const mergedBody = body ? `${prBody}\n\n---\n\n${body}` : prBody;
                            await withRetry(() => octokit.rest.pulls.update({
                                owner: REPO_OWNER,
                                repo: REPO_NAME,
                                pull_number: existing.number,
                                body: mergedBody.trim()
                            }));
                        }
                        console.log(`✅ PR existente: ${existing.html_url}`);
                    } else {
                        console.log("PR ya existe.");
                    }
                } catch (inner) {
                    console.log("PR ya existe.");
                }
            }
        } else {
            const noChangesMsg = "⚠️ No se detectaron cambios para aplicar en este issue.";
            console.log(`⚠️ [BUILD] ${noChangesMsg}`);
            try {
                await withRetry(() => octokit.rest.issues.createComment({
                    owner: REPO_OWNER,
                    repo: REPO_NAME,
                    issue_number: issue.number,
                    body: noChangesMsg
                }));
            } catch (e) {
                console.log(`⚠️ [BUILD] No se pudo comentar en #${issue.number}: ${e.message}`);
            }
            return;
        }
        await updateLabels(issue.number, [LABELS.DONE]);
    } catch (err) {
        console.error(`❌ Error en #${issue.number}:`, err.message);
        await notifyFailure(issue.number, 'BUILD', err);
    } finally {
        if (workingAdded) {
            try {
                await removeIssueLabel(issue.number, LABELS.WORKING);
            } catch (e) {
                console.log(`⚠️ [BUILD] No se pudo remover ${LABELS.WORKING} en #${issue.number}: ${e.message}`);
            }
        }
    }
}

module.exports = { runPlanFlow, runBuildFlow, notifyFailure };
