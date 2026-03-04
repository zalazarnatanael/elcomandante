const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { Octokit } = require('@octokit/rest');
const { Client } = require('@notionhq/client');
const { getProjectSecrets, upsertProjectSecrets, isDbConfigured } = require('./services/database');
const { encrypt, decrypt } = require('./services/encryptionService');
const { LABELS, REPO_OWNER, REPO_NAME } = require('./config/constants');
const { projects } = require('./config/projects');
const { runPlanFlow, runBuildFlow, notifyFailure } = require('./main'); 
const { enqueuePersistentTask, updateTaskStatus, fetchPendingTasks, upsertTaskMetadata } = require('./services/taskQueue');
const { removeWorktree } = require('./services/worktreeManager');
const { withRetry } = require('./services/githubRetry');
require('dotenv').config();

const app = express();
const port = 3000;
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const notion = new Client({ auth: process.env.NOTION_TOKEN });

app.use(express.json({ limit: '50mb' }));
// Servidor de imágenes
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

app.get('/api/projects/:projectId/secrets', async (req, res) => {
    if (!requireBotAuth(req, res)) return;
    if (!isDbConfigured()) return res.status(500).json({ error: "DB no configurada" });

    const projectId = req.params.projectId;
    try {
        const result = await getProjectSecrets(projectId);
        const secrets = {};
        result.forEach(row => {
            secrets[row.key_name] = decrypt(row.encrypted_value);
        });
        res.json(secrets);
    } catch (err) {
        console.error(`❌ [SECRETS] Error obteniendo secretos ${projectId}:`, err.message);
        res.status(500).json({ error: 'Error al obtener secretos' });
    }
});

app.post('/api/projects/:projectId/secrets', async (req, res) => {
    if (!requireAdminKey(req, res)) return;
    if (!isDbConfigured()) return res.status(500).json({ error: "DB no configurada" });

    const projectId = req.params.projectId;
    const { secrets } = req.body || {};
    if (!secrets || typeof secrets !== 'object') {
        return res.status(400).json({ error: 'Payload invalido' });
    }

    try {
        const entries = Object.entries(secrets);
        const payload = {};
        entries.forEach(([keyName, value]) => {
            payload[keyName] = encrypt(String(value));
        });
        const saved = await upsertProjectSecrets(projectId, payload);
        res.json({ success: true, saved });
    } catch (err) {
        console.error(`❌ [SECRETS] Error guardando secretos ${projectId}:`, err.message);
        res.status(500).json({ error: 'Error al guardar secretos' });
    }
});

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "FerreteriaOpenClaw2026Secreto!";
const BOT_LOGIN = process.env.BOT_GITHUB_LOGIN || "zatogaming404-bot";

const queue = [];
const maxConcurrent = Number(process.env.WORKER_CONCURRENCY || 3);
let activeWorkers = 0;
const inFlightIssues = new Set();
const inFlight = new Set();
const traceIds = new Map();
const labelCooldowns = new Map();
const SESSION_DIR = path.join(__dirname, 'session_logs');

const NOTION_DATABASE_ID =
    process.env.NOTION_DATABASE_ID_FERRETERIA || process.env.NOTION_DATABASE_ID;

function requireBotAuth(req, res) {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) {
        res.status(401).json({ error: "No autorizado" });
        return null;
    }
    const token = header.slice(7).trim();
    if (!token || token !== process.env.BOT_AUTH_TOKEN) {
        res.status(403).json({ error: "Token invalido" });
        return null;
    }
    return token;
}

function requireAdminKey(req, res) {
    const adminKey = req.headers["x-admin-key"];
    if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
        res.status(403).json({ error: "No autorizado" });
        return null;
    }
    return adminKey;
}

function buildTaskKey(task) {
    const id = task.issueNumber || task.number || 'unknown';
    const project = task.projectId || 'default';
    return `${project}:${task.name}:${id}`;
}

function getIssueKey(task) {
    return task.issueNumber || task.number || null;
}

function getTraceId(issueNumber) {
    if (!issueNumber) return null;
    if (!traceIds.has(issueNumber)) {
        const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
        traceIds.set(issueNumber, `ISSUE-${issueNumber}-${suffix}`);
    }
    return traceIds.get(issueNumber);
}

function attachTrace(issueNumber, issue) {
    const traceId = getTraceId(issueNumber);
    if (issue) issue.traceId = traceId;
    return traceId;
}

