# ANÁLISIS COMPLETO: OpenClaw - Estructura y Funcionamiento

## 1. DIAGRAMA ACTUAL DEL SISTEMA

### 1.1. webhook-server.js - ENDPOINTS Y WEBHOOKS
```
Puerto: 3000
Endpoint principal: POST /webhook

WEBHOOKS ESCUCHADOS:
├── issues.opened
│   └── Si label = "from-notion" → enqueue PLAN flow
├── issues.labeled  
│   ├── label = "from-notion" → enqueue PLAN flow
│   ├── label = "awaiting-ia-intervention" → enqueue PLAN flow
│   └── label = "ready-for-development" → 
│       ├── Update labels → add "bot-working"
│       └── enqueue BUILD flow
├── issue_comment.created
│   └── Si comentario no es del bot → enqueue REPLAN flow
│       └── Vuelve a ejecutar PLAN con feedback
└── pull_request.closed (merged)
    └── handlePrClosed()
        ├── Busca issue asociado (Resuelve #X o branch name)
        ├── Crea summary con changes
        ├── Postea resumen en issue
        ├── Marca issue como "completed"
        ├── Actualiza Notion (Estado = Completada)
        └── Limpia sesión local
```

**Autenticación:**
- HMAC-SHA256: valida `X-Hub-Signature-256` con `GITHUB_WEBHOOK_SECRET`
- Solo procesa si firma es válida


### 1.2. main.js - RUNPLANFLOW Y RUNBUILDFLOW

#### **runPlanFlow(issue)**
```
Objetivo: Analizar el issue y generar un plan técnico

Pasos:
1. Agregar label "bot-working" al issue
2. Cargar sesión anterior (si existe)
3. Descargar comentarios nuevos desde GitHub
4. updateSessionWithComments() → extrae feedback de comentarios
5. buildPlanPrompt() → construye prompt con:
   - Título e descripción del issue
   - Plan anterior (si existe)
   - Feedback reciente de comentarios
   - Instrucción READ-ONLY (no modificar archivos)
6. runOpenCode() (modo planner=false)
   - Ejecuta: opencode run "$(cat prompt.txt)" --dir REPO_PATH
   - Usa modelo configurable (default: opencode/trinity-large-preview-free)
   - Si falla modelo primario → intenta fallback
7. cleanOutput() → extrae solo el plan (quita logs, tool output)
8. saveSession() → persiste plan en session_logs/issue-X.json
9. Publica comentario con plan en GitHub
10. Actualiza labels:
    - Quita: "from-notion", "awaiting-ia-intervention", "bot-working"
    - Agrega: "awaiting-human-intervention"

Output: Comentario en GitHub con formato "### 📋 Plan ..."
```

#### **runBuildFlow(issue)**
```
Objetivo: Ejecutar el plan y generar cambios de código

Pasos:
1. Agregar label "bot-working"
2. ensureWorktree() → crea/reutiliza worktree para issue
   - Path: ~/openclaw-workspace/worktrees/v0-ferreteria/issue-X
   - Branch: task/issue-X
3. Cargar última sesión y plan
4. runOpenCode() (modo programmer=true)
   - Directorio: worktree (no repo principal)
   - Ejecuta: opencode --model BUILD_MODEL run "Sigue este plan:\n{plan}\n\nEJECUTA AHORA"
   - Usa modelo BUILD_MODEL (default: github-copilot/claude-haiku-4.5)
5. Si hay cambios en worktree:
   - git add && git commit "feat: fix #X"
   - git push origin task/issue-X --force
   - Crea PR automático:
     - Title: "PR: {issue.title}"
     - Body: summary + changes
     - Head: task/issue-X
     - Base: main
6. Actualiza labels → "pr-generated"
7. Si sin cambios → postea comentario "No se detectaron cambios"

Output: PR creado automáticamente en GitHub
```


### 1.3. SISTEMA DE COLAS - FIFO CON WORKERS

**Ubicación:** webhook-server.js líneas 25-116

