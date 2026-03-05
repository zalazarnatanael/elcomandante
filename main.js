const { Octokit } = require("@octokit/rest");
const simpleGit = require("simple-git");
const fs = require("fs");
const { REPO_PATH, REPO_OWNER, REPO_NAME, LABELS } = require("./config/constants");
const { projects } = require("./config/projects");
const { classifyComplexity } = require("./services/complexityService");
const { insertPlanHistory, getProjectSecrets, isDbConfigured } = require("./services/database");
const { decrypt } = require("./services/encryptionService");
const { runOpenCode } = require("./services/aiService");
const developerCredentialsManager = require("./services/developerCredentialsManager");
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
let gitClient = null;

function getGitClient() {
    if (gitClient) return gitClient;
    if (!REPO_PATH || !fs.existsSync(REPO_PATH)) {
        console.log(`⚠️ [GIT] REPO_PATH no existe: ${REPO_PATH}`);
        return null;
    }
    gitClient = simpleGit(REPO_PATH);
    return gitClient;
}

function resolveProjectConfig(input) {
    if (!input) return projects[process.env.DEFAULT_PROJECT_ID || "proyecto-1"] || projects["proyecto-1"];
    if (typeof input === "string") return projects[input];
    if (input.projectId && projects[input.projectId]) return projects[input.projectId];
    return input;
}

async function resolveAssigneeForIssue(issue, projectConfig, octokitClient) {
    const owner = projectConfig.github?.owner || REPO_OWNER;
    const repo = projectConfig.github?.repo || REPO_NAME;
    const issueNumber = issue.number;

    let assignees = issue.assignees || [];
    if (!assignees.length) {
        try {
            const { data } = await withRetry(() => octokitClient.rest.issues.get({
                owner,
                repo,
                issue_number: issueNumber
            }));
            assignees = data.assignees || [];
        } catch (error) {
            console.log(`⚠️ [ASSIGNEE] No se pudo obtener assignee de #${issueNumber}: ${error.message}`);
        }
    }

    if (!assignees.length) return null;

    const assignee = assignees[0];
    return assignee?.login || null;
}

async function notifyMissingAssignee(issue, projectConfig, octokitClient) {
    const owner = projectConfig.github?.owner || REPO_OWNER;
    const repo = projectConfig.github?.repo || REPO_NAME;
    const issueNumber = issue.number;
    const message = "⚠️ No puedo continuar: el issue no tiene assignee. Asigná un developer para continuar.";

    try {
        await withRetry(() => octokitClient.rest.issues.createComment({
            owner,
            repo,
            issue_number: issueNumber,
            body: message
        }));
    } catch (error) {
        console.log(`⚠️ [ASSIGNEE] No se pudo comentar en #${issueNumber}: ${error.message}`);
    }
}

async function configureGitAuthor(worktreeGit, credentials) {
    const name = credentials.commit_name || credentials.github_username;
    const email = credentials.commit_email || `${credentials.github_username}@users.noreply.github.com`;
    await worktreeGit.addConfig('user.name', name, false, 'local');
    await worktreeGit.addConfig('user.email', email, false, 'local');
}

function buildAuthenticatedRemoteUrl(owner, repo, token) {
    return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
}

async function setGitRemoteWithToken(worktreeGit, owner, repo, token) {
    let previousUrl = null;
    try {
        previousUrl = (await worktreeGit.remote(['get-url', 'origin'])).trim();
    } catch (error) {
        previousUrl = null;
    }
    const authUrl = buildAuthenticatedRemoteUrl(owner, repo, token);
    await worktreeGit.remote(['set-url', 'origin', authUrl]);
    return previousUrl;
}

async function restoreGitRemote(worktreeGit, previousUrl) {
    if (!previousUrl) return;
    await worktreeGit.remote(['set-url', 'origin', previousUrl]);
}

async function recordPlanHistory(taskId, plan, complexity, attemptNumber) {
    if (!isDbConfigured()) return;
    await insertPlanHistory(taskId, plan, complexity, attemptNumber);
}

