const { Client } = require("@notionhq/client");
const { NotionToMarkdown } = require("notion-to-md");
const { Octokit } = require("@octokit/rest");
const simpleGit = require("simple-git");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

// ============================================================
// CONFIGURACIÓN E INICIALIZACIÓN
// ============================================================
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const REPO_PATH = path.join(process.env.HOME, "openclaw-workspace/repos/v0-ferreteria");
const UPLOADS_PATH = path.join(process.env.HOME, ".openclaw/public/uploads"); 

const git = simpleGit(REPO_PATH);
const REPO_OWNER = "zalazarnatanael";
const REPO_NAME = "v0-ferreteria";

// ============================================================
// UTILIDADES (De Notion y Re-hosting)
// ============================================================

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

async function getPageComments(pageId) {
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

// Función Maestra para re-hostear imágenes de Notion a tu VPS
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
        const altText = match[1] || 'image';
        const notionUrl = match[2];

        try {
            console.log(`📥 Descargando imagen de Notion para re-hosting...`);
            
            const response = await fetch(notionUrl);
            if (!response.ok) throw new Error(`Falló la descarga: ${response.statusText}`);
            
            const contentType = response.headers.get('content-type');
            let ext = 'jpg'; 
            if (contentType?.includes('image/png')) ext = 'png';
            if (contentType?.includes('image/gif')) ext = 'gif';
            if (contentType?.includes('image/webp')) ext = 'webp';

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const hash = crypto.createHash('md5').update(notionUrl).digest('hex');
            const filename = `notion_${hash}.${ext}`;
            const filepath = path.join(UPLOADS_PATH, filename);

            if (!fs.existsSync(filepath)) {
                fs.writeFileSync(filepath, buffer);
                console.log(`✅ Imagen guardada localmente como ${filename}`);
            } else {
                console.log(`♻️  La imagen ya existía localmente.`);
            }

            const newVpsImageUrl = `${vpsUrl}/uploads/${filename}`;
            console.log(`🔄 Reemplazando URL en Markdown: ${newVpsImageUrl}`);
            newMarkdown = newMarkdown.replace(notionUrl, newVpsImageUrl);

        } catch (error) {
            console.error(`❌ Error re-hosteando imagen (${notionUrl}):`, error.message);
        }
    }
    return newMarkdown;
}

// ============================================================
// LÓGICA CORE: NOTION -> GITHUB (MODO PUENTE LIGERO)
// ============================================================

async function processAndPlanTask(page) {
    const title = getTitle(page);
    const description = getRichText(page, "Descripción");
    const tags = getMultiSelect(page, "Etiquetas");
    const notionLink = page.url;

    if (!title) return { skipped: true, reason: "missing_title" };

    console.log(`\n======================================================`);
    console.log(`📄 Procesando nueva tarea de Notion: "${title}"`);
    console.log(`======================================================`);

    const mdBlocks = await n2m.pageToMarkdown(page.id);
    const mdResult = n2m.toMarkdownString(mdBlocks);
    const rawPageContent = typeof mdResult === "string" ? mdResult : (mdResult.parent || "");

    const pageComments = await getPageComments(page.id);

    let pageContent = rawPageContent;
    if (rawPageContent.includes("prod-files-secure.s3")) {
        console.log("🔍 Se detectaron imágenes de Notion en el cuerpo. Iniciando Re-hosting...");
        pageContent = await processMarkdownImages(rawPageContent);
    }

    let issueBody = "";
    if (description) issueBody += `**Descripción:**\n${description}\n\n`;
    if (tags) issueBody += `**Etiquetas:** ${tags}\n\n`;
    if (pageContent) issueBody += `**Detalles y Adjuntos:**\n${pageContent}\n\n`;
    if (pageComments) issueBody += `${pageComments}\n`;
    issueBody += `\n---\n`;
    if (notionLink) issueBody += `Notion: ${notionLink}\n`;
    issueBody += `Notion-PageId: ${page.id}\n`;

    console.log("🌟 Creando Issue en GitHub...");
    const issue = await octokit.rest.issues.create({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        title: title,
        body: issueBody,
        // ETIQUETA CLAVE: Esto despierta a tu auto-pr.js para que haga el plan barato
        labels: ["from-notion"] 
    });
    console.log(`✅ Issue creado exitosamente: ${issue.data.html_url}`);

    await notion.pages.update({
        page_id: page.id,
        properties: { "Estado": { status: { name: "En GitHub" } } }
    });
    console.log(`🔄 Estado en Notion actualizado a 'En GitHub'.`);

    return { ok: true, title };
}

// ============================================================
// BUCLE PRINCIPAL (ORQUESTADOR)
// ============================================================

async function main() {
    const dataSourceId = process.env.NOTION_DATABASE_ID_FERRETERIA;
    if (!dataSourceId) throw new Error("Falta la variable NOTION_DATABASE_ID_FERRETERIA");

    console.log("🔍 Escaneando Notion en busca de tareas en estado 'Ready'...");

    const res = await notion.dataSources.query({
        data_source_id: dataSourceId,
        filter: { property: "Estado", status: { equals: "Ready" } }
    });

    if (!res.results.length) { console.log("☕ Nada nuevo."); return; }

    console.log(`🚀 ¡Encontradas ${res.results.length} tareas listas!`);

    for (const page of res.results) {
        try {
            const out = await processAndPlanTask(page);
            if (out.ok) console.log(`🎉 Tarea "${out.title}" migrada a GitHub.`);
        } catch (e) {
            console.error("❌ Falló la página:", page.id, e.message);
        }
    }
}

main().catch(err => { console.error("\n❌ Error Crítico:", err.message); });

setInterval(() => { main().catch(e => console.error("Error intervalo:", e.message)); }, 60000);