```
ESTRUCTURA:
const queue = [];              // Array de tasks pendientes
const maxConcurrent = 3;       // Máx 3 workers simultáneos
let activeWorkers = 0;         // Workers activos ahora
const inFlightIssues = Set;    // Issues en ejecución (evita duplicados)
const inFlight = Set;          // Tasks en ejecución
const labelCooldowns = Map;    // Evita spam de eventos de labels

TASK STRUCTURE:
{
  number: issue.number,
  name: "PLAN" | "BUILD" | "REPLAN" | "PR-CLOSE" | "READY-LABELS",
  issueNumber: number,
  owner: "zalazarnatanael",
  repo: "v0-ferreteria",
  traceId: "ISSUE-X-RANDOM",
  execute: async function() { ... }
}

PROCESSAMIENTO:
1. enqueueTask(task)
   - Verifica si ya está encolada (por buildTaskKey)
   - Evita duplicados
   - Asigna traceId para tracking
   - Push al array

2. processQueue()
   - Ejecuta mientras activeWorkers < maxConcurrent
   - Busca siguiente task disponible
   - Evita 2 tasks del MISMO issue simultáneamente
   - Ejecuta task.execute()
   - Captura errores → notifyFailure()
   - Decrementa counter
   - Reschedule: setTimeout(processQueue, 100ms)

COMPORTAMIENTO:
- 1 PLAN por issue a la vez
- 3 issues en paralelo máximo
- Label cooldown: 2.5s (evita reciclar eventos GitHub)
- FIFO: próxima disponible que no bloquee su issue
```


### 1.4. MANEJO DE SECRETOS

```
Ubicación: .env (root de proyecto)

TOKENS CARGADOS:
│
├─ GITHUB_TOKEN
│  └─ require('dotenv').config() en webhook-server.js:11
│     Octokit({ auth: process.env.GITHUB_TOKEN })
│
├─ NOTION_TOKEN  
│  └─ require('dotenv').config() en webhook-server.js:11
│     Client({ auth: process.env.NOTION_TOKEN })
│
├─ NOTION_DATABASE_ID_FERRETERIA
│  └─ Usado en handlePrClosed() para actualizar status Notion
│
├─ GITHUB_WEBHOOK_SECRET
│  └─ Validación HMAC en webhook-server.js:371-377
│
├─ BUILD_MODEL
│  └─ Modelo para BUILD flow (default: github-copilot/claude-haiku-4.5)
│
└─ PLANNER_MODEL
   └─ Modelo para PLAN flow (default: opencode/trinity-large-preview-free)

CARGAS:
1. webhook-server.js:11 → require('dotenv').config()
2. config.js:2 → require('dotenv').config()
3. main.js:9 → require('dotenv').config()
4. Services: aiService, sessionContext

STORAGE:
- .env: Texto plano en /root/.openclaw/.env
- NO usa gestor de secretos (vault, AWS Secrets Manager, etc.)
- CRÍTICO: Git-ignore .env para no exponer tokens
```

---

## 2. FLUJOS ACTUALES

### 2.1. WEBHOOK NOTION → ISSUE GITHUB → DEVELOPMENT

