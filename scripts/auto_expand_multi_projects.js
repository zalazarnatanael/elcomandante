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
const notionCredentialsManager = require("../services/notionCredentialsManager");
const logger = require("../logger");

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
  
  // Cargar workspaces de Notion del proyecto
  const workspaces = await notionCredentialsManager.getWorkspacesForProject(projectId);
  
  if (!workspaces || workspaces.length === 0) {
    logger.warn(`[${projectId}] No Notion workspaces linked, skipping`);
    return;
  }
  
  const octokit = new Octokit({ auth: secrets.GITHUB_TOKEN });
  
  // Procesar cada workspace del proyecto
  for (const workspace of workspaces) {
    logger.info(`[${projectId}] Processing workspace: ${workspace.workspace_id}`);
    
    const notion = new Client({ auth: workspace.api_key });
    const n2m = new NotionToMarkdown({ notionClient: notion });
    
    // Si no hay database_id en el mapeo, saltarlo
    if (!workspace.database_id) {
      logger.warn(`[${projectId}] No database_id for workspace ${workspace.workspace_id}, skipping`);
      continue;
    }

    try {
      const response = await notion.databases.query({
        database_id: workspace.database_id,
        filter: {
          property: "Estado",
          status: { equals: "READY" }
        }
      });

      if (!response?.results?.length) {
        logger.debug(`[${projectId}] No READY tasks in ${workspace.workspace_id}`);
        continue;
      }

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
          `Notion-Workspace: ${workspace.workspace_id}`,
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

        logger.info(`✅ [${projectId}] Issue #${issue.data.number} created from Notion`);

        // Actualizar estado en Notion
        await notion.pages.update({
          page_id: page.id,
          properties: {
            "Estado": { status: { name: "GH ISSUE" } }
          }
        });
      }
    } catch (error) {
      logger.error(`[${projectId}] Error processing workspace ${workspace.workspace_id}:`, error.message);
    }
  }
}

async function main() {
  // Inicializar credential manager
  await notionCredentialsManager.initRedis();
  
  const projectIds = Object.keys(projects);
  for (const projectId of projectIds) {
    const projectConfig = projects[projectId];
    try {
      await expandReadyTasksForProject(projectId, projectConfig);
    } catch (err) {
      logger.error(`❌ [${projectId}] Error:`, err.message);
    }
  }
}

main().catch(err => {
  logger.error("❌ [CRON] Error fatal:", err.message);
  process.exit(1);
});