async function updateLabels(issueNumber, newLabels, context = {}) {
    const owner = context.owner || REPO_OWNER;
    const repo = context.repo || REPO_NAME;
    const client = context.octokit || octokit;
    await withRetry(() => client.rest.issues.update({ owner, repo, issue_number: issueNumber, labels: newLabels }));
}

async function getIssueLabels(issueNumber, context = {}) {
    const owner = context.owner || REPO_OWNER;
    const repo = context.repo || REPO_NAME;
    const client = context.octokit || octokit;
    const { data: issue } = await withRetry(() => client.rest.issues.get({
        owner,
        repo,
        issue_number: issueNumber
    }));
    return (issue.labels || []).map(l => typeof l === "string" ? l : l.name).filter(Boolean);
}

async function addIssueLabel(issueNumber, labelToAdd, context = {}) {
    const labels = await getIssueLabels(issueNumber, context);
    if (!labels.includes(labelToAdd)) labels.push(labelToAdd);
    await updateLabels(issueNumber, labels, context);
}

async function removeIssueLabel(issueNumber, labelToRemove, context = {}) {
    const labels = await getIssueLabels(issueNumber, context);
    const next = labels.filter(l => l !== labelToRemove);
    await updateLabels(issueNumber, next, context);
}

async function hasPlanComment(issueNumber, context = {}) {
    const owner = context.owner || REPO_OWNER;
    const repo = context.repo || REPO_NAME;
    const client = context.octokit || octokit;
    const { data: comments } = await withRetry(() => client.rest.issues.listComments({
        owner,
        repo,
        issue_number: issueNumber
    }));
    return comments.some(c => c.body && c.body.includes("### 📋 Plan"));
}