```
Secuencia completa de un flow:

1. TRIGGER (fuera de OpenClaw):
   └─ Usuario crea CARD en Notion
   └─ Script externo (create_github_issues_from_expanded.js) 
      └─ Descarga card de Notion
      └─ Crea ISSUE en GitHub con label "from-notion"
      └─ Actualiza card en Notion con URL del issue

2. GITHUB WEBHOOK:
   webhook-server.js:371 POST /webhook
   │
   ├─ Valida firma (HMAC-SHA256)
   │
   └─ Evento: issues.opened + label "from-notion"
      └─ ENQUEUE: PLAN task

3. PLAN FLOW (runPlanFlow):
   main.js:141
   │
   ├─ Cargar sesión issue-X.json
   ├─ Descargar comentarios GitHub
   ├─ Construir prompt (título + descripción + feedback)
   ├─ EJECUTAR: opencode run --session ses-ferreteria-iX
   │  └─ OpenCode corre en modo READ-ONLY (solo analiza)
   │  └─ Usa Planner Model (trinity-large-preview-free)
   │
   ├─ cleanOutput() → extrae plan
   ├─ Guardar plan en session-X.json
   ├─ Postear comentario GitHub: "### 📋 Plan ..."
   └─ Updatear labels:
      - Quita: from-notion, awaiting-ia-intervention, bot-working
      + Agrega: awaiting-human-intervention

4. ESPERA HUMANA:
   └─ Usuario revisa plan en GitHub
   └─ Usuario comenta feedback (o aprueba con ✅)

5. REPLAN O READY:
   
   OPCIÓN A - Usuario comenta (issue_comment.created):
   webhook-server.js:447-481
   └─ ENQUEUE: REPLAN task
      └─ Updatear labels: awaiting-ia-intervention + bot-working
      └─ ENQUEUE: PLAN task (vuelve a runPlanFlow)
      └─ Nuevo plan con feedback incluido
   
   OPCIÓN B - Usuario agrega label "ready-for-development":
   webhook-server.js:420-445
   └─ ENQUEUE: READY-LABELS task
      └─ Updatear labels: ready-for-development + bot-working
   └─ ENQUEUE: BUILD task

6. BUILD FLOW (runBuildFlow):
   main.js:211
   │
   ├─ Crear worktree en ~/openclaw-workspace/worktrees/v0-ferreteria/issue-X
   ├─ Branch: task/issue-X
   ├─ Cargar última sesión (para acceder al plan)
   │
   ├─ EJECUTAR: opencode --model github-copilot/claude-haiku-4.5 run
   │  "Sigue este plan:\n{plan}\n\nEJECUTA AHORA"
   │  --dir {worktreePath}
   │
   │  └─ OpenCode: escribe archivos, ejecuta cambios
   │  └─ BUILD Model (claude-haiku-4.5)
   │
   ├─ SI hay cambios en worktree:
   │  ├─ git add .
   │  ├─ git commit "feat: fix #X"
   │  ├─ git push origin task/issue-X --force
   │  └─ octokit.rest.pulls.create()
   │     └─ Crea PR automático
   │
   ├─ Updatear labels: pr-generated
   └─ Guardar sesión

7. REVIEW & MERGE (Manual):
   └─ Usuario revisa PR
   └─ Usuario aprueba y MERGE

8. POST-MERGE (PR closed webhook):
   webhook-server.js:483-498
   │
   ├─ ENQUEUE: PR-CLOSE task
   └─ handlePrClosed(pr):
      │
      ├─ Extraer issue asociado (Resuelve #X del PR body o branch name)
      ├─ Descargar files, commits, comments de PR
      │
      ├─ Construir SUMMARY HUMANO:
      │  └─ "Se atendió el pedido..."
      │  └─ Cita plan anterior
      │  └─ Lista cambios
      │  └─ Postea en issue
      │
      ├─ Updatear labels: completed
      │
      ├─ Actualizar Notion:
      │  └─ Buscar page de Notion (por URL o Notion-PageId)
      │  └─ Actualizar property "Estado" = "Completada"
      │
      ├─ Limpiar worktree:
      │  └─ removeWorktree() (delete local + remote branch)
      │
      └─ Limpiar sesión:
         └─ Eliminar issue-X.json
         └─ Eliminar issue-X.log

RESULTADO FINAL:
✅ Issue COMPLETADO en GitHub
✅ Card COMPLETADA en Notion
✅ PR MERGEADO
✅ Cambios EN PRODUCCIÓN
```

### 2.2. PERSISTENCIA DE CONTEXTO: PLANNING → DEVELOPMENT