function enqueueTask(task) {
    const key = buildTaskKey(task);
    const alreadyQueued = queue.some(t => buildTaskKey(t) === key);
    if (alreadyQueued || inFlight.has(key)) {
        console.log(`ℹ️ [FIFO] Tarea duplicada omitida: ${task.name} (#${task.number})`);
        return false;
    }
    if (task.issueNumber && !task.traceId) {
        task.traceId = getTraceId(task.issueNumber);
    }
    queue.push(task);
    const trace = task.traceId ? ` | trace=${task.traceId}` : '';
    console.log(`🧾 [FIFO] Encolada: ${task.name} (#${task.number}) | cola=${queue.length}${trace}`);
    return true;
}

async function enqueueTaskWithPersistence(task) {
    const persistedId = await enqueuePersistentTask({
        id: task.taskId,
        taskType: task.name,
        issueNumber: task.issueNumber || task.number,
        projectId: task.projectId || null,
        owner: task.owner,
        repo: task.repo,
        payload: task.payload || {}
    });

    if (persistedId && !task.taskId) task.taskId = persistedId;
    return enqueueTask(task);
}

async function processQueue() {
    if (queue.length === 0) return;

    while (activeWorkers < maxConcurrent) {
        const nextIndex = queue.findIndex(task => {
            const issueKey = getIssueKey(task);
            return !issueKey || !inFlightIssues.has(issueKey);
        });

        if (nextIndex === -1) return;

        const task = queue.splice(nextIndex, 1)[0];
        const taskKey = buildTaskKey(task);
        const issueKey = getIssueKey(task);

        inFlight.add(taskKey);
        if (issueKey) inFlightIssues.add(issueKey);
        activeWorkers += 1;

        const startedAt = Date.now();
        const trace = task.traceId ? ` | trace=${task.traceId}` : '';
        console.log(`\n📦 [FIFO] Ejecutando: ${task.name} (#${task.number}) [workers: ${activeWorkers}/${maxConcurrent}]${trace}`);
    if (task.taskId) {
        updateTaskStatus(task.taskId, 'processing', { started_at: new Date().toISOString() }).catch(() => {});
    }
        task.execute()
            .catch(async err => {
                console.error(`❌ Error en #${task.number}:`, err.message);
                if (task.issueNumber) {
                    await notifyFailure(task.issueNumber, task.name, err, { owner: task.owner, repo: task.repo });
                }
                if (task.taskId) {
                    updateTaskStatus(task.taskId, 'failed', { error_message: err.message }).catch(() => {});
                }
            })
            .finally(() => {
                inFlight.delete(taskKey);
                if (issueKey) inFlightIssues.delete(issueKey);
                activeWorkers -= 1;
                const durationMs = Date.now() - startedAt;
                console.log(`✅ [FIFO] Finalizada: ${task.name} (#${task.number}) | ${durationMs}ms | workers=${activeWorkers}/${maxConcurrent}${trace}`);
                console.log(`📊 [FIFO] Estado: cola=${queue.length} | inFlightTasks=${inFlight.size} | inFlightIssues=${inFlightIssues.size}`);
                if (task.taskId) {
                    updateTaskStatus(task.taskId, 'completed', { completed_at: new Date().toISOString() }).catch(() => {});
                }
                setTimeout(processQueue, 100); 
            });
    }
}

