const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { Octokit } = require('@octokit/rest');
const { Client } = require('@notionhq/client');
const { LABELS, REPO_OWNER, REPO_NAME } = require('../../../config/constants');
const { projects } = require('../../../config/projects');
const { runPlanFlow, runBuildFlow, notifyFailure } = require('../../../main');
const { enqueuePersistentTask, updateTaskStatus, fetchPendingTasks, upsertTaskMetadata } = require('../../../services/taskQueue');
const { removeWorktree } = require('../../../services/worktreeManager');
const { withRetry } = require('../../../services/githubRetry');

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const notion = new Client({ auth: process.env.NOTION_TOKEN });

const queue = [];
const maxConcurrent = Number(process.env.WORKER_CONCURRENCY || 3);
let activeWorkers = 0;
const inFlightIssues = new Set();
const inFlight = new Set();
const traceIds = new Map();
const labelCooldowns = new Map();
const SESSION_DIR = path.join(__dirname, '../../../session_logs');

const NOTION_DATABASE_ID =
  process.env.NOTION_DATABASE_ID_FERRETERIA || process.env.NOTION_DATABASE_ID;

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
      });
  }
}

function extractNotionPageIdFromIssue(issue) {
  const body = issue?.body || '';
  const match = body.match(/Notion-PageId:\s*([\w-]+)/i);
  return match ? match[1] : null;
}

function extractNotionLinkFromIssue(issue) {
  const body = issue?.body || '';
  const match = body.match(/https:\/\/www\.notion\.so\/[^\s)]+/i);
  return match ? match[0] : null;
}

async function findNotionPageIdByIssueUrl(issueUrl) {
  if (!issueUrl || !NOTION_DATABASE_ID) return null;
  try {
    const response = await notion.databases.query({
      database_id: NOTION_DATABASE_ID,
      filter: {
        property: 'GitHub Issue URL',
        url: { equals: issueUrl }
      }
    });
    return response?.results?.[0]?.id || null;
  } catch (error) {
    console.log(`⚠️ [NOTION] Error buscando page por issue url: ${error.message}`);
    return null;
  }
}

async function updateNotionToCompleted(issueRes, issueNumber) {
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
          Estado: { status: { name: 'Completada' } }
        }
      });
      console.log(`✅ [NOTION] Estado actualizado a Completada: ${notionPageId}`);
      if (notionLink) console.log(`🔗 [NOTION] ${notionLink}`);
      await upsertTaskMetadata({
        id: `issue-${issueNumber}-build`,
        notion_page_id: notionPageId,
        notion_status: 'Completada',
        last_event: 'notion:completed',
        last_event_at: new Date().toISOString()
      });
    } else {
      console.log(`ℹ️ [NOTION] No se encontro Notion-PageId en issue #${issueNumber}`);
    }
  } catch (error) {
    console.log(`⚠️ [NOTION] Error actualizando Notion para #${issueNumber}: ${error.message}`);
  }
}

async function handleIssueCompleted(issueNumber, owner, repo) {
  const issueRes = await withRetry(() => octokit.rest.issues.get({ owner, repo, issue_number: issueNumber }));

  try {
    await octokit.rest.issues.update({
      owner,
      repo,
      issue_number: issueNumber,
      labels: [LABELS.DONE]
    });
  } catch (error) {
    console.log(`⚠️ [LABEL] No se pudo actualizar labels de #${issueNumber}: ${error.message}`);
  }

  const branch = `task/issue-${issueNumber}`;
  await removeWorktree(issueNumber, branch);

  await updateNotionToCompleted(issueRes, issueNumber);

  const sessionPath = path.join(SESSION_DIR, `issue-${issueNumber}.json`);
  const logPath = path.join(SESSION_DIR, `issue-${issueNumber}.log`);
  if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
  if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
  console.log(`🧹 [CLEANUP] Session eliminada para #${issueNumber}`);
}