```
SESSION STORAGE: session_logs/issue-X.json
{
  "issueNumber": 123,
  "lastCommentId": 5000,
  "plans": [
    {
      "createdAt": "2026-03-04T10:30:00Z",
      "body": "### 📋 Plan\n- Task 1\n- Task 2\n..."
    }
  ],
  "feedback": [
    {
      "id": 5001,
      "author": "usuario",
      "createdAt": "2026-03-04T10:35:00Z",
      "body": "Cambiar color a rojo"
    }
  ]
}

CÓMO PERSISTE:

1. PLAN FLOW:
   ├─ loadSession(issue.number)
   ├─ updateSessionWithComments(session, comments)
   │  └─ Descarga comentarios nuevos desde GitHub
   │  └─ Filtra feedback (no planes anteriores)
   │  └─ Agrega a session.feedback[]
   ├─ buildPlanPrompt(issue, session, isNew)
   │  └─ Incluye:
   │     - "Plan previo: {session.plans[-1]}"
   │     - "Feedback reciente: {session.feedback[-5:]}"
   ├─ runOpenCode() → genera nuevo plan
   ├─ session.plans.push(nuevoPlan)
   └─ saveSession(issue.number, session)

2. BUILD FLOW:
   ├─ loadSession(issue.number)
   └─ const lastPlan = session.plans[-1]
   │  └─ SI no existe → busca en comentarios GitHub
   │  └─ SI no existe → usa default "Aplica cambios técnicos"
   ├─ runOpenCode(lastPlan) con modo programmer=true
   │  └─ OpenCode recibe el plan en el prompt
   │  └─ OpenCode lo ejecuta en worktree
   └─ Cambios aplicados en base al plan

PERSISTENCIA DE ESTADO:
execution_states/issue-X.json
{
  "issueNumber": 123,
  "status": "in_progress",
  "buildAttempts": 2,
  "planAttempts": 1,
  "plansExecuted": [
    {
      "planHash": "abc123def456",
      "timestamp": "2026-03-04T10:30:00Z",
      "status": "completed",
      "model": "opencode/trinity-large-preview-free"
    }
  ],
  "lastSuccessfulPlan": "abc123def456"
}
→ Usado para evitar re-ejecutar planes idénticos
```

---

## 3. DIFERENCIAS: ACTUAL VS LO QUEREMOS

### 3.1. SOPORTA MÚLTIPLES PROYECTOS?

**ACTUAL:** ❌ NO (SINGLE PROJECT)
```
config.js:
- REPO_PATH = ~/openclaw-workspace/repos/v0-ferreteria (HARDCODED)
- REPO_OWNER = "zalazarnatanael" (HARDCODED)
- REPO_NAME = "v0-ferreteria" (HARDCODED)
- NOTION_DATABASE_ID = 84abb0ef-a976-83db-8353-07ecc686f75a (HARDCODED)

webhook-server.js: 
- req.body.repository.owner/name se extrae pero se ignora
- Siempre usa REPO_OWNER/REPO_NAME de config

LIMITACIÓN:
- Un solo webhook en :3000
- Una sola config de labels
- Una sola queue
- Si quieres 2 proyectos = 2 instancias de webhook-server.js en puertos diferentes
```

**LO QUE QUEREMOS:** ✅ SÍ (MULTI-PROJECT READY)
```
Necesitaría:
- Detectar project en webhook: (owner, repo) → lookup en BD de configuración
- Queue separada por proyecto
- Labels dinámicos por proyecto
- Dashboard que muestre todos los proyectos
```

### 3.2. HAY DASHBOARD?

**ACTUAL:** ❌ SOLO WEBHOOK-SERVER
```
/root/.openclaw/canvas/index.html
- Solo un test page (botones para probar acciones)
- NO muestra estado de issues
- NO muestra cola
- NO muestra workers
```

**LO QUE QUEREMOS:** ✅ SÍ
```
Dashboard debería mostrar:
- Proyectos activos
- Issues en progreso
- Cola pendiente (cuántos en PLAN, BUILD, REPLAN)
- Workers activos
- Historiales: últimos 10 issues completados
- Logs en tiempo real (socket.io o SSE)
- Estado de Notion cards
```

