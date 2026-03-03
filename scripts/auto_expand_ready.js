const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });

function getTitle(page) {
  const t = page.properties?.["Tarea"]?.title || [];
  return t.map(x => x.plain_text).join("").trim();
}

function getRichText(page, propName) {
  const rt = page.properties?.[propName]?.rich_text || [];
  return rt.map(x => x.plain_text).join("").trim();
}

function getMultiSelect(page, propName) {
  const ms = page.properties?.[propName]?.multi_select || [];
  return ms.map(x => x.name).join(", ");
}

function toRichTextChunks(text, chunkSize = 1800) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) chunks.push(text.slice(i, i + chunkSize));
  return chunks.map(c => ({ text: { content: c } }));
}

function parseRichText(line) {
  const parts = line.split(/\*\*/);
  const rich = [];
  for (let i = 0; i < parts.length; i++) {
    const content = parts[i];
    if (!content) continue;
    const bold = i % 2 === 1;
    rich.push({ text: { content }, annotations: { bold } });
  }
  return rich.length ? rich : [{ text: { content: line } }];
}

function expansionToBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Headings: # / ## / ###
    const h = line.match(/^(#+)\s+(.*)$/);
    if (h) {
      const level = Math.min(h[1].length, 3);
      const type = level === 1 ? "heading_1" : level === 2 ? "heading_2" : "heading_3";
      blocks.push({
        object: "block",
        type,
        [type]: { rich_text: parseRichText(h[2]) }
      });
      continue;
    }

    // Bullet list
    if (line.startsWith("- ") || line.startsWith("• ")) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: parseRichText(line.replace(/^[-•]\s+/, "")) }
      });
      continue;
    }

    // Numbered list like "1." or "1)"
    if (/^\d+[\.)]\s+/.test(line)) {
      blocks.push({
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: parseRichText(line.replace(/^\d+[\.)]\s+/, "")) }
      });
      continue;
    }

    // Default paragraph
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: parseRichText(line) }
    });
  }

  return blocks;
}

// ✅ IMPORTANTE: reemplazá esto por tu llamada real a OpenClaw.
// Si tu OpenClaw expone HTTP local, poné el fetch acá.
async function openclawExpand(prompt) {
  const url = process.env.OPENCLAW_EXPAND_URL || "http://127.0.0.1:3030/expand";
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt })
  });

  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || "OpenClaw expand failed");
  return data.text;
}

async function expandOne(page) {
  const title = getTitle(page);
  const description = getRichText(page, "Descripción");
  const type = getMultiSelect(page, "Etiquetas");

  if (!title) return { skipped: true, reason: "missing_title" };

  const prompt = `
Actuá como arquitecto senior full‑stack.

Expandí técnicamente el siguiente ítem del backlog.

Título:
${title}

Tipo:
${type}

Descripción:
${description}

Devolvé en ESPAÑOL.
Incluí una línea inicial corta de contexto (por ejemplo: “A continuación…”) y mantené **negritas** usando **texto**.
Usá secciones numeradas y viñetas simples.

Secciones obligatorias:
1) Análisis técnico
2) Impacto (DB / API / UI)
3) Pasos de implementación
4) Riesgos
5) Tests sugeridos
6) ¿Breaking change? (Sí/No + Por qué)
`.trim();

  const expansion = await openclawExpand(prompt);

  await notion.pages.update({
    page_id: page.id,
    properties: {
      "Technical Expansion": { rich_text: toRichTextChunks(expansion) },
      "Estado": { status: { name: "Expanded" } }
    }
  });

  // Agregar bloques formateados a la página para lectura completa
  const blocks = expansionToBlocks(expansion);
  for (let i = 0; i < blocks.length; i += 50) {
    await notion.blocks.children.append({
      block_id: page.id,
      children: blocks.slice(i, i + 50)
    });
  }

  return { ok: true, title };
}

async function main() {
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) throw new Error("Missing NOTION_DATABASE_ID");

  // Trae solo Ready, y limita cantidad por corrida para evitar costos
  const pageSize = Number(process.env.AUTO_EXPAND_LIMIT || 3);

  const queryArgs = {
    filter: {
      property: "Estado",
      status: { equals: "Ready" }
    },
    page_size: Math.min(pageSize, 10)
  };

  let res;
  if (notion.databases?.query) {
    res = await notion.databases.query({
      database_id: databaseId,
      ...queryArgs
    });
  } else if (notion.dataSources?.query) {
    res = await notion.dataSources.query({
      data_source_id: databaseId,
      ...queryArgs
    });
  } else {
    throw new Error("Notion client has no query method (databases/dataSources)");
  }

  if (!res.results.length) {
    console.log("No Ready tickets.");
    return;
  }

  console.log(`Found ${res.results.length} Ready tickets...`);

  for (const page of res.results) {
    try {
      const out = await expandOne(page);
      if (out.ok) console.log("Expanded:", out.title);
      else console.log("Skipped:", out.reason);
    } catch (e) {
      console.error("Failed page:", page.id, e.message);
      // Opcional: marcar Estado = Error
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
