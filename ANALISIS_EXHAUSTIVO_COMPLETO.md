# ANÁLISIS EXHAUSTIVO DEL PROYECTO OPENCLAW

**Fecha:** 4 de Marzo de 2026  
**Versión:** 1.0 - COMPLETO  
**Estado:** Listo para referencia y refactoring

---

## TABLA DE CONTENIDOS

1. [Estructura de Directorios](#1-estructura-de-directorios)
2. [Flujo Completo Notion → GitHub → Desarrollo](#2-flujo-completo-notion--github--desarrollo)
3. [Modelos IA Disponibles](#3-modelos-ia-disponibles)
4. [Variables de Entorno (.env)](#4-variables-de-entorno-env)
5. [Ejecución del Bot](#5-ejecución-del-bot)
6. [Notificaciones y Logs](#6-notificaciones-y-logs)
7. [Dependencias NPM](#7-dependencias-npm)
8. [Puntos de Integración Externos](#8-puntos-de-integración-externos)
9. [Limitaciones Actuales](#9-limitaciones-actuales)
10. [Refactoring Multiproyecto](#10-refactoring-multiproyecto)

---

## 1. ESTRUCTURA DE DIRECTORIOS

### 1.1 Vista General

```
/root/.openclaw/                          (4.8M total)
│
├── 📄 ARCHIVOS RAÍZ (configuración + entrada)
│  ├── main.js                            (332 líneas) ⭐ FLOW: PLAN + BUILD
│  ├── webhook-server.js                  (535 líneas) ⭐ MAIN: Webhooks + Queue
│  ├── ecosystem.config.js                (16 líneas)  ⭐ PM2 Config
│  ├── config.js                          (19 líneas)  Deprecated (usar constants.js)
│  ├── notionExpand.js                    (87 líneas)  Notion expansión (incomplete)
│  ├── package.json                       Dependencias
│  └── .env                               Secretos + configuración
│
├── 📁 services/                          (6 archivos, ~1200 LOC) ⭐⭐
│  ├── aiService.js                       (363 líneas) ⭐ OpenCode integration + fallbacks
│  ├── sessionContext.js                  (157 líneas) ⭐ Persistencia plan + feedback
│  ├── executionStateManager.js           (176 líneas) ⭐ Tracking de ejecución
│  ├── worktreeManager.js                 (60 líneas)  ⭐ Git worktrees
│  ├── githubRetry.js                     (92 líneas)  Retry logic + exponential backoff
│  └── telegramNotify.js                  (75 líneas)  Notificaciones (Telegram)
│
├── 📁 config/                            (1 archivo, 23 LOC)
│  └── constants.js                       ⚠️ Configuración hardcodeada aquí
│
├── 📁 agents/
│  └── main/
│     ├── agent/
│     │  ├── models.json                  (github-copilot providers)
│     │  └── auth.json                    (auth data)
│     └── sessions/
│        └── sessions.json                OpenClaw agent sessions
│
├── 📁 scripts/                           (5 archivos)
│  ├── auto_expand_ready_ferreteria.js    (207 LOC) ⭐ Notion → GitHub (CRON)
│  ├── auto_expand_ready.js               (213 LOC) Alternativo
│  ├── create_github_issues_from_expanded.js (273 LOC)
│  ├── openclaw_expand_server.js          (76 LOC)  HTTP server para expand
│  └── init.js                            (341 LOC) Inicialización
│
├── 📁 session_logs/                      (380K) 📊 Persistencia de sesiones
│  └── issue-X.json                       { plans: [], feedback: [], lastCommentId }
│
├── 📁 execution_states/                  (8K) 📊 Tracking de ejecución
│  └── issue-X.json                       { status, planAttempts, buildAttempts, ... }
│
├── 📁 logs/                              (1.8M) 📊 Logs de ejecución
│  ├── out.log                            Stdout de PM2
│  ├── err.log                            Stderr de PM2
│  └── issue-X.log                        Logs específicos por issue
│
├── 📁 devices/                           Bot devices tracking
│  ├── paired.json
│  └── pending.json
│
├── 📁 credentials/                       Credenciales (sensible)
├── 📁 identity/                          Identity info
├── 📁 telegram/                          Telegram config
├── 📁 canvas/                            Canvas data
├── 📁 completions/                       OpenCode completions
├── 📁 public/                            (4.1M) Static files + uploads
│  └── uploads/                           Imágenes de Notion rehosteadas
│
└── 📁 workspace/                         (1.1M) OpenClaw workspace
   ├── skills/notion/                     Notion skill
   ├── memory/                            Memory files
   ├── config/                            Workspace config
   └── node_modules/                      Dependencies
```

### 1.2 Descripción de Directorios Clave

| Directorio | Tamaño | Propósito | Importante |
|-----------|--------|---------|-----------|
| `/services` | 1.2K LOC | Core business logic | ⭐⭐⭐ |
| `/session_logs` | 380K | Persistencia de contexto | ⭐⭐⭐ |
| `/execution_states` | 8K | Tracking de ejecución | ⭐⭐ |
| `/logs` | 1.8M | Auditoría de ejecución | ⭐⭐ |
| `/scripts` | 1.1K LOC | Cron + inicialización | ⭐⭐ |
| `/agents` | - | Agent sessions (OpenClaw) | ⭐ |
| `/public/uploads` | 4.1M | Images rehosteadas | - |
| `/workspace` | 1.1M | OpenClaw workspace | - |

---

## 2. FLUJO COMPLETO NOTION → GITHUB → DESARROLLO

### 2.1 Flujo Completo (Diagrama Textual)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE 1: NOTION CARD → GITHUB ISSUE (Manual o Cron)                        │
└─────────────────────────────────────────────────────────────────────────────┘

  Notion DB (Ferreteria)
        ↓
  (Script: auto_expand_ready_ferreteria.js)
        ↓ [CRON o manual trigger]
  GitHub Issue creado + label "from-notion"
        ↓
  Webhook: issues.opened + labeled
        ↓
  webhook-server.js recibe
        ↓
  Enqueue task "PLAN"


┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE 2: PLAN FLOW (Análisis READ-ONLY)                                    │
└─────────────────────────────────────────────────────────────────────────────┘

  runPlanFlow(issue) en main.js
        ↓
  1. Add label: "bot-working"
  2. Load session (session_logs/issue-X.json)
  3. Update session with feedback from comments
  4. Build prompt: buildPlanPrompt() + feedback histórico
        ↓
  Call runOpenCode(issueNumber, instruction, isProgrammer=false)
        ↓ [aiService.js]
  1. Write instruction to .prompt-X.txt
  2. Execute: opencode run --model MODEL --dir REPO_PATH --session "..."
        ↓
  CRITICAL: detectWriteAttempts() → If found, fallback to safe model
        ↓
  Model Output → Cleaned + saved to session.plans[]
        ↓
  5. Post comment con plan a GitHub
  6. Add label: "awaiting-human-intervention"
  7. Remove labels: "from-notion", "awaiting-ia-intervention", "bot-working"
        ↓
  ⏸️ WAITING FOR HUMAN FEEDBACK


┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE 2B: FEEDBACK LOOP (Iterativo)                                        │
└─────────────────────────────────────────────────────────────────────────────┘

  Human comments on issue
        ↓
  Webhook: issue_comment.created
        ↓
  Check: isBotComment() → Skip si es bot
        ↓
  Enqueue task "REPLAN" + Add label "awaiting-ia-intervention"
        ↓
  runPlanFlow() again (repetir STAGE 2)
        ↓
  New plan generado (considerando feedback)
        ↓
  ⏸️ WAITING AGAIN


┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE 3: READY → BUILD FLOW (Implementación WRITE)                         │
└─────────────────────────────────────────────────────────────────────────────┘

  Human aproба y agrega label "ready-for-development"
        ↓
  Webhook: issues.labeled
        ↓
  Enqueue task "BUILD"
        ↓
  runBuildFlow(issue) en main.js
        ↓
  1. Add label: "bot-working"
  2. Create/checkout git worktree: ~/openclaw-workspace/worktrees/issue-X
  3. Load last plan from session.plans[] or GitHub comments
  4. Build instruction: "Sigue este plan:\n{plan}\n\nEJECUTA AHORA"
        ↓
  Call runOpenCode(issueNumber, instruction, isProgrammer=true)
        ↓ [aiService.js BUILD MODE]
  1. Write instruction to .prompt-X.txt
  2. Execute: opencode --model BUILD_MODEL run --dir WORKTREE_PATH
        ↓
  Model implementa cambios en worktree
        ↓
  3. Check git status de worktree
  4. If cambios detectados:
        ↓
     a. Git add + commit: "feat: fix #X"
     b. Git push origin task/issue-X (--force)
     c. Create PR: v0-ferreteria/pull/
        ↓
     Pull Request creado → body contiene "Resolves #X"
        ↓
  5. Remove labels: "bot-working"
  6. Add label: "pr-generated"


┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE 4: MERGE → COMPLETION (Cierre)                                       │
└─────────────────────────────────────────────────────────────────────────────┘

  Human revisa PR + aprueba
        ↓
  PR merged a main
        ↓
  Webhook: pull_request.closed + merged=true
        ↓
  handlePrClosed(pr) en webhook-server.js
        ↓
  1. Extract issueNumber from PR body: "Resolves #X"
  2. If NOTION_DATABASE_ID configured:
        ↓
     a. Find Notion page_id (from issue body)
     b. UPDATE Notion page: Estado = "Completada"
     c. Log success
        ↓
  3. DONE! Enumeración completa
```

### 2.2 Servicios Auxiliares

#### 2.2.1 **aiService.js** - Orquestador de IA

```javascript
// Función principal: runOpenCode()
async function runOpenCode(issueNumber, instruction, isProgrammer = false, options = {})
  
  // Pasos:
  1. incrementBuildAttempt() / incrementPlanAttempt()
  2. getPlannerConfig() → selecciona modelo si es PLAN
  3. buildBaseCommand(isProgrammer, model) → construye comando
  4. Ejecuta: spawn(command, { cwd, shell: true })
  5. Detecta errores y fallbacks
  6. recordPlanExecution() → tracking
```

**Métodos clave:**
- `buildBaseCommand()` - Construye comando opencode
- `getPlannerConfig()` - Selecciona modelo planner basado en env vars
- `shouldFallbackToPlanner()` - Detecta si debe hacer fallback
- `selectFallbackBuildModel()` - Cadena de fallback para BUILD
- `selectFallbackPlannerModel()` - Cadena de fallback para PLAN
- `detectWriteAttempts()` - CRITICAL: Detecta intentos de write en PLAN mode

#### 2.2.2 **sessionContext.js** - Persistencia

```javascript
// Función principal: loadSession(issueNumber)

Session JSON structure:
{
  "issueNumber": 102,
  "lastCommentId": 12345,
  "plans": [
    { "createdAt": "2026-03-04T...", "body": "### 📋 Plan ..." }
  ],
  "feedback": [
    { "id": 1, "author": "user", "createdAt": "...", "body": "..." }
  ]
}
```

**Métodos clave:**
- `loadSession()` - Lee JSON
- `saveSession()` - Escribe JSON
- `updateSessionWithComments()` - Extrae feedback de comentarios
- `buildPlanPrompt()` - Construye prompt CON contexto histórico
- `stripModelErrors()` - Limpia errores de modelo en respuestas

#### 2.2.3 **executionStateManager.js** - Tracking

```javascript
// Función principal: getExecutionState(issueNumber)

State JSON structure:
{
  "issueNumber": 102,
  "status": "in_progress",        // pending, in_progress, completed, failed
  "plansExecuted": [
    { "planHash": "abc123...", "timestamp": "...", "status": "completed", ... }
  ],
  "buildAttempts": 2,
  "planAttempts": 1
}
```

**Previene loop de planes duplicados:**
- `recordPlanExecution()` - Hashea plan (SHA256 truncado a 12 chars)
- `hasBeenExecuted()` - Checkea si plan ya fue ejecutado
- `getExecutedPlanHashes()` - Devuelve lista de planes completados

#### 2.2.4 **worktreeManager.js** - Git Isolation

```javascript
async function ensureWorktree(issueNumber, branch)
  ↓
  Path: ~/openclaw-workspace/worktrees/issue-X
  ↓
  1. Clone repo si no existe
  2. Create worktree: git worktree add --no-checkout
  3. Checkout branch: git checkout -b task/issue-X
  4. Return worktree path
```

**Ventajas:**
- Cambios aislados por issue
- No afecta repo principal
- Limpieza automática posible

#### 2.2.5 **githubRetry.js** - Resilencia

```javascript
async function withRetry(fn, options = {})
  ↓ maxAttempts: 4 (default)
  ↓ baseDelayMs: 500 (default)
  ↓ Exponential backoff con jitter
  
Retryable errors:
  - 500, 502, 503, 504 (server errors)
  - ETIMEDOUT, ECONNRESET, ECONNREFUSED (network)
  - EAI_AGAIN, ENOTFOUND, ECONNABORTED (DNS)

Non-retryable (fail fast):
  - 401, 403 (auth errors)
  - Otros errores (throw immediately)
```

#### 2.2.6 **telegramNotify.js** - Alertas

```javascript
function sendTelegramMessage(message)
  ↓ Busca token en:
    1. process.env.TELEGRAM_BOT_TOKEN
    2. process.env.OPENCLAW_TELEGRAM_BOT_TOKEN
    3. openclaw.json config
  ↓ Busca chat_id en:
    1. TELEGRAM_CHAT_ID env var
    2. sessions.json deliveryContext
  ↓ HTTP POST a api.telegram.org/bot{token}/sendMessage
```

### 2.3 Sistema de Colas (webhook-server.js)

```javascript
const queue = []                    // Array de tasks
const maxConcurrent = 3             // Máx 3 workers simultáneamente
let activeWorkers = 0
const inFlightIssues = new Set()    // Issues siendo procesados

function processQueue()
  ↓
  While activeWorkers < 3:
    1. Find next task (no issue duplicado)
    2. Mark issue como "in flight"
    3. Execute task
    4. On complete: remove from "in flight"
    5. Reschedule processQueue() en 100ms
```

**Características:**
- **FIFO ordering:** First-In-First-Out justo
- **1 issue = 1 worker:** Secuencial (PLAN → BUILD)
- **3 max workers:** Paralelo entre issues diferentes
- **Label cooldown:** 2500ms anti-spam

---

## 3. MODELOS IA DISPONIBLES

### 3.1 Modelos en Uso

| Modo | Modelo Primary | Fallback 1 | Fallback 2 | Status |
|------|---|---|---|---|
| **PLAN** | `opencode/trinity-large-preview-free` | `opencode/minimax-m2.5-free` | `opencode/big-pickle` | ✅ |
| **BUILD** | `github-copilot/claude-haiku-4.5` | `opencode/trinity-large-preview-free` | `opencode/minimax-m2.5-free` | ✅ |

### 3.2 Selección de Modelos

#### 3.2.1 PLAN Mode

```javascript
function selectPlannerModel(provider, profile)
  
  Env vars:
    PLANNER_PROVIDER: "auto" (default)
    PLANNER_PROFILE: "fast" (default) o "balanced"
    PLANNER_MODEL: override (si se quiere forzar)
  
  Presets:
    fast: "opencode/trinity-large-preview-free"
    balanced: "opencode/trinity-large-preview-free"
```

**Triggers para usar PLAN:**
- Instruction includes "### 📋 plan"
- Instruction includes "plan:", "plan ", "planificacion", "plan técnico"
- Si `options.forcePlanner = true`

#### 3.2.2 BUILD Mode

```javascript
BUILD_MODEL env var (default: "github-copilot/claude-haiku-4.5")

Si no está set: usa "github-copilot/claude-haiku-4.5"
```

### 3.3 Cadenas de Fallback

#### 3.3.1 Cuándo se Activan

```javascript
function shouldFallbackToPlanner(history, planner, options = {})
  
  Triggers:
    - "model not found"
    - "providermodelnotfounderror"
    - "provider not found"
    - "request too large"
    - "tpm" (Token Per Minute limit)
```

#### 3.3.2 Lógica de Fallback en PLAN Mode

```
trinity-large-preview-free (model A)
         ↓ [si error en triggers]
minimax-m2.5-free (model B)
         ↓ [si error]
big-pickle (model C)
         ↓ [si error]
FAIL (sin fallback)
```

#### 3.3.3 Lógica de Fallback en BUILD Mode

```
github-copilot/claude-haiku-4.5 (model A)
         ↓ [si error en triggers]
trinity-large-preview-free (model B)
         ↓ [si error]
minimax-m2.5-free (model C)
         ↓ [si error]
FAIL (sin fallback)
```

### 3.4 Read-Only Constraint en PLAN Mode

```javascript
// CRITICAL: Enforce read-only mode in PLAN
const readOnlyInstruction = `
⚠️ STRICTLY READ-ONLY MODE:
- Do NOT use Edit, Write, Delete, or any modification tools
- Only use Read, Grep, Glob for analysis if absolutely needed
- Output ONLY the technical plan
- NO tool output, NO logs, NO file diffs
`

// Si detecta intentos de write en PLAN mode:
detectWriteAttempts(output) → hasViolation = true
  ↓
Fuerza fallback a modelo "safe"
```

**Patrones detectados:**
- `← Edit` (Edit tool attempt)
- Diff lines starting with `-` (file changes)
- `Writing to file` patterns

---

## 4. VARIABLES DE ENTORNO (.env)

### 4.1 Variables Requeridas

| Variable | Propósito | Ejemplo | Opcional |
|----------|-----------|---------|----------|
| `GITHUB_TOKEN` | Acceso GitHub API | `ghp_...` | ❌ REQUIRED |
| `NOTION_TOKEN` | Acceso Notion API | `ntn_...` | ❌ REQUIRED |
| `NOTION_DATABASE_ID` | ID de la DB Ferreteria | `84abb0ef-...` | ❌ REQUIRED |

### 4.2 Variables Opcionales Importantes

| Variable | Propósito | Default | Opcional |
|----------|-----------|---------|----------|
| `GITHUB_WEBHOOK_SECRET` | Validación webhook | `FerreteriaOpenClaw2026Secreto!` | ✅ Si validás firma |
| `BOT_GITHUB_LOGIN` | Login del bot para ignorar | `zatogaming404-bot` | ✅ |
| `BUILD_MODEL` | Modelo para BUILD | `github-copilot/claude-haiku-4.5` | ✅ |
| `PLANNER_MODEL` | Override modelo PLAN | - | ✅ |
| `PLANNER_PROVIDER` | Provider planner | `auto` | ✅ |
| `PLANNER_PROFILE` | Profile planner | `fast` | ✅ |
| `OPENCLAW_EXPAND_URL` | URL del expand server | `http://127.0.0.1:3030/expand` | ✅ |
| `OPENCLAW_INTERNAL_TOKEN` | Token interno | `FerreteriaOpenClaw2026Secreto!Gianni` | ✅ |
| `VPS_URL` | IP pública VPS | `http://69.6.227.244:22022` | ✅ |
| `TELEGRAM_CHAT_ID` | Chat ID para notificaciones | - | ✅ |
| `TELEGRAM_BOT_TOKEN` | Token bot Telegram | - | ✅ |
| `GEMINI_API_KEY` | Google Gemini | `AIzaSyDkqqwJcGrh8vu3...` | ✅ |
| `GROQ_API_KEY` | Groq API | `gsk_rhpNiOo5lznb4z2D32E...` | ✅ |

### 4.3 Repos Soportados

```javascript
// En config/constants.js (HARDCODED):
REPO_OWNER: "zalazarnatanael"
REPO_NAME: "v0-ferreteria"

// Puede ser overrideado en .env (documentado pero no usado):
REPO_OWNER=... / REPO_NAME=... (comentario en .env)
```

### 4.4 Secretos Sensibles Presentes en .env

```
⚠️ CRÍTICO: Archivo .env contiene:
  - GITHUB_TOKEN (acceso completo repo)
  - NOTION_TOKEN (acceso DB personal)
  - OPENAI_API_KEY (billing API)
  - GEMINI_API_KEY (billing API)
  - GROQ_API_KEY (billing API)
  - TELEGRAM_BOT_TOKEN (control bot)
  
🔓 Problema: .env está en versionable (en /root/.openclaw)
   → Tokens expuestos
   → Riesgo de leak si repo es público
   → Debería usarse Vault o .env.local
```

---

## 5. EJECUCIÓN DEL BOT

### 5.1 Inicio con PM2

```bash
# Start
pm2 start ecosystem.config.js

# Configuración (ecosystem.config.js):
name: "bot-ferreteria"
script: "./main.js"  ❌ INCORRECTO - main.js no es entry point
                     ✅ DEBERÍA SER: "./webhook-server.js"
watch: ["main.js", "services", "config"]
ignore_watch: ["node_modules", "session_logs", "logs"]
max_memory_restart: '300M'
```

### 5.2 Estructura Actual vs Expected

```
ACTUAL:
  pm2 start ecosystem.config.js → main.js
    ↓
  main.js requiere webhook-server.js
    ↓
  Ambos export functions (no ejecutan)
    ↓
  ❌ Bot nunca inicia (espera entrada manual)

ESPERADO:
  pm2 start ecosystem.config.js → webhook-server.js
    ↓
  webhook-server.js (express app.listen(3000))
    ↓
  ✅ Bot inicia en puerto 3000
    ↓
  Recibe webhooks y ejecuta flows
```

### 5.3 Persistencia del Bot

```javascript
// Si es un proceso separado (CLI):
- Node.js process forked por opencode
- PID único por issue
- No comparte estado entre procesos
- Persiste en: ~/openclaw-workspace/worktrees/

// Si es daemon PM2:
- Single node process
- Comparte queue, inFlightIssues, labelCooldowns
- Persiste en memoria (PROBLEMA: se pierde on restart)
```

### 5.4 Logs de Ejecución

```
Location: /root/.openclaw/logs/
  ├── out.log          (stdout de PM2)
  ├── err.log          (stderr de PM2)
  └── issue-X.log      (output específico per issue)

Log format (issue-X.log):
  --- EXEC: 2026-03-04T13:20:00.000Z ---
  --- TRACE: ISSUE-102-ABC123 ---
  --- ATTEMPT: build-model=github-copilot/claude-haiku-4.5 ---
  [opencode output aquí]
```

---

## 6. NOTIFICACIONES Y LOGS

### 6.1 Sistema de Notificaciones

#### 6.1.1 Telegram Notify

```javascript
// Cuándo se envía:
  1. notifyFailure() - Error en PLAN o BUILD
     Mensaje: "OpenClaw error | repo={} | issue={} | stage={} | status={} | msg={}"
  
  2. buildHumanSummary() - PR merged (en handlePrClosed)
     Mensaje: Resumen multilinea de cambios
```

**Búsqueda de token/chat_id:**
```javascript
const token = 
    process.env.TELEGRAM_BOT_TOKEN ||
    process.env.OPENCLAW_TELEGRAM_BOT_TOKEN ||
    openclaw.json.channels.telegram.botToken ||
    ''

const chatId =
    TELEGRAM_CHAT_ID ||
    process.env.TELEGRAM_CHAT_ID ||
    process.env.OPENCLAW_TELEGRAM_CHAT_ID ||
    sessions.json[].deliveryContext.to.split(':')[1] ||
    ''
```

#### 6.1.2 GitHub Comments

```javascript
// Tipos de comentarios:
  1. Plan generado - Cuando termina runPlanFlow()
  2. Feedback integration - En buildPlanPrompt()
  3. Error notification - En notifyFailure()
  4. Status updates - Implícitos en labels
```

### 6.2 Sistema de Logs

#### 6.2.1 Logs por Nivel

```
Level 1: stdout (console.log)
  └─ Emojis descriptivos: 🤖 [PLAN], 🛠️ [BUILD], 🧾 [PR]
  └─ Cada etapa tiene logging

Level 2: file (issue-X.log)
  └─ Full output de opencode
  └─ Traces + attempts

Level 3: JSON state (execution_states/issue-X.json)
  └─ Structured tracking
  └─ Attempts count, status, etc.

Level 4: Session JSON (session_logs/issue-X.json)
  └─ Plans + feedback
  └─ Context histórico
```

#### 6.2.2 Tamaño y Rotación

```
Problema actual:
  - /root/.openclaw/logs/: 1.8M
  - /root/.openclaw/session_logs/: 380K
  - Sin rotación automática
  - Crece indefinidamente
  
Recomendación:
  - Implementar log rotation (winston, logrotate)
  - Archivar logs > 30 días
  - Limpiar session_logs periodicamente
```

---

## 7. DEPENDENCIAS NPM

### 7.1 package.json

```json
{
  "dependencies": {
    "@notionhq/client": "^5.11.0",       // Notion API
    "@octokit/rest": "^22.0.1",          // GitHub API
    "dotenv": "^17.3.1",                 // .env loading
    "express": "^5.2.1",                 // Web server
    "notion-to-md": "^3.1.9",            // Notion → Markdown
    "openai": "^6.25.0",                 // OpenAI client (no usado?)
    "simple-git": "^3.32.3"              // Git operations
  }
}
```

### 7.2 Análisis de Dependencias

| Dependencia | Versión | Crítica | Notas |
|----------|---------|---------|--------|
| @notionhq/client | ^5.11.0 | ⭐⭐⭐ | Necesaria para Notion sync |
| @octokit/rest | ^22.0.1 | ⭐⭐⭐ | Necesaria para GitHub |
| dotenv | ^17.3.1 | ⭐⭐ | Config management |
| express | ^5.2.1 | ⭐⭐⭐ | Webhook server |
| notion-to-md | ^3.1.9 | ⭐ | Conversion (not actively used) |
| openai | ^6.25.0 | ⭐ | NO USADO en código |
| simple-git | ^3.32.3 | ⭐⭐⭐ | Git operations |

### 7.3 Vulnerabilidades Potenciales

```
⚠️ ACTUALIZAR:
  - express: ^5.2.1 (versión beta, considerar 4.x LTS)
  - @octokit/rest: Verificar CVEs
  - @notionhq/client: Verificar CVEs
  
⚠️ REMOVER:
  - openai: ^6.25.0 (no usado, reduce bundle)
  
⚠️ AGREGAR:
  - Logging: winston, pino (para rotación de logs)
  - Validation: joi, zod (para schemas)
  - Testing: jest, mocha (para tests)
```

---

## 8. PUNTOS DE INTEGRACIÓN EXTERNOS

### 8.1 GitHub API

#### 8.1.1 Endpoints Usados

```javascript
// Issues
- octokit.rest.issues.get()
- octokit.rest.issues.update()
- octokit.rest.issues.createComment()
- octokit.rest.issues.listComments()

// Pull Requests
- octokit.rest.pulls.create()
- octokit.rest.pulls.list()
- octokit.rest.pulls.update()

// Webhooks
- POST /webhook (en express)
  Eventos:
    - issues.opened
    - issues.labeled
    - issue_comment.created
    - pull_request.closed
```

#### 8.1.2 Rate Limits

```javascript
GitHub API rate limits:
  - 60 requests/hour (unauthenticated)
  - 5000 requests/hour (authenticated) ← USAMOS ESTO
  
Implementación:
  - withRetry() detecta 429 (Too Many Requests)
  - Espera Retry-After header
  - Max 4 intentos con exponential backoff
```

### 8.2 Notion API

#### 8.2.1 Endpoints Usados

```javascript
// Database operations
- notion.databases.query()
  Búsqueda de tareas
  
- notion.pages.retrieve()
  Obtener página
  
- notion.pages.update()
  Actualizar estado
  
- notion.databases.retrieve()
  Metadatos de DB

// En auto_expand_ready_ferreteria.js:
- notion.pages.retrieve() → tareas
- notion.pages.update() → estado "Completada"
```

#### 8.2.2 Database Structure Esperada

```javascript
Notion DB Properties (Ferreteria):
  - Tarea (title): Nombre del task
  - Descripción (rich_text): Descripción
  - Etiquetas (multi_select): Tags
  - Estado (select): Pending, Expanded, Completada
  - URL GitHub (url): Link a issue
  - Page ID: Se usa para mapeo

En issue GitHub:
  Body contiene: notion_page_id=84abb0ef-...
  ↓ Usado en handlePrClosed() para update
```

### 8.3 OpenCode Integration

#### 8.3.1 CLI Invocation

```bash
# Cómo se ejecuta:
spawn("opencode run --model MODEL \"$(cat prompt.txt)\" --session SES_ID --dir DIR")

# BUILD mode:
spawn("opencode --model BUILD_MODEL run \"$(cat prompt.txt)\" --session SES_ID --dir DIR")

# Parámetros:
  --model: Modelo IA (fallback chain)
  --session: Session ID para persistencia
  --dir: Directorio de trabajo
  --continue: (implícito si no hay --session)
```

#### 8.3.2 Comunicación

```javascript
// stdin/stdout:
  - Prompt escrito en archivo temporal
  - Pasado via `cat` en comando shell
  - Output capturado de stdout/stderr
  
// Session:
  - OpenCode mantiene sessions
  - Usadas para continuidad entre intentos
  - Ubicación: ~/.opencode/sessions/
```

### 8.4 Telegram Integration

#### 8.4.1 Bot Notification Flow

```
notifyFailure() o handlePrClosed()
    ↓
sendTelegramMessage(message)
    ↓
HTTPS POST https://api.telegram.org/bot{token}/sendMessage
    ↓
Payload: { chat_id, text, disable_web_page_preview }
    ↓
Telegram recibe + envía a chat
```

---

## 9. LIMITACIONES ACTUALES

### 9.1 Arquitectura Limitaciones

```
❌ SINGLE PROJECT HARDCODED
   - REPO_OWNER = "zalazarnatanael" (línea 6 en config/constants.js)
   - REPO_NAME = "v0-ferreteria" (línea 7)
   - NOTION_DATABASE_ID hardcoded (línea 5)
   
   Impacto: No soporta múltiples proyectos simultáneamente
   Esfuerzo refactor: 🔴 ALTO (ver sección 10)

❌ SINGLE INSTANCE / PROCESS MODEL
   - Todo en un solo Node.js process (webhooks + flows)
   - Queue en memoria (se pierde si reinicia)
   - No escalable horizontalmente
   
   Recomendación: Separar en microservicios (webhook → queue → workers)

❌ WORKERS DINÁMICOS FIJOS A 3
   - hardcoded en línea 26 webhook-server.js
   - No responde a carga
   - Si muy cargado: cola crece indefinidamente
```

### 9.2 Persistencia

```
❌ QUEUE EN MEMORIA
   - const queue = []
   - Si bot reinicia: queue se pierde
   - Tasks en flight pueden quedarse atrapadas
   
   Impacto: Pérdida de trabajo, manual recovery
   Solución: Redis, RabbitMQ, o persistencia a disk

❌ SESSION STORAGE EN JSON
   - session_logs/issue-X.json
   - Sin versionado
   - Sin rollback
   - Corrupción posible
   
   Impacto: Pérdida de context histórico
   Solución: Base de datos (MongoDB, PostgreSQL)

❌ NO STATE SNAPSHOTS
   - No hay backup de estados en caso de fallo
   - No hay rollback de cambios
```

### 9.3 Seguridad

```
❌ SECRETOS EN .env (versionable)
   - GITHUB_TOKEN, NOTION_TOKEN expuestos
   - Si repo es público: compromiso total
   
   Impacto: 🔴 CRÍTICO - Token leak
   Solución: Vault, AWS Secrets Manager, environment variables

❌ WEBHOOK VALIDATION DÉBIL
   - Valida firma solo si GITHUB_WEBHOOK_SECRET set
   - No valida todas las requests
   
   Impacto: Posible injection de fake webhooks
   Solución: Siempre validar firma

❌ NO RATE LIMITING EN WEBHOOK
   - Alguien puede DDOS el webhook
   - Sin protección
   
   Impacto: DOS attack posible
   Solución: Implementar rate limiting (express-rate-limit)
```

### 9.4 Debugging & Observabilidad

```
❌ LOGS NO ESTRUCTURADOS
   - Mix de console.log con emojis
   - Difícil parsear
   - No hay structured logging
   
   Impacto: Debugging lento
   Solución: Winston, Pino con JSON logging

❌ SIN DASHBOARD
   - Solo acceso vía logs
   - Sin UI para ver queue status
   - Sin métricas en tiempo real
   
   Impacto: Ops ciego
   Solución: Express dashboard + Socket.io / SSE

❌ SIN METRICS
   - No hay tracking de performance
   - No hay alertas de degradation
   - No hay SLA tracking
```

### 9.5 Testing

```
❌ SIN UNIT TESTS
   - Cero coverage
   - Cambios introducen bugs fácilmente
   
   Impacto: Regresiones frecuentes
   Solución: Jest tests para services

❌ SIN INTEGRATION TESTS
   - No se testan flujos completos
   - No se prueban fallbacks
   
   Impacto: Sorpresas en producción
   Solución: Integration tests con mocks
```

### 9.6 Performance

```
❌ SINGLE GITHUB API TOKEN
   - Sin multiplexing
   - Requests competitivas
   - Posibles throttles
   
   Impacto: Lentitud bajo carga
   Solución: Token rotation, async queue

❌ NO CACHING
   - Cada fetch a GitHub es live
   - No hay caching de comentarios
   - No hay invalidation strategy
   
   Impacto: Requests innecesarios
   Solución: Redis cache con TTL
```

### 9.7 Error Handling

```
❌ FALLBACKS LIMITADOS
   - Solo 3 modelos en cadena
   - Si todos fallan: error silencioso
   - No hay retry policy configurable
   
   Impacto: Tasks se pierden
   Solución: Mejor error recovery, DLQ (Dead Letter Queue)

❌ NO CIRCUIT BREAKER
   - Si OpenCode falla: intenta indefinidamente
   - No hay backoff exponencial entre intentos
   
   Impacto: Resource leak
   Solución: Implementar circuit breaker pattern
```

---

## 10. REFACTORING MULTIPROYECTO

### 10.1 Arquitectura Actual (Single-Project)

```
/root/.openclaw/
  └── config/constants.js
      ├── REPO_PATH = "~/.../v0-ferreteria"  ← HARDCODED
      ├── REPO_OWNER = "zalazarnatanael"     ← HARDCODED
      ├── REPO_NAME = "v0-ferreteria"        ← HARDCODED
      └── NOTION_DATABASE_ID = "84abb0e..."  ← HARDCODED

webhook-server.js
  ├── processQueue() responde a TODOS los webhooks
  └── runPlanFlow() / runBuildFlow() usa constantes

Resultado: 1 único proyecto, 1 única DB Notion
```

### 10.2 Cambios Requeridos para Multi-Project

#### 10.2.1 Configuración Dinámico

**Opción A: Env Vars Per-Project (Simple)**

```javascript
// .env
PROJECTS=ferreteria,marketplace,api
FERRETERIA_REPO_OWNER=zalazarnatanael
FERRETERIA_REPO_NAME=v0-ferreteria
FERRETERIA_NOTION_DB=84abb0ef-...

MARKETPLACE_REPO_OWNER=company
MARKETPLACE_REPO_NAME=marketplace
MARKETPLACE_NOTION_DB=deadbeef-...

// config/projects.js (NEW)
module.exports = {
  projects: {
    ferreteria: {
      repoOwner: process.env.FERRETERIA_REPO_OWNER,
      repoName: process.env.FERRETERIA_REPO_NAME,
      notionDatabaseId: process.env.FERRETERIA_NOTION_DB,
      ...
    },
    marketplace: { ... }
  }
}
```

**Opción B: Database Config (Scalable)**

```javascript
// MongoDB collection: projects
{
  _id: "ferreteria",
  repoOwner: "zalazarnatanael",
  repoName: "v0-ferreteria",
  notionDatabaseId: "84abb0ef-...",
  labels: { ... },
  status: "active"
}

// config/projectService.js (NEW)
async function getProjectConfig(projectId) {
  return await db.projects.findOne({ _id: projectId })
}
```

#### 10.2.2 Modificar Services

**webhook-server.js (Cambios Necesarios)**

```javascript
// BEFORE:
app.post('/webhook', (req, res) => {
  const { action, issue } = req.body
  if (action === 'labeled' && label.name === LABELS.NEW) {
    enqueueTask({ ... })
  }
})

// AFTER:
app.post('/webhook', (req, res) => {
  const { action, issue, repository } = req.body
  const projectId = repository.name  // O extraer de mapping
  
  const projectConfig = await getProjectConfig(projectId)
  if (!projectConfig) return res.status(404).send('Project not found')
  
  const LABELS = projectConfig.labels
  if (action === 'labeled' && label.name === LABELS.NEW) {
    enqueueTask({ projectId, projectConfig, ... })
  }
})
```

**main.js (Cambios Necesarios)**

```javascript
// BEFORE:
async function runPlanFlow(issue) {
  await withRetry(() => octokit.rest.issues.update({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    ...
  }))
}

// AFTER:
async function runPlanFlow(issue, projectConfig) {
  const { repoOwner, repoName } = projectConfig
  await withRetry(() => octokit.rest.issues.update({
    owner: repoOwner,
    repo: repoName,
    ...
  }))
}
```

**aiService.js (Cambios Necesarios)**

```javascript
// BEFORE:
const worktreePath = await ensureWorktree(issue.number, branch)
  // Path: ~/openclaw-workspace/worktrees/issue-X

// AFTER:
const worktreePath = await ensureWorktree(
  issue.number, 
  branch,
  projectConfig.repoPath  // NEW parameter
)
  // Path: ~/openclaw-workspace/ferreteria/worktrees/issue-X
```

#### 10.2.3 Aislamiento de Sesiones

```javascript
// BEFORE:
session_logs/issue-102.json  ← ¿De qué proyecto?

// AFTER:
session_logs/ferreteria/issue-102.json
session_logs/marketplace/issue-102.json
session_logs/api/issue-202.json
  ↑ Mismo issue number, proyecto diferente
```

#### 10.2.4 Queue Multiproject

```javascript
// BEFORE:
const queue = []
const inFlightIssues = new Set()  // Set { 102, 105 }
  ↓
Problema: Issue 102 de ferreteria vs issue 102 de marketplace

// AFTER:
const queue = []
const inFlightTasks = new Set()  // Set { "ferreteria:102", "marketplace:102" }

function buildTaskKey(task) {
  return `${task.projectId}:${task.issueNumber}`
}
```

### 10.3 Estimaciones de Refactoring

| Componente | Cambios | Líneas | Riesgo |
|-----------|---------|--------|--------|
| webhook-server.js | Query project config en cada webhook | +50 | 🟡 Bajo |
| main.js | Pass projectConfig a flows | +30 | 🟡 Bajo |
| services/aiService.js | Usar repo path dinámico | +20 | 🟡 Bajo |
| services/sessionContext.js | Namespacing con projectId | +20 | 🟡 Bajo |
| services/worktreeManager.js | Aislamiento por proyecto | +30 | 🟡 Bajo |
| config/projectService.js | **NUEVO**: Cargar configs | +100 | 🟢 Ninguno |
| Database schema | Migrations Notion | +0 | 🟡 Bajo |
| Tests | Unit tests para services | +200 | 🟢 Ninguno |
| **TOTAL** | | **~450 LOC** | 🟡 **BAJO** |

### 10.4 Rollout Plan

**Fase 1: Preparación (1 día)**
```
1. Crear config/projectService.js
2. Agregar getProjectConfig() helper
3. Crear MongoDB schema para projects
4. Migrar ferreteria a nueva estructura
```

**Fase 2: Integration (2 días)**
```
1. Update webhook-server.js
2. Update main.js flows
3. Update services/
4. Add unit tests
```

**Fase 3: Testing (1 día)**
```
1. Integration tests
2. Manual testing en dev
3. Load testing
```

**Fase 4: Deployment (1 día)**
```
1. Deploy con feature flag
2. Monitor
3. Add second project
```

---

## 11. RESUMEN EJECUTIVO

### 11.1 Estado del Sistema

```
✅ FUNCIONAL:
  - Flujo básico Notion → Issue → Plan → Build → PR
  - Persistencia de sesiones
  - Fallback chain de modelos IA
  - Retries con backoff exponencial
  - Git worktrees para aislamiento
  - Queue FIFO justas

❌ PROBLEMAS CRÍTICOS:
  - Single-project hardcoded
  - Queue en memoria
  - Secretos en .env
  - Sin testing
  - Sin observabilidad
  - Sin rate limiting webhook
```

### 11.2 Puntuación del Sistema

| Categoría | Score | Notas |
|-----------|-------|-------|
| Funcionalidad | 8/10 | Flujo completo, pero limitado a 1 proyecto |
| Confiabilidad | 6/10 | Fallbacks, pero sin circuit breaker |
| Seguridad | 3/10 | Secretos expuestos, sin validación webhook |
| Escalabilidad | 2/10 | Single instance, queue en memoria |
| Observabilidad | 4/10 | Logs básicos, sin dashboard |
| Maintainability | 5/10 | Código claro, pero sin tests |
| **PROMEDIO** | **4.7/10** | **REFACTORING RECOMENDADO** |

### 11.3 Próximos Pasos Recomendados

1. **Inmediato (Semana 1):**
   - Mover secretos a Vault
   - Implementar webhook rate limiting
   - Agregar validación de firma

2. **Corto Plazo (Semana 2-3):**
   - Unit tests para services
   - Dashboard básico
   - Log rotation

3. **Mediano Plazo (Mes 1):**
   - Migración a multi-project
   - Redis cache
   - Structured logging

4. **Largo Plazo (Mes 2+):**
   - Microservicios
   - Kubernetes
   - Full observability (Prometheus + Grafana)

---

**Análisis completado:** 4 de Marzo de 2026
**Complejidad:** MEDIA
**Estado:** LISTO PARA ACCIÓN