### 3.3. CUÁNTOS WORKERS AHORA?

**ACTUAL:** 3 WORKERS FIJOS (ESTATICOS)
```
webhook-server.js:26
const maxConcurrent = 3;

LIMITACIÓN:
- Hardcoded
- No configurable
- Procesa máx 3 issues en paralelo
- Si 1 issue tarda 10 min, otro espera

DISTRIBUCIÓN:
const inFlightIssues = new Set()
- 1 issue = 1 worker máximo
- Diferentes issues = pueden ocupar workers en paralelo
- PERO si issue tiene muchas tasks (PLAN + BUILD) pueden encolar

Ejemplo:
- Issue #1 PLAN → enqueue
- Issue #1 BUILD → enqueue (espera que PLAN termine)
- Issue #2 PLAN → enqueue (ejecuta en paralelo a #1 PLAN)
- Issue #3 PLAN → enqueue (ejecuta en paralelo)

→ Máx 3 tasks de DIFERENTES issues ejecutándose
→ Si misma issue: secuencial
```

---

## 4. PUNTOS DE INTEGRACIÓN

### 4.1. DETECCIÓN DE CAMBIOS DE LABELS

**¿Dónde se detectan?**
```
webhook-server.js:404-445

Evento GitHub: issues.labeled (cuando se agrega un label)

LISTENERS:
├─ label = "from-notion" → enqueue PLAN
├─ label = "awaiting-ia-intervention" → enqueue PLAN
├─ label = "ready-for-development" 
│  ├─ enqueue READY-LABELS (update UI labels)
│  └─ enqueue BUILD
│
└─ COOLDOWN: 2.5s
   └─ shouldIgnoreLabelEvent(issueNumber)
   └─ Evita spam si se agregan múltiples labels rápido

POST: actualización de labels está en main.js:
- updateLabels(issueNumber, newLabels) → octokit.rest.issues.update()
- addIssueLabel(), removeIssueLabel()
```

### 4.2. COMUNICACIÓN CON NOTION

**¿Cómo se comunica?**
```
Ubicación: webhook-server.js:296-368 (handlePrClosed)

OPERACIONES NOTION:
1. BÚSQUEDA de PageId:
   ├─ extractNotionPageIdFromIssue() 
   │  └─ Parsea "Notion-PageId: XXX" del body del issue
   │
   ├─ extractNotionLinkFromIssue()
   │  └─ Parsea "Notion: https://..." del body del issue
   │
   └─ findNotionPageIdByIssueUrl()
      └─ Query a Notion database
      └─ Filter: "GitHub Issue URL" = issue.html_url
      └─ Retorna page_id si encuentra match

2. ACTUALIZACIÓN:
   notion.pages.update({
     page_id: notionPageId,
     properties: {
       "Estado": { status: { name: "Completada" } }
     }
   })
   └─ Marca card como "Completada" en Notion

3. ERRORS:
   └─ Si Notion no está disponible: log warning, continúa
```

### 4.3. INTEGRACIÓN DE OPENCODE