function extractIssueNumberFromPr(pr) {
    if (pr && typeof pr.body === 'string') {
        const resuelve = pr.body.match(/Resuelve\s+#(\d+)/i);
        if (resuelve) return Number(resuelve[1]);
        const closes = pr.body.match(/Closes\s+#(\d+)/i);
        if (closes) return Number(closes[1]);
    }
    if (pr && pr.head && typeof pr.head.ref === 'string') {
        const match = pr.head.ref.match(/issue-(\d+)/i);
        if (match) return Number(match[1]);
    }
    return null;
}

function isBotComment(comment) {
    const login = comment?.user?.login || "";
    const type = comment?.user?.type || "";
    if (login && BOT_LOGIN && login.toLowerCase() === BOT_LOGIN.toLowerCase()) return true;
    if (type.toLowerCase() === "bot") return true;
    if (login.toLowerCase().endsWith("[bot]")) return true;
    return false;
}

function shouldIgnoreLabelEvent(issueNumber) {
    if (!issueNumber) return false;
    const now = Date.now();
    const last = labelCooldowns.get(issueNumber) || 0;
    const elapsed = now - last;
    if (elapsed < 2500) return true;
    labelCooldowns.set(issueNumber, now);
    return false;
}

function extractNotionPageIdFromIssue(issue) {
    if (!issue || typeof issue.body !== 'string') return null;
    const match = issue.body.match(/Notion-PageId:\s*([\w-]+)/i);
    return match ? match[1] : null;
}

function extractNotionLinkFromIssue(issue) {
    if (!issue || typeof issue.body !== 'string') return null;
    const match = issue.body.match(/Notion:\s*(https?:\/\/\S+)/i);
    return match ? match[1] : null;
}

async function findNotionPageIdByIssueUrl(issueUrl) {
    if (!issueUrl || !NOTION_DATABASE_ID) return null;

    const queryArgs = {
        filter: {
            property: "GitHub Issue URL",
            url: { equals: issueUrl }
        },
        page_size: 1
    };

    if (notion.databases?.query) {
        const res = await notion.databases.query({
            database_id: NOTION_DATABASE_ID,
            ...queryArgs
        });
        return res?.results?.[0]?.id || null;
    }

    if (notion.dataSources?.query) {
        const res = await notion.dataSources.query({
            data_source_id: NOTION_DATABASE_ID,
            ...queryArgs
        });
        return res?.results?.[0]?.id || null;
    }

    return null;
}

function loadSession(issueNumber) {
    const sessionPath = path.join(SESSION_DIR, `issue-${issueNumber}.json`);
    if (!fs.existsSync(sessionPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    } catch (e) {
        return null;
    }
}

function summarizePlan(planText, maxLines = 6) {
    if (!planText) return [];
    const lines = planText.split('\n').map(l => l.trim());
    const bullets = lines.filter(l => l.startsWith('- ')).slice(0, maxLines);
    if (bullets.length > 0) return bullets.map(b => b.replace(/^\-\s*/, ''));
    const compact = planText.replace(/\s+/g, ' ').trim();
    return compact ? [compact.slice(0, 300) + (compact.length > 300 ? '…' : '')] : [];
}

function formatFiles(files) {
    const top = files.slice(0, 8).map(f => `${f.filename} (${f.status}, +${f.additions}/-${f.deletions})`);
    const extra = files.length > 8 ? `y ${files.length - 8} archivos mas` : '';
    return extra ? top.concat([extra]) : top;
}

function formatCommits(commits) {
    const seen = new Set();
    const items = [];
    commits.forEach(c => {
        const title = c.commit && c.commit.message ? c.commit.message.split('\n')[0] : 'Commit';
        const key = c.sha || title;
        if (seen.has(key)) return;
        seen.add(key);
        items.push(title);
    });
    return items.slice(0, 6);
}

function toBullets(lines) {
    return lines.map(line => `- ${line}`);
}

function guessAreaFromFiles(files) {
    const candidates = files
        .map(f => f.filename)
        .filter(name => name.includes('/'))
        .slice(0, 3)
        .map(name => name.split('/').slice(-2).join('/'));
    return candidates.length > 0 ? candidates.join(', ') : '';
}

function buildHumanSummary(pr, issue, files, commits, session) {
    const planText = session && Array.isArray(session.plans) && session.plans.length > 0
        ? session.plans[session.plans.length - 1].body
        : '';
    const planBullets = summarizePlan(planText, 8);
    const fileLines = formatFiles(files);
    const commitLines = formatCommits(commits);
    const areaHint = guessAreaFromFiles(files);
    const issueTitle = issue && issue.title ? issue.title : `Issue #${pr.number}`;
    const issueBody = issue && issue.body ? issue.body.replace(/\s+/g, ' ').trim() : '';

    const humanLines = [];
    humanLines.push(`Se atendio el pedido del issue: ${issueTitle}.`);
    if (issueBody) {
        humanLines.push(`Contexto del pedido: ${issueBody.slice(0, 240)}${issueBody.length > 240 ? '…' : ''}`);
    }
    if (planBullets.length > 0) {
        planBullets.forEach(b => humanLines.push(b));
    }
    if (areaHint) {
        humanLines.push(`El cambio se concentro en ${areaHint}, sin tocar otras partes que no hacian falta.`);
    }
    if (files.length > 0) {
        humanLines.push(`Se tocaron ${files.length} archivo(s) con cambios puntuales y controlados.`);
    }
    humanLines.push('El resultado esperado es que el ajuste se vea reflejado directamente en el home al cargar la pagina.');
    humanLines.push('No se modificaron rutas ni estructura general, solo lo necesario para cumplir el pedido.');
    humanLines.push('No se ejecutaron tests automaticos en este paso.');

    const summaryTitle = `✅ Resumen: ${issueTitle}`;
    const summaryLines = ['Resumen humano:', ...toBullets(humanLines)];

    const detailsLines = [];
    if (fileLines.length > 0) {
        detailsLines.push('Resumen tecnico:');
        detailsLines.push(...toBullets(fileLines));
    }
    if (commitLines.length > 0) {
        detailsLines.push('Commits relevantes:');
        detailsLines.push(...toBullets(commitLines));
    }

    return [
        summaryTitle,
        `PR: ${pr.html_url}`,
        '',
        ...summaryLines,
        '',
        ...detailsLines
    ].filter(Boolean).join('\n');
}

async function handlePrClosed(pr) {
    const issueNumber = extractIssueNumberFromPr(pr);
    if (!issueNumber) {
        console.log(`ℹ️ [PR-CLOSE] No se encontro issue asociado a PR #${pr.number}`);
        return;
    }

    const [issueRes, filesRes, commitsRes, commentsRes] = await Promise.all([
        withRetry(() => octokit.rest.issues.get({ owner: pr.base.repo.owner.login, repo: pr.base.repo.name, issue_number: issueNumber })),
        withRetry(() => octokit.rest.pulls.listFiles({ owner: pr.base.repo.owner.login, repo: pr.base.repo.name, pull_number: pr.number, per_page: 100 })),
        withRetry(() => octokit.rest.pulls.listCommits({ owner: pr.base.repo.owner.login, repo: pr.base.repo.name, pull_number: pr.number, per_page: 100 })),
        withRetry(() => octokit.rest.issues.listComments({ owner: pr.base.repo.owner.login, repo: pr.base.repo.name, issue_number: issueNumber, per_page: 100 }))
    ]);

    const existing = commentsRes.data.find(c => c.body && c.body.includes(`PR: ${pr.html_url}`) && c.body.includes('PR fusionado'));
    if (existing) {
        console.log(`ℹ️ [PR-CLOSE] Comentario ya existe para issue #${issueNumber}`);
    } else {
        const session = loadSession(issueNumber);
        const summary = buildHumanSummary(pr, issueRes.data, filesRes.data, commitsRes.data, session);
        await withRetry(() => octokit.rest.issues.createComment({
            owner: pr.base.repo.owner.login,
            repo: pr.base.repo.name,
            issue_number: issueNumber,
            body: summary
        }));
        console.log(`🧾 [SUMMARY] Comentario publicado en issue #${issueNumber}`);
    }

    try {
        await withRetry(() => octokit.rest.issues.update({
            owner: pr.base.repo.owner.login,
            repo: pr.base.repo.name,
            issue_number: issueNumber,
            labels: ["completed"]
        }));
        console.log(`🏷️ [LABEL] Issue #${issueNumber} -> completed`);
        await upsertTaskMetadata({
            id: `issue-${issueNumber}-build`,
            github_labels: JSON.stringify(["completed"]),
            last_event: "github:completed",
            last_event_at: new Date().toISOString()
        });
    } catch (e) {
        console.log(`⚠️ [LABEL] No se pudo actualizar labels de #${issueNumber}: ${e.message}`);
    }

    const branch = `task/issue-${issueNumber}`;
    await removeWorktree(issueNumber, branch);

    try {
        let notionPageId = extractNotionPageIdFromIssue(issueRes.data);
        const notionLink = extractNotionLinkFromIssue(issueRes.data);

        if (!notionPageId && NOTION_DATABASE_ID) {
            notionPageId = await findNotionPageIdByIssueUrl(issueRes.data?.html_url);
        }

        if (notionPageId) {
            await notion.pages.update({
                page_id: notionPageId,
                properties: {
                    "Estado": { status: { name: "Completada" } }
                }
            });
            console.log(`✅ [NOTION] Estado actualizado a Completada: ${notionPageId}`);
            if (notionLink) console.log(`🔗 [NOTION] ${notionLink}`);
            await upsertTaskMetadata({
                id: `issue-${issueNumber}-build`,
                notion_page_id: notionPageId,
                notion_status: "Completada",
                last_event: "notion:completed",
                last_event_at: new Date().toISOString()
            });
        } else {
            console.log(`ℹ️ [NOTION] No se encontro Notion-PageId en issue #${issueNumber}`);
        }
    } catch (e) {
        console.log(`⚠️ [NOTION] Error actualizando Notion para #${issueNumber}: ${e.message}`);
    }

    const sessionPath = path.join(SESSION_DIR, `issue-${issueNumber}.json`);
    const logPath = path.join(SESSION_DIR, `issue-${issueNumber}.log`);
    if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
    if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
    console.log(`🧹 [CLEANUP] Session eliminada para #${issueNumber}`);
}

app.post('/webhook/:projectId?', (req, res) => {
    const signature = req.headers['x-hub-signature-256'];
    const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
    const digest = Buffer.from('sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex'), 'utf8');
    const checksum = Buffer.from(signature || '', 'utf8');

    if (!signature || signature.length !== digest.length || !crypto.timingSafeEqual(digest, checksum)) {
        return res.status(401).send('Error de firma');
    }

    const projectId = req.params.projectId || process.env.DEFAULT_PROJECT_ID || "proyecto-1";
    const projectConfig = projects[projectId];
    if (!projectConfig) return res.status(404).send('Proyecto no encontrado');

    if (projectConfig.github?.owner && req.body.repository?.owner?.login && projectConfig.github.owner !== req.body.repository.owner.login) {
        return res.status(400).send('Repo no coincide con el proyecto');
    }
    if (projectConfig.github?.repo && req.body.repository?.name && projectConfig.github.repo !== req.body.repository.name) {
        return res.status(400).send('Repo no coincide con el proyecto');
    }

    const event = req.headers['x-github-event'];
    const { action, issue, label } = req.body;

    if (issue?.number) {
        const labels = (issue.labels || []).map(l => (typeof l === 'string' ? l : l.name)).filter(Boolean);
        console.log(`🔔 [WEBHOOK] event=${event} action=${action} issue=#${issue.number} labels=${labels.join(',')}`);
        if (issue.number) {
            upsertTaskMetadata({
                id: `issue-${issue.number}-plan`,
                github_issue_url: issue.html_url || null,
                github_labels: JSON.stringify(labels),
                last_event: `${event}:${action}`,
                last_event_at: new Date().toISOString()
            }).catch(() => {});
            upsertTaskMetadata({
                id: `issue-${issue.number}-build`,
                github_issue_url: issue.html_url || null,
                github_labels: JSON.stringify(labels),
                last_event: `${event}:${action}`,
                last_event_at: new Date().toISOString()
            }).catch(() => {});
        }
    } else {
        console.log(`🔔 [WEBHOOK] event=${event} action=${action}`);
    }

    if (event === 'issues' && action === 'opened') {
        const owner = req.body.repository?.owner?.login;
        const repo = req.body.repository?.name;
        const labels = (issue?.labels || []).map(l => (typeof l === 'string' ? l : l.name)).filter(Boolean);

        if (labels.includes(LABELS.NEW)) {
            if (!owner || !repo) {
                console.log(`⚠️ [LABEL] owner/repo faltante para issue #${issue.number}`);
            } else {
                enqueueTaskWithPersistence({
                    number: issue.number,
                    name: "PLAN",
                    taskType: "PLAN",
                    taskId: `issue-${issue.number}-plan`,
                    issueNumber: issue.number,
                    projectId: projectConfig.id,
                    owner,
                    repo,
                    payload: { issue },
                    metadata: {
                        github_issue_url: issue.html_url || null,
                        github_labels: JSON.stringify(labels),
                        last_event: "issue:opened",
                        last_event_at: new Date().toISOString()
                    },
                    execute: () => runPlanFlow(issue, projectConfig)
                });
                processQueue();
            }
        }
    }

    if (event === 'issues' && action === 'labeled') {
        if (shouldIgnoreLabelEvent(issue?.number)) {
            return res.status(200).send('ignored');
        }
        const labelName = label?.name;
        const owner = req.body.repository?.owner?.login;
        const repo = req.body.repository?.name;

        if (labelName === LABELS.NEW || labelName === LABELS.WAITING_IA) {
            if (!owner || !repo) {
                console.log(`⚠️ [LABEL] owner/repo faltante para issue #${issue.number}`);
            } else {
                const traceId = attachTrace(issue.number, issue);
                enqueueTaskWithPersistence({
                    number: issue.number,
                    name: "PLAN",
                    taskType: "PLAN",
                    taskId: `issue-${issue.number}-plan`,
                    issueNumber: issue.number,
                    projectId: projectConfig.id,
                    owner,
                    repo,
                    traceId,
                    payload: { issue },
                    metadata: {
                        github_issue_url: issue.html_url || null,
                        github_labels: JSON.stringify(labels),
                        last_event: `issue:labeled:${labelName}`,
                        last_event_at: new Date().toISOString()
                    },
                    execute: () => runPlanFlow(issue, projectConfig)
                });
            }
        }
        if (labelName === LABELS.READY) {
            const traceId = attachTrace(issue.number, issue);
            enqueueTaskWithPersistence({
                number: issue.number,
                name: "READY-LABELS",
                taskType: "READY-LABELS",
                taskId: `issue-${issue.number}-ready-labels`,
                issueNumber: issue.number,
                projectId: projectConfig.id,
                owner,
                repo,
                traceId,
                payload: { issue },
                metadata: {
                    github_issue_url: issue.html_url || null,
                    github_labels: JSON.stringify([LABELS.READY, LABELS.WORKING]),
                    last_event: "issue:ready-labels",
                    last_event_at: new Date().toISOString()
                },
                execute: async () => {
                    if (!owner || !repo) {
                        console.log(`⚠️ [LABEL] owner/repo faltante para issue #${issue.number}`);
                        return;
                    }
                    await withRetry(() => octokit.rest.issues.update({
                        owner,
                        repo,
                        issue_number: issue.number,
                        labels: [LABELS.READY, LABELS.WORKING]
                    }));
                    console.log(`🏷️ [LABEL] Issue #${issue.number} -> ${LABELS.READY} + ${LABELS.WORKING}`);
                }
            });
            enqueueTaskWithPersistence({
                number: issue.number,
                name: "BUILD",
                taskType: "BUILD",
                taskId: `issue-${issue.number}-build`,
                issueNumber: issue.number,
                projectId: projectConfig.id,
                owner,
                repo,
                traceId,
                payload: { issue },
                metadata: {
                    github_issue_url: issue.html_url || null,
                    github_labels: JSON.stringify(labels),
                    last_event: "issue:ready",
                    last_event_at: new Date().toISOString()
                },
                execute: () => runBuildFlow(issue, projectConfig)
            });
        }
        processQueue();
    }
    if (event === 'issue_comment' && action === 'created') {
        const isBot = isBotComment(req.body.comment);
        if (!isBot) {
            const issueNumber = issue?.number;
            const owner = req.body.repository?.owner?.login;
            const repo = req.body.repository?.name;
            if (issueNumber) {
                const traceId = attachTrace(issueNumber, issue);
                enqueueTaskWithPersistence({
                    number: issueNumber,
                    name: 'REPLAN',
                    taskType: "REPLAN",
                    taskId: `issue-${issueNumber}-replan`,
                    issueNumber,
                    projectId: projectConfig.id,
                    owner,
                    repo,
                    traceId,
                    payload: { issue },
                    metadata: {
                        github_issue_url: issue?.html_url || null,
                        github_labels: JSON.stringify([LABELS.WAITING_IA, LABELS.WORKING]),
                        last_event: "issue:comment",
                        last_event_at: new Date().toISOString()
                    },
                    execute: async () => {
                        if (!owner || !repo) {
                            console.log(`⚠️ [LABEL] owner/repo faltante para issue #${issueNumber}`);
                            return;
                        }
                        const nextLabels = [LABELS.WAITING_IA, LABELS.WORKING];
                        await withRetry(() => octokit.rest.issues.update({
                            owner,
                            repo,
                            issue_number: issueNumber,
                            labels: nextLabels
                        }));
                        console.log(`🏷️ [LABEL] Issue #${issueNumber} -> ${LABELS.WAITING_IA} + ${LABELS.WORKING}`);
                        if (issue) {
                            const nestedTraceId = attachTrace(issueNumber, issue);
                            enqueueTaskWithPersistence({
                                number: issueNumber,
                                name: "PLAN",
                                taskType: "PLAN",
                                taskId: `issue-${issueNumber}-plan`,
                                issueNumber,
                                projectId: projectConfig.id,
                                owner,
                                repo,
                                traceId: nestedTraceId,
                                payload: { issue },
                                metadata: {
                                    github_issue_url: issue.html_url || null,
                                    github_labels: JSON.stringify(nextLabels),
                                    last_event: "issue:comment",
                                    last_event_at: new Date().toISOString()
                                },
                                execute: () => runPlanFlow(issue, projectConfig)
                            });
                            processQueue();
                        }
                    }
                });
                processQueue();
            }
        }
    }
    if (event === 'pull_request' && action === 'closed') {
        const pr = req.body.pull_request;
        if (pr && pr.merged) {
            const traceId = attachTrace(pr.number, pr);
            enqueueTaskWithPersistence({
                number: pr.number,
                name: 'PR-CLOSE',
                taskType: "PR-CLOSE",
                taskId: `pr-${pr.number}-close`,
                issueNumber: extractIssueNumberFromPr(pr),
                owner: pr.base.repo.owner.login,
                repo: pr.base.repo.name,
                traceId,
                payload: { pr },
                execute: () => handlePrClosed(pr)
            });
            processQueue();
        }
    }
    res.status(200).send('OK');
});

app.listen(port, () => console.log(`🚀 Bot activo en puerto ${port}`));

async function loadPendingTasksOnStartup() {
    if (!isDbConfigured()) return;
    try {
        const pending = await fetchPendingTasks(100);
        if (!pending.length) return;
        pending.forEach(row => {
            const projectConfig = projects[row.project_id] || projects[process.env.DEFAULT_PROJECT_ID || "proyecto-1"];
            if (!projectConfig) return;
            const payload = row.payload || {};
            const issue = payload.issue || null;
            const pr = payload.pr || null;
            const taskBase = {
                taskId: row.id,
                projectId: row.project_id,
                issueNumber: row.github_issue_number,
                number: row.github_issue_number,
                owner: row.repo_owner,
                repo: row.repo_name
            };

            if (row.task_type === "PLAN" || row.task_type === "REPLAN") {
                if (!issue) return;
                enqueueTask({
                    ...taskBase,
                    name: row.task_type,
                    execute: () => runPlanFlow(issue, projectConfig)
                });
            }

            if (row.task_type === "BUILD") {
                if (!issue) return;
                enqueueTask({
                    ...taskBase,
                    name: "BUILD",
                    execute: () => runBuildFlow(issue, projectConfig)
                });
            }

            if (row.task_type === "PR-CLOSE") {
                if (!pr) return;
                enqueueTask({
                    ...taskBase,
                    name: "PR-CLOSE",
                    execute: () => handlePrClosed(pr)
                });
            }

            if (row.task_type === "READY-LABELS") {
                if (!issue) return;
                enqueueTask({
                    ...taskBase,
                    name: "READY-LABELS",
                    execute: async () => {
                        if (!taskBase.owner || !taskBase.repo) return;
                        await withRetry(() => octokit.rest.issues.update({
                            owner: taskBase.owner,
                            repo: taskBase.repo,
                            issue_number: issue.number,
                            labels: [LABELS.READY, LABELS.WORKING]
                        }));
                        console.log(`🏷️ [LABEL] Issue #${issue.number} -> ${LABELS.READY} + ${LABELS.WORKING}`);
                    }
                });
            }
        });
        processQueue();
        console.log(`🔁 [BOOT] Rehidratadas ${pending.length} tareas pendientes.`);
    } catch (e) {
        console.log(`⚠️ [BOOT] No se pudieron rehidratar tareas: ${e.message}`);
    }
}

loadPendingTasksOnStartup();

async function scanFromNotionIssues() {
    try {
        const { data: issues } = await withRetry(() => octokit.rest.issues.listForRepo({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            labels: LABELS.NEW,
            state: 'open',
            per_page: 20
        }));

        if (!issues.length) return;
        console.log(`🔎 [FALLBACK] Encontradas ${issues.length} issues con ${LABELS.NEW}`);

        for (const issue of issues) {
            const traceId = attachTrace(issue.number, issue);
            enqueueTask({
                number: issue.number,
                name: "PLAN",
                issueNumber: issue.number,
                owner: REPO_OWNER,
                repo: REPO_NAME,
                traceId,
                execute: () => runPlanFlow(issue)
            });
        }
        processQueue();
    } catch (err) {
        console.log(`⚠️ [FALLBACK] Error escaneando ${LABELS.NEW}: ${err.message}`);
    }
}

setInterval(scanFromNotionIssues, 60000);