async function handleWebhookEvent(req) {
  const projectId = req.params.projectId || process.env.DEFAULT_PROJECT_ID || 'proyecto-1';
  const projectConfig = projects[projectId];
  if (!projectConfig) {
    return { status: 404, body: 'Proyecto no encontrado' };
  }

  if (projectConfig.github?.owner && req.body.repository?.owner?.login && projectConfig.github.owner !== req.body.repository.owner.login) {
    return { status: 400, body: 'Repo no coincide con el proyecto' };
  }
  if (projectConfig.github?.repo && req.body.repository?.name && projectConfig.github.repo !== req.body.repository.name) {
    return { status: 400, body: 'Repo no coincide con el proyecto' };
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
          name: 'PLAN',
          taskType: 'PLAN',
          taskId: `issue-${issue.number}-plan`,
          issueNumber: issue.number,
          projectId: projectConfig.id,
          owner,
          repo,
          payload: { issue },
          metadata: {
            github_issue_url: issue.html_url || null,
            github_labels: JSON.stringify(labels),
            last_event: 'issue:opened',
            last_event_at: new Date().toISOString()
          },
          traceId: attachTrace(issue.number, issue),
          execute: () => runPlanFlow(issue, projectConfig)
        });
      }
    }
  }

  if (event === 'issues' && action === 'labeled' && label?.name === LABELS.READY) {
    const owner = req.body.repository?.owner?.login;
    const repo = req.body.repository?.name;
    if (issue?.number && owner && repo) {
      enqueueTaskWithPersistence({
        number: issue.number,
        name: 'BUILD',
        taskType: 'BUILD',
        taskId: `issue-${issue.number}-build`,
        issueNumber: issue.number,
        projectId: projectConfig.id,
        owner,
        repo,
        payload: { issue },
        metadata: {
          github_issue_url: issue.html_url || null,
          last_event: 'issue:labeled',
          last_event_at: new Date().toISOString()
        },
        traceId: attachTrace(issue.number, issue),
        execute: () => runBuildFlow(issue, projectConfig)
      });
    }
  }

  if (event === 'issues' && action === 'labeled' && label?.name === LABELS.DONE) {
    const owner = req.body.repository?.owner?.login;
    const repo = req.body.repository?.name;
    if (issue?.number && owner && repo) {
      await handleIssueCompleted(issue.number, owner, repo);
    }
  }

  processQueue();
  return { status: 200, body: { ok: true } };
}

async function loadPendingTasksOnStartup() {
  try {
    const pending = await fetchPendingTasks();
    if (!pending.length) return;

    pending.forEach(task => {
      const projectConfig = task.project_id ? projects[task.project_id] : null;
      const taskBase = {
        number: task.github_issue_number,
        issueNumber: task.github_issue_number,
        projectId: task.project_id,
        owner: task.repo_owner,
        repo: task.repo_name,
        name: task.task_type,
        taskId: task.id,
        payload: task.payload || {},
        traceId: attachTrace(task.github_issue_number, task.payload?.issue)
      };
      enqueueTask({
        ...taskBase,
        execute: async () => {
          const issue = task.payload?.issue;
          if (!issue) return;
          if (task.task_type === 'PLAN') {
            await runPlanFlow(issue, projectConfig || task.project_id);
          } else if (task.task_type === 'BUILD') {
            await runBuildFlow(issue, projectConfig || task.project_id);
          }
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
    });
    processQueue();
    console.log(`🔁 [BOOT] Rehidratadas ${pending.length} tareas pendientes.`);
  } catch (error) {
    console.log(`⚠️ [BOOT] No se pudieron rehidratar tareas: ${error.message}`);
  }
}

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
        name: 'PLAN',
        issueNumber: issue.number,
        owner: REPO_OWNER,
        repo: REPO_NAME,
        traceId,
        execute: () => runPlanFlow(issue)
      });
    }
    processQueue();
  } catch (error) {
    console.log(`⚠️ [FALLBACK] Error escaneando ${LABELS.NEW}: ${error.message}`);
  }
}

function startBackgroundJobs() {
  loadPendingTasksOnStartup();
  setInterval(scanFromNotionIssues, 60000);
}

module.exports = {
  handleWebhookEvent,
  startBackgroundJobs,
  processQueue
};