**¿Cómo se integra?**
```
Ubicación: services/aiService.js:10-162

ARQUITECTURA:
OpenCode = CLI tool que ejecuta tareas con IA
Ubicación instalada: $PATH (opencode command)

INVOCACIONES:

1. PLAN MODE (runOpenCode con isProgrammer=false):
   opencode run "$(cat /path/prompt.txt)" --session {sessionId}
   │
   ├─ Modelo: opencode/trinity-large-preview-free (o configurable)
   ├─ Modo: READ-ONLY (solo analiza)
   ├─ Output: Plan técnico
   └─ Return: Cleaned output

2. BUILD MODE (runOpenCode con isProgrammer=true):
   opencode --model {BUILD_MODEL} run "Sigue este plan..." --dir {worktreePath}
   │
   ├─ Modelo: github-copilot/claude-haiku-4.5 (configurable)
   ├─ Modo: WRITE mode (escribe archivos)
   ├─ Output: Cambios en código
   └─ Return: History/logs

FALLBACK CHAIN:
┌─ Primary Model
│
├─ Detecta error (model not found, request too large, etc.)
│
└─ Fallback Model
   ├─ PLAN: trinity-large-preview-free → minimax-m2.5-free → big-pickle
   └─ BUILD: github-copilot/claude-haiku-4.5 → trinity-large-preview-free → minimax-m2.5-free

VALIDACIÓN PLAN-MODE:
- detectWriteAttempts(output)
  └─ Si output contiene "← Edit", "← Write", "← Delete" → VIOLATION
  └─ Fuerza fallback a modelo diferente

LIMPIEZA DE OUTPUT:
- cleanOutput(output)
  └─ Quita ANSI colors
  └─ Filtra líneas de herramientas (→ Read, ✱ Grep, etc.)
  └─ Busca último "### 📋 Plan" header
  └─ Retorna solo el plan limpio
```

---

## 5. RESUMEN ARQUITECTÓNICO

```
┌─────────────────────────────────────────────────────────┐
│                    GitHub Webhooks                      │
│  issues.opened, issues.labeled, issue_comment,          │
│  pull_request.closed (merged)                           │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │   webhook-server.js:3000     │
        │  Validación HMAC-SHA256      │
        │  Enqueue Tasks               │
        └──────────────────┬───────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
    ┌──────────┐      ┌──────────┐      ┌──────────┐
    │ PLAN     │      │ BUILD    │      │ PR-CLOSE │
    │ Flow     │      │ Flow     │      │ Handler  │
    └────┬─────┘      └────┬─────┘      └────┬─────┘
         │                 │                 │
         ▼                 ▼                 ▼
    ┌──────────┐      ┌──────────┐      ┌──────────┐
    │ OpenCode │      │ OpenCode │      │ Notion   │
    │ (analyze)│      │ (write)  │      │ Update   │
    │ Model: A │      │ Model: B │      │ Status   │
    └────┬─────┘      └────┬─────┘      └────┬─────┘
         │                 │                 │
         ▼                 ▼                 ▼
    ┌──────────┐      ┌──────────┐      ┌──────────┐
    │Issue Cmt │      │Git Push  │      │Worktree  │
    │+ Labels  │      │+ PR Crte │      │Cleanup   │
    └──────────┘      └──────────┘      └──────────┘
         │
         ▼
    ┌──────────────────────────────┐
    │ session_logs/issue-X.json    │
    │ execution_states/issue-X.json│
    │ Persistencia de contexto     │
    └──────────────────────────────┘

QUEUE PROCESSING:
- FIFO con max 3 workers concurrentes
- Una task por issue a la vez
- Label cooldown 2.5s para evitar spam
- traceId para tracking end-to-end
```

---

## 6. VARIABLES DE CONFIGURACIÓN

```
.env REQUERIDAS:
├─ GITHUB_TOKEN              [OBLIGATORIO]
├─ GITHUB_WEBHOOK_SECRET     [RECOMENDADO]
├─ NOTION_TOKEN              [OBLIGATORIO]
├─ NOTION_DATABASE_ID        [OBLIGATORIO]
├─ BUILD_MODEL               [OPCIONAL, default: github-copilot/claude-haiku-4.5]
├─ PLANNER_MODEL             [OPCIONAL, default: opencode/trinity-large-preview-free]
└─ TELEGRAM_CHAT_ID          [OPCIONAL, para notificaciones error]

HARDCODED EN config/constants.js:
├─ REPO_PATH                 [~/openclaw-workspace/repos/v0-ferreteria]
├─ REPO_OWNER                [zalazarnatanael]
├─ REPO_NAME                 [v0-ferreteria]
├─ WORKTREE_ROOT             [~/openclaw-workspace/worktrees/v0-ferreteria]
└─ LABELS (6 labels específicos)
```

