const { Client } = require("@notionhq/client");
require("dotenv").config();

const notionCredentialsManager = require("../services/notionCredentialsManager");
const logger = require("../logger");

const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const GH_TOKEN = process.env.GITHUB_TOKEN;

const OPENCLAW_EXPAND_URL = process.env.OPENCLAW_EXPAND_URL || "http://127.0.0.1:3030/expand";
const OPENCLAW_INTERNAL_TOKEN = process.env.OPENCLAW_INTERNAL_TOKEN || "";

function getTitle(page) {
  const t = page.properties?.["Tarea"]?.title || [];
  return t.map((x) => x.plain_text).join("").trim();
}

function getRichText(page, propName) {
  const rt = page.properties?.[propName]?.rich_text || [];
  return rt.map((x) => x.plain_text).join("").trim();
}

function getMultiSelect(page, propName) {
  const ms = page.properties?.[propName]?.multi_select || [];
  return ms.map((x) => x.name);
}

function notionUrlFromPage(page) {
  return page.url;
}

function mapLabelsFromEtiquetas(tags) {
  const labels = [];
  const lower = tags.map((t) => t.toLowerCase());

  if (lower.some((t) => t.includes("bug"))) labels.push("bug");
  if (lower.some((t) => t.includes("feature"))) labels.push("enhancement");
  if (lower.some((t) => t.includes("idea"))) labels.push("idea");
  if (lower.some((t) => t.includes("refactor"))) labels.push("refactor");

  // Siempre útil:
  labels.push("from-notion");
  labels.push("bot-working");

  return [...new Set(labels)];
}

async function getAllCommentsText(blockId) {
  let cursor = undefined;
  const parts = [];

  while (true) {
    const res = await notion.comments.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const c of res.results || []) {
      const text = (c.rich_text || []).map((rt) => rt.plain_text).join("");
      const cleaned = (text || "").trim();
      if (cleaned) parts.push(cleaned);
    }

    if (!res.has_more) break;
    cursor = res.next_cursor;
  }

  return parts.join("\n\n---\n\n").trim();
}

async function callOpenClawExpand(prompt) {
  const headers = { "Content-Type": "application/json" };
  if (OPENCLAW_INTERNAL_TOKEN) headers["X-Internal-Token"] = OPENCLAW_INTERNAL_TOKEN;

  const r = await fetch(OPENCLAW_EXPAND_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`OpenClaw expand failed: ${r.status} ${JSON.stringify(data)}`);
  }
  return (data?.text || "").trim();
}

async function createGitHubIssue({ title, body, labels }) {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title, body, labels }),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`GitHub issue create failed: ${r.status} ${text}`);
  }

  return await r.json(); // html_url, number
}

async function updateIssueLabels(issueNumber, labels) {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/issues/${issueNumber}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ labels }),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`GitHub issue update failed: ${r.status} ${text}`);
  }

  return await r.json();
}

async function updateNotionAfterIssue(pageId, issueUrl) {
  const props = {
    "GitHub Issue URL": { url: issueUrl },
    "Estado": { status: { name: "ready-to-code" } }
  };

  await notion.pages.update({
    page_id: pageId,
    properties: props,
  });
}

async function main() {
  if (!OWNER || !REPO || !GH_TOKEN) {
    throw new Error("Missing GITHUB_OWNER / GITHUB_REPO / GITHUB_TOKEN env vars.");
  }
  const notionDatabaseId =
    process.env.NOTION_DATABASE_ID_FERRETERIA || process.env.NOTION_DATABASE_ID;
  if (!notionDatabaseId) {
    throw new Error(
      "Missing NOTION_DATABASE_ID_FERRETERIA or NOTION_DATABASE_ID env var."
    );
  }

  const limit = Number(process.env.CREATE_ISSUES_LIMIT || 3);

  // Trae tickets Expanded que todavía no tienen Issue URL
  const queryArgs = {
    filter: {
      and: [
        { property: "Estado", status: { equals: "Expanded" } },
        { property: "GitHub Issue URL", url: { is_empty: true } },
      ],
    },
    page_size: Math.min(limit, 10),
  };

  let res;
  if (notion.databases?.query) {
    res = await notion.databases.query({
      database_id: notionDatabaseId,
      ...queryArgs,
    });
  } else if (notion.dataSources?.query) {
    res = await notion.dataSources.query({
      data_source_id: notionDatabaseId,
      ...queryArgs,
    });
  } else {
    throw new Error("Notion client has no query method (databases/dataSources)");
  }

  if (!res.results.length) {
    console.log("No Expanded tickets pending GitHub issue creation.");
    return;
  }

  for (const page of res.results) {
    const pageId = page.id;
    const title = getTitle(page);
    const description = getRichText(page, "Descripción");
    const tags = getMultiSelect(page, "Etiquetas");
    const labels = mapLabelsFromEtiquetas(tags);

    if (!title) {
      console.log("Skipping page with missing title:", pageId);
      continue;
    }

    // 1) Comentarios (tu “expansión” actual)
    let commentsText = "";
    try {
      commentsText = await getAllCommentsText(pageId);
    } catch (e) {
      console.error("Could not read comments for page:", pageId, e.message);
    }

    // 2) Re-ordenar/limpiar con tu OpenClaw server para que salga “bien explicado”
    const refinePrompt = `
Sos un senior full-stack. Convertí esta info en un issue de GitHub bien estructurado.

Título: ${title}

Descripción (Notion):
${description || "(vacío)"}

Notas/expansión (comentarios de Notion):
${commentsText || "(sin comentarios)"}

Devolvé Markdown con estas secciones:
- Contexto
- Problema / Objetivo
- Solución propuesta
- Pasos de implementación (checklist)
- Riesgos
- Tests sugeridos
- Criterios de aceptación
`.trim();

    let refinedBody = "";
    try {
      refinedBody = await callOpenClawExpand(refinePrompt);
    } catch (e) {
      console.error("OpenClaw refine failed, falling back to raw comments:", e.message);
      refinedBody = [
        `## Contexto`,
        description ? description : "_(No description provided)_",
        ``,
        `## Notas (comentarios Notion)`,
        commentsText ? commentsText : "_(No comments found)_",
      ].join("\n");
    }

    const notionLink = notionUrlFromPage(page);
    const body = [
      refinedBody,
      ``,
      `---`,
      `## Notion Reference`,
      `<a href="${notionLink}" target="_blank">${notionLink}</a>`,
      ``,
      `Notion: ${notionLink}`,
      `Notion-PageId: ${pageId}`,
    ].join("\n");

    try {
      const issue = await createGitHubIssue({ title, body, labels });
      try {
        const nextLabels = [...new Set([...labels, "bot-working"])]
        await updateIssueLabels(issue.number, nextLabels);
      } catch (e) {
        console.error(`No se pudo agregar bot-working en #${issue.number}:`, e.message);
      }
      await updateNotionAfterIssue(pageId, issue.html_url);
      console.log(`Created issue: ${issue.html_url}`);
    } catch (e) {
      console.error("Failed for page:", pageId, e.message);
      // Opcional: marcar Estado = Error
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