async function loadProjectSecrets(projectId) {
    if (!projectId || !isDbConfigured()) return {};
    const result = await getProjectSecrets(projectId);
    const secrets = {};
    result.forEach(row => {
        secrets[row.key_name] = decrypt(row.encrypted_value);
    });
    return secrets;
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

    const client = context.octokit || octokit;
    try {
        await withRetry(() => client.rest.issues.createComment({
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

async function runPlanFlow(issue, projectInput) {
    console.log(`🧠 [PLAN] #${issue.number}`);
    let workingAdded = false;
    const projectConfig = resolveProjectConfig(projectInput) || {};
    const sessionPrefix = projectConfig.id ? `${projectConfig.id}-` : "";
    const sessionId = `ses-${sessionPrefix}i${issue.number}-${Date.now()}`;
    const traceId = issue.traceId || "";
    let projectSecrets = {};
    try {
        projectSecrets = await loadProjectSecrets(projectConfig.id);
    } catch (e) {
        console.log(`⚠️ [PLAN] No se pudieron cargar secretos para ${projectConfig.id}: ${e.message}`);
    }
    const octokitClient = projectSecrets.GITHUB_TOKEN
        ? new Octokit({ auth: projectSecrets.GITHUB_TOKEN })
        : octokit;
    await developerCredentialsManager.initRedis();

    try {
        try {
            await addIssueLabel(issue.number, LABELS.WORKING, {
                owner: projectConfig.github?.owner,
                repo: projectConfig.github?.repo,
                octokit: octokitClient
            });
            workingAdded = true;
        } catch (e) {
            console.log(`⚠️ [PLAN] No se pudo agregar ${LABELS.WORKING} en #${issue.number}: ${e.message}`);
        }
        const isNew = issue.labels.some(l => l.name === LABELS.NEW);
        if (isNew && await hasPlanComment(issue.number, {
            owner: projectConfig.github?.owner,
            repo: projectConfig.github?.repo,
            octokit: octokitClient
        })) {
            console.log(`ℹ️ [PLAN] Ya existe un plan para #${issue.number}. Se omite duplicado.`);
            await addIssueLabel(issue.number, LABELS.WAITING_HUMAN, {
                owner: projectConfig.github?.owner,
                repo: projectConfig.github?.repo,
                octokit: octokitClient
            });
            return;
        }

        const { data: comments } = await withRetry(() => octokitClient.rest.issues.listComments({
            owner: projectConfig.github?.owner || REPO_OWNER,
            repo: projectConfig.github?.repo || REPO_NAME,
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
        const lastPlan = session.plans.length > 0 ? session.plans[session.plans.length - 1] : null;
        const complexityHint = lastPlan?.complexity || "medium";
        const planningModel = projectConfig?.models?.planning?.[complexityHint] || projectConfig?.models?.planning?.medium;
        const res = await runOpenCode(issue.number, instruction, false, {
            sessionId,
            continue: false,
            logSuffix: "plan",
            traceId,
            plannerModelOverride: planningModel
        });
        const planEntry = {
            createdAt: new Date().toISOString(),
            body: res,
            complexity: null
        };
        session.plans.push(planEntry);
        saveSession(issue.number, session);
        if (isNew && await hasPlanComment(issue.number, {
            owner: projectConfig.github?.owner,
            repo: projectConfig.github?.repo,
            octokit: octokitClient
        })) {
            console.log(`ℹ️ [PLAN] Plan ya publicado durante ejecución para #${issue.number}.`);
            await addIssueLabel(issue.number, LABELS.WAITING_HUMAN, {
                owner: projectConfig.github?.owner,
                repo: projectConfig.github?.repo,
                octokit: octokitClient
            });
            await removeIssueLabel(issue.number, LABELS.WAITING_IA, {
                owner: projectConfig.github?.owner,
                repo: projectConfig.github?.repo,
                octokit: octokitClient
            });
            await removeIssueLabel(issue.number, LABELS.NEW, {
                owner: projectConfig.github?.owner,
                repo: projectConfig.github?.repo,
                octokit: octokitClient
            });
            await removeIssueLabel(issue.number, LABELS.WORKING, {
                owner: projectConfig.github?.owner,
                repo: projectConfig.github?.repo,
                octokit: octokitClient
            });
            return;
        }
        let complexity = "medium";
        try {
            const classifierModel = projectConfig?.models?.classifier || planningModel;
            complexity = await classifyComplexity(issue.number, issue.title, res, { sessionId, traceId, model: classifierModel });
        } catch (e) {
            console.log(`⚠️ [PLAN] No se pudo clasificar complejidad en #${issue.number}: ${e.message}`);
        }

        planEntry.complexity = complexity;
        saveSession(issue.number, session);

        const planComment = `### 📋 Plan\n\n\`\`\`complexity\n${complexity}\n\`\`\`\n\n${res}`;
        await withRetry(() => octokitClient.rest.issues.createComment({
            owner: projectConfig.github?.owner || REPO_OWNER,
            repo: projectConfig.github?.repo || REPO_NAME,
            issue_number: issue.number,
            body: planComment
        }));
        const attemptNumber = session.plans.length;
        await recordPlanHistory(`issue-${issue.number}-${projectConfig.id || "default"}`, res, complexity, attemptNumber);
        await addIssueLabel(issue.number, LABELS.WAITING_HUMAN, {
            owner: projectConfig.github?.owner,
            repo: projectConfig.github?.repo,
            octokit: octokitClient
        });
        await removeIssueLabel(issue.number, LABELS.WAITING_IA, {
            owner: projectConfig.github?.owner,
            repo: projectConfig.github?.repo,
            octokit: octokitClient
        });
        await removeIssueLabel(issue.number, LABELS.NEW, {
            owner: projectConfig.github?.owner,
            repo: projectConfig.github?.repo,
            octokit: octokitClient
        });
    } catch (err) {
        console.error(`❌ Error en #${issue.number}:`, err.message);
        await notifyFailure(issue.number, 'PLAN', err, {
            owner: projectConfig.github?.owner,
            repo: projectConfig.github?.repo,
            octokit: octokitClient
        });
    } finally {
        if (workingAdded) {
            try {
                await removeIssueLabel(issue.number, LABELS.WORKING, {
                    owner: projectConfig.github?.owner,
                    repo: projectConfig.github?.repo,
                    octokit: octokitClient
                });
            } catch (e) {
                console.log(`⚠️ [PLAN] No se pudo remover ${LABELS.WORKING} en #${issue.number}: ${e.message}`);
            }
        }
    }
}

async function runBuildFlow(issue, projectInput) {
    console.log(`🛠️ [BUILD] #${issue.number}`);
    let workingAdded = false;
    const projectConfig = resolveProjectConfig(projectInput) || {};
    let projectSecrets = {};
    try {
        projectSecrets = await loadProjectSecrets(projectConfig.id);
    } catch (e) {
        console.log(`⚠️ [BUILD] No se pudieron cargar secretos para ${projectConfig.id}: ${e.message}`);
    }
    const octokitClient = projectSecrets.GITHUB_TOKEN
        ? new Octokit({ auth: projectSecrets.GITHUB_TOKEN })
        : octokit;
    try {
        try {
            await addIssueLabel(issue.number, LABELS.WORKING, {
                owner: projectConfig.github?.owner,
                repo: projectConfig.github?.repo,
                octokit: octokitClient
            });
            workingAdded = true;
        } catch (e) {
            console.log(`⚠️ [BUILD] No se pudo agregar ${LABELS.WORKING} en #${issue.number}: ${e.message}`);
        }
        const branch = `task/issue-${issue.number}`;

        const worktreePath = await ensureWorktree(issue.number, branch, {
            repoPath: projectConfig.repoPath,
            worktreeRoot: projectConfig.worktreeRoot
        });
        console.log(`🧰 [WORKTREE] #${issue.number} -> ${worktreePath}`);
        const worktreeGit = simpleGit(worktreePath);
        await worktreeGit.checkout(branch).catch(() => {});
        const traceId = issue.traceId || "";

        const baseGit = getGitClient();
        if (baseGit) {
            const baseDiff = await baseGit.status();
            if (baseDiff.files.length > 0) {
                const baseFiles = baseDiff.files.map(f => f.path).slice(0, 10);
                console.log(`⚠️ [BUILD] Cambios detectados en repo base (${baseDiff.files.length}). Se ignoran para evitar mezclas.`);
                if (baseFiles.length > 0) {
                    console.log(`⚠️ [BUILD] Archivos en repo base: ${baseFiles.join(", ")}`);
                }
            }
        }

        const { data: comments } = await withRetry(() => octokitClient.rest.issues.listComments({
            owner: projectConfig.github?.owner || REPO_OWNER,
            repo: projectConfig.github?.repo || REPO_NAME,
            issue_number: issue.number
        }));
        const session = loadSession(issue.number);
        const lastPlanEntry = session.plans.length > 0 ? session.plans[session.plans.length - 1] : null;
        const lastPlan = lastPlanEntry ? lastPlanEntry.body : null;
        const plan = lastPlan || comments.reverse().find(c => c.body.includes("### 📋 Plan"))?.body || "Aplica cambios técnicos.";
        const complexityHint = lastPlanEntry?.complexity || "medium";

        const planSummary = plan.replace(/\s+/g, " ").trim().slice(0, 500);
        console.log(`🧩 [CONTEXT] ${issue.title}`);
        console.log(`🧩 [CONTEXT] Plan: ${planSummary}${planSummary.length === 500 ? "…" : ""}`);

        const sessionPrefix = projectConfig.id ? `${projectConfig.id}-` : "";
        const sessionId = `ses-${sessionPrefix}i${issue.number}-${Date.now()}`;
        const buildModel = projectConfig?.models?.build?.[complexityHint] || projectConfig?.models?.build?.medium;
        await runOpenCode(issue.number, `Sigue este plan:\n${plan}\n\nEJECUTA AHORA.`, true, {
            cwd: worktreePath,
            sessionId,
            continue: false,
            logSuffix: "build",
            traceId,
            buildModelOverride: buildModel
        });

        const assigneeUsername = await resolveAssigneeForIssue(issue, projectConfig, octokitClient);
        if (!assigneeUsername) {
            await notifyMissingAssignee(issue, projectConfig, octokitClient);
            return;
        }

        const developerCredentials = await developerCredentialsManager.getCredentialsByGithubUsername(assigneeUsername);
        if (!developerCredentials) {
            const message = `⚠️ No puedo continuar: no hay credenciales para @${assigneeUsername}.`;
            try {
                await withRetry(() => octokitClient.rest.issues.createComment({
                    owner: projectConfig.github?.owner || REPO_OWNER,
                    repo: projectConfig.github?.repo || REPO_NAME,
                    issue_number: issue.number,
                    body: message
                }));
            } catch (error) {
                console.log(`⚠️ [ASSIGNEE] No se pudo comentar en #${issue.number}: ${error.message}`);
            }
            return;
        }

        await configureGitAuthor(worktreeGit, developerCredentials);
        const assigneeOctokit = new Octokit({ auth: developerCredentials.token });

        const status = await worktreeGit.status();
        if (status.files.length > 0) {
            await worktreeGit.add("./*").commit(`feat: fix #${issue.number}`);
            let previousRemote = null;
            try {
                const owner = projectConfig.github?.owner || REPO_OWNER;
                const repo = projectConfig.github?.repo || REPO_NAME;
                previousRemote = await setGitRemoteWithToken(worktreeGit, owner, repo, developerCredentials.token);
                console.log(`🚀 [GIT] Push branch ${branch}`);
                await gitPushWithRetry(worktreeGit, "origin", branch, { maxAttempts: 3, baseDelayMs: 1000 });
            } catch (pushErr) {
                console.error(`❌ Error push en #${issue.number}:`, pushErr.message);
                await notifyFailure(issue.number, 'BUILD', pushErr);
                return;
            } finally {
                await restoreGitRemote(worktreeGit, previousRemote);
            }
            try {
                console.log(`🧾 [PR] Creando PR para ${branch}`);
                const prBody = buildPrBody(issue, plan);
                const { data: pr } = await withRetry(() => assigneeOctokit.rest.pulls.create({
                    owner: projectConfig.github?.owner || REPO_OWNER,
                    repo: projectConfig.github?.repo || REPO_NAME,
                    title: `PR: ${issue.title}`,
                    head: branch,
                    base: "main",
                    body: prBody
                }));
                console.log(`✅ PR creado: ${pr.html_url}`);
            } catch (e) {
                try {
                    const { data: existingPrs } = await withRetry(() => assigneeOctokit.rest.pulls.list({
                        owner: projectConfig.github?.owner || REPO_OWNER,
                        repo: projectConfig.github?.repo || REPO_NAME,
                        head: `${projectConfig.github?.owner || REPO_OWNER}:${branch}`,
                        state: "open"
                    }));
                    const existing = existingPrs[0];
                    if (existing) {
                        const body = existing.body || "";
                        if (!body.includes(`Resolves #${issue.number}`) || !body.includes("## Summary")) {
                            const prBody = buildPrBody(issue, plan);
                            const mergedBody = body ? `${prBody}\n\n---\n\n${body}` : prBody;
                            await withRetry(() => assigneeOctokit.rest.pulls.update({
                                owner: projectConfig.github?.owner || REPO_OWNER,
                                repo: projectConfig.github?.repo || REPO_NAME,
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
                await withRetry(() => octokitClient.rest.issues.createComment({
                    owner: projectConfig.github?.owner || REPO_OWNER,
                    repo: projectConfig.github?.repo || REPO_NAME,
                    issue_number: issue.number,
                    body: noChangesMsg
                }));
            } catch (e) {
                console.log(`⚠️ [BUILD] No se pudo comentar en #${issue.number}: ${e.message}`);
            }
            return;
        }
        await updateLabels(issue.number, [LABELS.DONE], {
            owner: projectConfig.github?.owner,
            repo: projectConfig.github?.repo,
            octokit: octokitClient
        });
    } catch (err) {
        console.error(`❌ Error en #${issue.number}:`, err.message);
        await notifyFailure(issue.number, 'BUILD', err, {
            owner: projectConfig.github?.owner,
            repo: projectConfig.github?.repo,
            octokit: octokitClient
        });
    } finally {
        if (workingAdded) {
            try {
                await removeIssueLabel(issue.number, LABELS.WORKING, {
                    owner: projectConfig.github?.owner,
                    repo: projectConfig.github?.repo,
                    octokit: octokitClient
                });
            } catch (e) {
                console.log(`⚠️ [BUILD] No se pudo remover ${LABELS.WORKING} en #${issue.number}: ${e.message}`);
            }
        }
    }
}

module.exports = { runPlanFlow, runBuildFlow, notifyFailure };
