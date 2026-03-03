/**
 * init.js — Analiza el repo y genera PROJECT_CONTEXT.md con Claude
 * 
 * Uso: node scripts/init.js
 * 
 * Este script lee todo tu proyecto, se lo manda a Claude, y genera un archivo
 * PROJECT_CONTEXT.md en la raíz del repo con las convenciones detectadas.
 * Después, el auto-pr.js usa ese archivo como contexto en cada llamada.
 * 
 * Corré este script:
 *   - La primera vez que configurás el proyecto
 *   - Cuando hagas cambios grandes en la arquitectura
 *   - Cuando agregues nuevas librerías o convenciones
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config();

// ============================================================
// CONFIGURACIÓN
// ============================================================
const REPO_PATH = path.join(process.env.HOME, "openclaw-workspace/repos/v0-ferreteria");
const OUTPUT_FILE = path.join(REPO_PATH, "PROJECT_CONTEXT.md");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".css", ".sql", ".prisma", ".json", ".md"];
const IGNORE_DIRS = [
    "node_modules", ".next", ".git", "dist", "build", ".turbo",
    ".vercel", "coverage", ".husky", ".vscode", "__tests__", "test",
];

const MAX_FILE_SIZE = 60000;  // 60KB máximo por archivo
const MAX_TOTAL_SIZE = 350000; // 350KB máximo total de contexto

// ============================================================
// LECTURA DEL REPO
// ============================================================

function getFileTree(dirPath, prefix = "", depth = 0, maxDepth = 6) {
    if (depth > maxDepth) return "";
    const dirName = path.basename(dirPath);
    if (IGNORE_DIRS.includes(dirName)) return "";

    let tree = "";
    let entries;
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
        return "";
    }

    entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
    });

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (entry.name.startsWith(".") && depth === 0 && entry.isDirectory()) continue;

        const isLast = i === entries.length - 1;
        const connector = isLast ? "└── " : "├── ";
        const childPrefix = isLast ? "    " : "│   ";

        if (entry.isDirectory()) {
            if (IGNORE_DIRS.includes(entry.name)) continue;
            tree += `${prefix}${connector}${entry.name}/\n`;
            tree += getFileTree(path.join(dirPath, entry.name), prefix + childPrefix, depth + 1, maxDepth);
        } else {
            const ext = path.extname(entry.name).toLowerCase();
            if (CODE_EXTENSIONS.includes(ext) || entry.name.startsWith(".env") || entry.name.startsWith(".eslint")) {
                tree += `${prefix}${connector}${entry.name}\n`;
            }
        }
    }

    return tree;
}

function collectAllFiles(dirPath, relativeTo = "") {
    const files = [];

    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const relPath = path.join(relativeTo, entry.name);
            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
                if (!IGNORE_DIRS.includes(entry.name) && !entry.name.startsWith(".")) {
                    files.push(...collectAllFiles(fullPath, relPath));
                }
            } else {
                const ext = path.extname(entry.name).toLowerCase();
                if (CODE_EXTENSIONS.includes(ext) || entry.name === ".env.example") {
                    try {
                        const stat = fs.statSync(fullPath);
                        if (stat.size <= MAX_FILE_SIZE) {
                            files.push({
                                path: relPath,
                                content: fs.readFileSync(fullPath, "utf-8"),
                                size: stat.size,
                            });
                        }
                    } catch {}
                }
            }
        }
    } catch {}

    return files;
}

// Priorizar archivos más importantes primero
function prioritizeFiles(files) {
    const priority = {
        "package.json": 1,
        "tsconfig.json": 2,
        "next.config": 3,
        "tailwind.config": 4,
        ".env.example": 5,
        "layout": 10,
        "page": 11,
        "globals.css": 12,
        "middleware": 13,
        "utils": 14,
        "lib/": 15,
        "components/ui": 16,
        "components/": 20,
        "app/": 25,
        "pages/": 25,
        "api/": 30,
    };

    return files.sort((a, b) => {
        const getPriority = (filePath) => {
            for (const [key, val] of Object.entries(priority)) {
                if (filePath.includes(key)) return val;
            }
            return 50;
        };
        return getPriority(a.path) - getPriority(b.path);
    });
}

function buildFullRepoContent() {
    console.log("📂 Leyendo el repo completo...\n");

    // Árbol
    const tree = getFileTree(REPO_PATH);
    let content = `## ESTRUCTURA DE ARCHIVOS\n\`\`\`\n${tree}\`\`\`\n\n`;

    // Archivos priorizados
    let allFiles = collectAllFiles(REPO_PATH);
    allFiles = prioritizeFiles(allFiles);

    console.log(`   📄 ${allFiles.length} archivos encontrados.`);

    content += `## CONTENIDO DE ARCHIVOS\n\n`;
    let totalSize = content.length;
    let includedCount = 0;

    for (const file of allFiles) {
        const fileBlock = `### ${file.path}\n\`\`\`${path.extname(file.path).replace(".", "")}\n${file.content}\n\`\`\`\n\n`;

        if (totalSize + fileBlock.length > MAX_TOTAL_SIZE) {
            console.log(`   ⚠️  Límite de contexto alcanzado. Se incluyeron ${includedCount} de ${allFiles.length} archivos.`);
            break;
        }

        content += fileBlock;
        totalSize += fileBlock.length;
        includedCount++;
    }

    console.log(`   ✅ ${includedCount} archivos incluidos (~${(totalSize / 1024).toFixed(1)}KB)\n`);
    return content;
}

// ============================================================
// LLAMADA A CLAUDE PARA GENERAR EL CONTEXTO
// ============================================================

async function generateProjectContext() {
    if (!process.env.ANTHROPIC_API_KEY) {
        console.error("❌ ANTHROPIC_API_KEY no está configurada en .env");
        process.exit(1);
    }

    if (!fs.existsSync(REPO_PATH)) {
        console.error(`❌ La ruta del repo no existe: ${REPO_PATH}`);
        process.exit(1);
    }

    console.log("🚀 Inicializando análisis del proyecto...\n");

    const repoContent = buildFullRepoContent();

    console.log("🧠 Enviando a Claude para análisis...\n");

    const systemPrompt = `Eres un arquitecto de software senior. Tu tarea es analizar un proyecto completo y generar un documento de contexto exhaustivo que otro modelo de IA pueda usar para generar código consistente con el proyecto.

El documento que generes será usado como referencia CADA VEZ que se genere código nuevo, así que tiene que ser preciso, completo y práctico.`;

    const userPrompt = `Analizá este proyecto completo y generá un documento PROJECT_CONTEXT.md con el siguiente formato:

# PROJECT_CONTEXT

## Stack Tecnológico
(Listar todas las tecnologías, frameworks, librerías con sus versiones exactas del package.json)

## Estructura del Proyecto
(Explicar la organización de carpetas y para qué se usa cada una)

## Convenciones de Código
- Naming conventions (archivos, componentes, variables, funciones)
- Cómo se estructuran los componentes React/Next.js
- Cómo se manejan los imports
- Cómo se usan los estilos (Tailwind classes patterns)
- Patrón de manejo de estado
- Patrón de manejo de errores

## Patrones del Proyecto
- Cómo se crean nuevas páginas/rutas
- Cómo se crean nuevos componentes
- Cómo se crean endpoints de API
- Cómo se conecta a la base de datos (si aplica)
- Cómo se manejan formularios
- Cómo se manejan las autenticaciones (si aplica)

## Componentes Reutilizables
(Listar los componentes UI existentes con sus props y cuándo usarlos)

## Archivos Clave
(Listar los archivos más importantes y qué hace cada uno)

## Reglas para Generar Código Nuevo
(Reglas concretas basadas en lo que observaste, por ejemplo:
- "Siempre usar 'use client' en componentes con estado"
- "Los estilos se aplican con className usando Tailwind"
- "Las páginas van en app/[ruta]/page.tsx"
- etc.)

## Dependencias Disponibles
(Listar las dependencias del package.json que se pueden usar, para no agregar nuevas innecesariamente)

---

PROYECTO A ANALIZAR:

${repoContent}`;

    try {
        const response = await fetch(ANTHROPIC_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": process.env.ANTHROPIC_API_KEY,
                "anthropic-version": ANTHROPIC_VERSION,
            },
            body: JSON.stringify({
                model: "claude-sonnet-4-5-20250929",
                max_tokens: 16384,
                system: systemPrompt,
                messages: [{ role: "user", content: userPrompt }],
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(`API Error ${response.status}: ${data.error?.message || JSON.stringify(data)}`);
        }

        if (!data.content?.[0]?.text) {
            throw new Error("Respuesta vacía de Claude");
        }

        let contextMd = data.content[0].text;

        // Si la respuesta se truncó, hacer una continuación
        if (data.stop_reason === "max_tokens") {
            console.log("⚠️  Respuesta truncada, pidiendo continuación...\n");

            const contResponse = await fetch(ANTHROPIC_API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": process.env.ANTHROPIC_API_KEY,
                    "anthropic-version": ANTHROPIC_VERSION,
                },
                body: JSON.stringify({
                    model: "claude-sonnet-4-5-20250929",
                    max_tokens: 8192,
                    system: systemPrompt,
                    messages: [
                        { role: "user", content: userPrompt },
                        { role: "assistant", content: contextMd },
                        { role: "user", content: "Continuá exactamente desde donde quedaste. No repitas lo anterior." },
                    ],
                }),
            });

            const contData = await contResponse.json();
            if (contData.content?.[0]?.text) {
                contextMd += "\n" + contData.content[0].text;
            }
        }

        // Agregar metadata
        const header = `<!-- 
  Generado automáticamente por init.js — ${new Date().toISOString()}
  Modelo: claude-sonnet-4-5-20250929
  Tokens: ${data.usage.input_tokens} entrada / ${data.usage.output_tokens} salida
  
  Para regenerar: node scripts/init.js
-->\n\n`;

        const finalContent = header + contextMd;

        // Guardar
        fs.writeFileSync(OUTPUT_FILE, finalContent, "utf-8");

        console.log(`✅ PROJECT_CONTEXT.md generado exitosamente!`);
        console.log(`📄 Ubicación: ${OUTPUT_FILE}`);
        console.log(`📊 Tamaño: ${(finalContent.length / 1024).toFixed(1)}KB`);
        console.log(`📊 Tokens usados: ${data.usage.input_tokens} entrada / ${data.usage.output_tokens} salida`);
        console.log(`\n💡 Ahora podés correr: node scripts/auto-pr.js`);
        console.log(`   El script va a usar este archivo como contexto automáticamente.\n`);

    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        process.exit(1);
    }
}

generateProjectContext();
