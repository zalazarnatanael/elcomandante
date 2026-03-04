const { Client } = require("@notionhq/client");
const { NotionToMarkdown } = require("notion-to-md");
const { Octokit } = require("@octokit/rest");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

const { projects } = require("../config/projects");
const { getProjectSecrets, isDbConfigured } = require("../services/database");
const { decrypt } = require("../services/encryptionService");

const UPLOADS_PATH = path.join(process.env.HOME, ".openclaw/public/uploads");

function getTitle(page) {
  const props = page.properties || {};
  const direct = props["Tarea"]?.title;
  let titleArr = direct;
  if (!titleArr) {
    const key = Object.keys(props).find(k => props[k]?.type === "title");
    titleArr = key ? props[key].title : [];
  }
  return (titleArr || []).map(x => x.plain_text).join("").trim();
}

function getRichText(page, propName) {
  const rt = page.properties?.[propName]?.rich_text || [];
  return rt.map(x => x.plain_text).join("").trim();
}

function getMultiSelect(page, propName) {
  const ms = page.properties?.[propName]?.multi_select || [];
  return ms.map(x => x.name).join(", ");
}

async function getPageComments(notion, pageId) {
  try {
    const response = await notion.comments.list({ block_id: pageId });
    if (!response.results || response.results.length === 0) return "";

    let commentsText = "**💬 Comentarios:**\n\n";
    for (const comment of response.results) {
      const text = comment.rich_text.map(t => t.plain_text).join("");
      commentsText += `> ${text}\n\n`;
    }
    return commentsText;
  } catch (error) {
    console.log("⚠️ No se pudieron obtener los comentarios.", error.message);
    return "";
  }
}

async function processMarkdownImages(markdown) {
  const regex = /!\[([^\]]*)\]\((https:\/\/prod-files-secure\.s3\.us-west-2\.amazonaws\.com\/[^)]+)\)/g;
  let match;
  let newMarkdown = markdown;
  const vpsUrl = process.env.VPS_URL;

  if (!vpsUrl) {
    console.error("❌ [ERROR] Falta VPS_URL en el .env. No se pueden re-hostear imágenes.");
    return markdown;
  }

  while ((match = regex.exec(markdown)) !== null) {
    const altText = match[1] || "image";
    const notionUrl = match[2];

    try {
      console.log(`📥 Descargando imagen de Notion para re-hosting...`);

      const response = await fetch(notionUrl);
      if (!response.ok) throw new Error(`Falló la descarga: ${response.statusText}`);

      const contentType = response.headers.get("content-type");
      let ext = "jpg";
      if (contentType?.includes("image/png")) ext = "png";
      if (contentType?.includes("image/gif")) ext = "gif";
      if (contentType?.includes("image/webp")) ext = "webp";

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const hash = crypto.createHash("md5").update(notionUrl).digest("hex");
      const filename = `notion_${hash}.${ext}`;
      const filepath = path.join(UPLOADS_PATH, filename);

      fs.mkdirSync(UPLOADS_PATH, { recursive: true });
      fs.writeFileSync(filepath, buffer);
      const hostedUrl = `${vpsUrl}/uploads/${filename}`;
      newMarkdown = newMarkdown.replace(notionUrl, hostedUrl);
    } catch (error) {
      console.log("⚠️ Error re-hosting de imagen:", error.message);
    }
  }

  return newMarkdown;
}

async function loadProjectSecrets(projectId) {
  if (!isDbConfigured()) throw new Error("DB no configurada");
  const result = await getProjectSecrets(projectId);
  const secrets = {};
  result.forEach(row => {
    secrets[row.key_name] = decrypt(row.encrypted_value);
  });
  return secrets;
}

async function expandReadyTasksForProject(projectId, projectConfig) {
  const secrets = await loadProjectSecrets(projectId);
  const notion = new Client({ auth: secrets.NOTION_TOKEN });
  const n2m = new NotionToMarkdown({ notionClient: notion });
  const octokit = new Octokit({ auth: secrets.GITHUB_TOKEN });

  const response = await notion.databases.query({
    database_id: projectConfig.notion.databaseId,
    filter: {
      property: "Estado",
      status: { equals: "READY" }
    }
  });

  if (!response?.results?.length) return;

  for (const page of response.results) {
    const title = getTitle(page) || "Nueva tarea";
    const description = getRichText(page, "Descripcion") || "";
    const tags = getMultiSelect(page, "Tags") || "";
    const comments = await getPageComments(notion, page.id);

    const mdBlocks = await n2m.pageToMarkdown(page.id);
    const mdString = n2m.toMarkdownString(mdBlocks);
    const fullContent = await processMarkdownImages(mdString.parent || "");

    const issueBody = [
      `Notion-PageId: ${page.id}`,
      tags ? `Tags: ${tags}` : null,
      "",
      description,
      "",
      fullContent,
      "",
      comments
    ].filter(Boolean).join("\n");

    const issue = await octokit.rest.issues.create({
      owner: projectConfig.github.owner,
      repo: projectConfig.github.repo,
      title,
      body: issueBody,
      labels: ["from-notion"]
    });

    console.log(`✅ [${projectId}] Issue creado: #${issue.data.number}`);

    await notion.pages.update({
      page_id: page.id,
      properties: {
        "Estado": { status: { name: "GH ISSUE" } }
      }
    });
  }
}

async function main() {
  const projectIds = Object.keys(projects);
  for (const projectId of projectIds) {
    const projectConfig = projects[projectId];
    if (!projectConfig?.notion?.databaseId) {
      console.log(`ℹ️ [${projectId}] Sin notion_database_id, se omite.`);
      continue;
    }
    try {
      await expandReadyTasksForProject(projectId, projectConfig);
    } catch (err) {
      console.error(`❌ [${projectId}] Error:`, err.message);
    }
  }
}

main().catch(err => {
  console.error("❌ [CRON] Error fatal:", err.message);
  process.exit(1);
});
