# DIAGRAMAS VISUALES Y FLUJOS DETALLADOS

## DIAGRAMA 1: FLUJO COMPLETO (NOTION → GITHUB → DESARROLLO → PRODUCCIÓN)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              INICIO DEL FLOW                                    │
└─────────────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────────┐
                              │ NOTION WORKSPACE │
                              │   (Usuario crea  │
                              │   una tarjeta)   │
                              └────────┬─────────┘
                                       │
                                       ▼
                ┌──────────────────────────────────────────┐
                │ create_github_issues_from_expanded.js    │
                │ (script externo)                         │
                │ - Descarga card de Notion                │
                │ - Crea issue en GitHub                   │
                │ - Label: "from-notion"                   │
                └────────┬─────────────────────────────────┘
                         │
                         ▼
         ┌────────────────────────────────────────────┐
         │ GITHUB ISSUE CREADO                        │
         │ Title: {titulo de la card}                 │
         │ Body: {descripción + Notion-PageId}        │
         │ Labels: [from-notion]                      │
         └────────┬─────────────────────────────────────┘
                  │
                  ├─ GitHub envía webhook:
                  │  event: "issues.opened"
                  │  action: "opened"
                  │
                  ▼
  ╔════════════════════════════════════════════════════════════════════════════╗
  ║                    WEBHOOK-SERVER.JS (:3000)                              ║
  ║  1. Recibe POST /webhook                                                 ║
  ║  2. Valida firma HMAC-SHA256                                             ║
  ║  3. Verifica: event=issues, label=from-notion                            ║
  ║  4. ENQUEUE TASK: { name: "PLAN", issueNumber: X, execute: runPlanFlow }║
  ║  5. processQueue() → inicia worker                                       ║
  ╚════════════════════════════════════════════════════════════════════════════╝
                                    │
                                    ▼
  ╔════════════════════════════════════════════════════════════════════════════╗
  ║                      RUNPLANFLOW(ISSUE) - MAIN.JS                         ║
  ║                                                                            ║
  ║  1. Label issue: +bot-working                                            ║
  ║  2. loadSession(X) → session_logs/issue-X.json                           ║
  ║  3. getComments() → cargar comentarios de GitHub                         ║
  ║  4. updateSessionWithComments() → agregar feedback                       ║
  ║  5. buildPlanPrompt() → construir prompt:                                ║
  ║     ┌────────────────────────────────────┐                              ║
  ║     │ "Analiza: {issue.title}"           │                              ║
  ║     │ "Descripción: {issue.body}"        │                              ║
  ║     │ "Plan previo: {session.plans[-1]}" │                              ║
  ║     │ "Feedback: {session.feedback[]}"   │                              ║
  ║     │ "⚠️ READ-ONLY MODE"                │                              ║
  ║     └────────────────────────────────────┘                              ║
  ║  6. runOpenCode() → spawn opencode command                               ║
  ║     opencode run "$(cat prompt.txt)"                                     ║
  ║     Modelo: opencode/trinity-large-preview-free                         ║
  ║  7. cleanOutput() → extrae solo "### 📋 Plan ..."                        ║
  ║  8. saveSession() → persiste plan                                        ║
  ║  9. createComment() en GitHub (publica el plan)                          ║
  ║  10. updateLabels(): -from-notion -awaiting-ia +awaiting-human          ║
  ║  11. Label issue: -bot-working                                          ║
  ╚════════════════════════════════════════════════════════════════════════════╝
                                    │
                                    ▼
         ┌────────────────────────────────────────────┐
         │ GITHUB ISSUE STATUS:                       │
         │ Title: {titulo}                            │
         │ Body: {descripción}                        │
         │ Comment: "### 📋 Plan\n- Task 1\n- ..."   │
         │ Labels: [awaiting-human-intervention]      │
         └────────┬─────────────────────────────────────┘
                  │
                  │ ┌─── ESPERA USUARIO ────┐
                  │ │ - Revisa el plan      │
                  │ │ - Comenta feedback    │
                  │ │   O aprueba con ✅    │
                  │ │ - Agrega label:       │
                  │ │   "ready-for-dev"     │
                  │ └───────────────────────┘
                  │
         ┌────────┴─────────────┐
         │                      │
    OPCIÓN A              OPCIÓN B
  (Usuario                (Usuario
   comenta)               agrega label)
         │                      │
         ▼                      ▼
  GitHub webhook:          GitHub webhook:
  issue_comment            issues.labeled
  action: created          action: labeled
         │                 label: ready-for-dev
         │                      │
         ▼                      ▼
  ┌────────────────┐      ┌──────────────────────┐
  │ ENQUEUE:       │      │ ENQUEUE: READY-LABELS│
  │ REPLAN task    │      │ (actualiza UI labels)│
  │                │      └──────────┬───────────┘
  │ + updateLabels │                 │
  │ + ENQUEUE PLAN │                 ▼
  └────────┬───────┘      ┌──────────────────────┐
           │              │ ENQUEUE: BUILD task  │
           │              └──────────┬───────────┘
           └──────────┬──────────────┘
                      │
                      ▼
  ╔════════════════════════════════════════════════════════════════════════════╗
  ║                      RUNBUILDFLOW(ISSUE) - MAIN.JS                        ║
  ║                                                                            ║
  ║  1. Label issue: +bot-working                                            ║
  ║  2. ensureWorktree(issueNumber)                                          ║
  ║     ├─ Crear: ~/openclaw-workspace/worktrees/v0-ferreteria/issue-X      ║
  ║     ├─ Branch: task/issue-X                                             ║
  ║     └─ git worktree add -B task/issue-X {worktreePath} origin/main       ║
  ║  3. loadSession(X) → obtener último plan                                 ║
  ║  4. buildPlanPrompt() from session:                                      ║
  ║     "Sigue este plan:\n{lastPlan}\n\nEJECUTA AHORA"                     ║
  ║  5. runOpenCode() → spawn opencode PROGRAMMER mode                       ║
  ║     opencode --model github-copilot/claude-haiku-4.5 run                ║
  ║     "Sigue este plan..." --dir {worktreePath}                            ║
  ║  6. OpenCode EJECUTA cambios en worktree                                 ║
  ║     ├─ Lee archivos del repo                                            ║
  ║     ├─ Modifica archivos según plan                                     ║
  ║     └─ Escribe cambios en worktree                                      ║
  ║  7. git status en worktree                                               ║
  ║     ├─ SI hay cambios:                                                  ║
  ║     │  ├─ git add .                                                    ║
  ║     │  ├─ git commit "feat: fix #X"                                    ║
  ║     │  ├─ git push origin task/issue-X --force                         ║
  ║     │  ├─ octokit.rest.pulls.create()                                  ║
  ║     │  │  └─ PR: "PR: {issue.title}"                                  ║
  ║     │  │     Head: task/issue-X, Base: main                           ║
  ║     │  └─ updateLabels: pr-generated                                  ║
  ║     │                                                                  ║
  ║     └─ SI NO hay cambios:                                              ║
  ║        └─ createComment: "⚠️ No se detectaron cambios"                 ║
  ║  8. Label issue: -bot-working                                          ║
  ╚════════════════════════════════════════════════════════════════════════════╝
                                    │
                                    ▼
         ┌────────────────────────────────────────────┐
         │ GITHUB PR CREADO AUTOMÁTICAMENTE            │
         │ Title: "PR: {issue.title}"                  │
         │ Head: task/issue-X, Base: main              │
         │ Body: Summary + changes + "Resolves #X"     │
         │ Status: Open (requiere review manual)       │
         └────────┬─────────────────────────────────────┘
                  │
                  │ Usuario revisa + aprueba
                  │ Usuario clickea MERGE
                  │
                  ▼
         GitHub webhook: pull_request.closed + merged=true
                  │
                  ▼
  ╔════════════════════════════════════════════════════════════════════════════╗
  ║                      WEBHOOK → HANDLEPRCLOSED(PR)                         ║
  ║                                                                            ║
  ║  1. ENQUEUE: PR-CLOSE task                                               ║
  ║  2. Extraer issue associado:                                            ║
  ║     ├─ Parsea PR.body por "Resolves #X"                                ║
  ║     ├─ O parseapr.head.ref por /issue-(\d+)/                          ║
  ║     └─ issueNumber = X                                                 ║
  ║  3. Descargar info:                                                     ║
  ║     ├─ PR files, commits, comments de issue                            ║
  ║     └─ Session anterior (issue-X.json)                                ║
  ║  4. buildHumanSummary():                                               ║
  ║     ├─ "Se atendió el pedido..."                                      ║
  ║     ├─ Ref al plan anterior                                           ║
  ║     ├─ Lista 8 archivos modificados                                   ║
  ║     ├─ Lista commits                                                  ║
  ║     └─ Recomendaciones técnicas                                       ║
  ║  5. createComment() en issue con summary                              ║
  ║  6. updateLabels(issue): [completed]                                  ║
  ║  7. Notion integration:                                               ║
  ║     ├─ findNotionPageIdByIssueUrl()                                  ║
  ║     ├─ notion.pages.update():                                        ║
  ║     │  property: "Estado" = "Completada"                             ║
  ║     └─ Log: "✅ [NOTION] Estado actualizado"                         ║
  ║  8. Cleanup:                                                          ║
  ║     ├─ removeWorktree(issueNumber)                                   ║
  ║     │  ├─ git worktree remove --force                               ║
  ║     │  ├─ git branch -D task/issue-X                                ║
  ║     │  └─ git push origin :task/issue-X (elimina remota)            ║
  ║     ├─ rm session_logs/issue-X.json                                 ║
  ║     └─ rm session_logs/issue-X.log                                  ║
  ╚════════════════════════════════════════════════════════════════════════════╝
                                    │
                                    ▼
         ┌────────────────────────────────────────────────┐
         │ ISSUE COMPLETADO                               │
         │ ✅ Labels: [completed]                         │
         │ ✅ Comentario: Summary de cambios              │
         │ ✅ PR: Mergeado en main                         │
         │ ✅ Notion Card: "Completada"                   │
         │ ✅ Cambios: EN PRODUCCIÓN                      │
         │ ✅ Sesión local: LIMPIADA                      │
         └────────────────────────────────────────────────┘
```

---

## DIAGRAMA 2: SISTEMA DE COLAS Y WORKERS

```
┌──────────────────────────────────────────────────────────────────────┐
│                      WEBHOOK-SERVER QUEUE SYSTEM                     │
│                                                                       │
│  const queue = [];           // Tasks pendientes                      │
│  const maxConcurrent = 3;    // Máximo 3 workers simultáneos          │
│  let activeWorkers = 0;      // Workers activos AHORA                 │
│  const inFlightIssues = new Set(); // Issues en ejecución (único/issue) │
│  const labelCooldowns = new Map(); // 2.5s cooldown por evento label   │
└──────────────────────────────────────────────────────────────────────┘

EJEMPLO DE EJECUCIÓN:

TIEMPO T=0ms
┌─────────────┐
│ queue: []   │
│ activeW: 0/3│
└─────────────┘

  GitHub webhook: Issue #1 opened
  ├─ enqueueTask({ name: "PLAN", issueNumber: 1, ... })
  
┌──────────────────────┐
│ queue: [PLAN#1]      │
│ activeW: 0/3         │
│ inFlightIssues: {}   │
└──────────────────────┘
  ├─ processQueue()
  │  ├─ nextIndex = 0 (PLAN#1 no bloqueado)
  │  ├─ inFlight.add("PLAN:1")
  │  ├─ inFlightIssues.add(1)
  │  ├─ activeWorkers = 1
  │  └─ spawn PLAN#1 execution

TIEMPO T=10ms
┌──────────────────────┐
│ queue: []            │
│ activeW: 1/3         │
│ inFlightIssues: {1}  │
└──────────────────────┘

  GitHub webhook: Issue #2 opened
  ├─ enqueueTask({ name: "PLAN", issueNumber: 2, ... })
  
┌──────────────────────┐
│ queue: [PLAN#2]      │
│ activeW: 1/3         │
│ inFlightIssues: {1}  │
└──────────────────────┘
  ├─ processQueue()
  │  ├─ nextIndex = 0 (PLAN#2 no bloqueado, issue 2 != inFlightIssues)
  │  ├─ activeWorkers = 2
  │  └─ spawn PLAN#2 execution

TIEMPO T=20ms
┌──────────────────────┐
│ queue: []            │
│ activeW: 2/3         │
│ inFlightIssues: {1,2}│
└──────────────────────┘

  GitHub webhook: Issue #1 labeled "ready-for-dev"
  ├─ enqueueTask({ name: "BUILD", issueNumber: 1, ... })
  
┌──────────────────────┐
│ queue: [BUILD#1]     │
│ activeW: 2/3         │
│ inFlightIssues: {1,2}│
└──────────────────────┘
  ├─ processQueue()
  │  ├─ nextIndex = -1 (BUILD#1 bloqueado! issue 1 en inFlightIssues)
  │  └─ NO se ejecuta, espera

TIEMPO T=30ms
┌──────────────────────┐
│ queue: [BUILD#1]     │
│ activeW: 2/3         │
│ inFlightIssues: {1,2}│
└──────────────────────┘

  GitHub webhook: Issue #3 opened
  ├─ enqueueTask({ name: "PLAN", issueNumber: 3, ... })
  
┌──────────────────────┐
│ queue: [BUILD#1, PLAN#3] │
│ activeW: 2/3         │
│ inFlightIssues: {1,2}│
└──────────────────────┘
  ├─ processQueue()
  │  ├─ nextIndex = 1 (PLAN#3, no bloqueado)
  │  ├─ activeWorkers = 3 (MAX REACHED)
  │  └─ spawn PLAN#3 execution

TIEMPO T=40ms
┌────────────────────────┐
│ queue: [BUILD#1]       │
│ activeW: 3/3 (FULL)    │
│ inFlightIssues: {1,2,3}│
└────────────────────────┘
  └─ processQueue() retorna (activeWorkers = maxConcurrent)

TIEMPO T=5000ms (PLAN#1 finalizó)
┌────────────────────────┐
│ queue: [BUILD#1]       │
│ activeW: 2/3           │
│ inFlightIssues: {2,3}  │ <- Issue 1 REMOVIDA
└────────────────────────┘
  ├─ task.finally() callback
  │  ├─ inFlight.delete("PLAN:1")
  │  ├─ inFlightIssues.delete(1)
  │  ├─ activeWorkers = 2
  │  └─ setTimeout(processQueue, 100)

TIEMPO T=5100ms
  ├─ processQueue()
  │  ├─ nextIndex = 0 (BUILD#1, NO bloqueado! issue 1 no en inFlightIssues)
  │  ├─ activeWorkers = 3 (vuelve a MAX)
  │  └─ spawn BUILD#1 execution

┌────────────────────────┐
│ queue: []              │
│ activeW: 3/3 (FULL)    │
│ inFlightIssues: {1,2,3}│ <- Issue 1 vuelve a entrar
└────────────────────────┘

COMPORTAMIENTO FINAL:
✅ PLAN#1 → BUILD#1: Secuencial (mismo issue)
✅ PLAN#2: Paralelo a PLAN#1
✅ PLAN#3: Paralelo a PLAN#1 y PLAN#2
✅ Max 3 tasks simultáneas
✅ Si misma issue: FIFO, no paralelo
```

---

## DIAGRAMA 3: PERSISTENCIA DE CONTEXTO

```
┌────────────────────────────────────────────────────────────────────┐
│              SESSION CONTEXT FLOW (Planning → Development)         │
└────────────────────────────────────────────────────────────────────┘

FASE 1: PLAN
───────────

┌─ GitHub Issue #42 creado
│  └─ Body: "Cambiar color botón a azul"
│
├─ PLAN Flow ejecuta
│  ├─ loadSession(42)
│  │  └─ session_logs/issue-42.json (NO EXISTE)
│  │     {
│  │       "issueNumber": 42,
│  │       "lastCommentId": 0,
│  │       "plans": [],
│  │       "feedback": []
│  │     }
│  │
│  ├─ getComments() → [] (sin comentarios)
│  ├─ updateSessionWithComments(session, [])
│  │  └─ sin cambios
│  │
│  ├─ buildPlanPrompt(issue, session, isNew=true)
│  │  └─ "Analiza: Cambiar color botón a azul\n..."
│  │  └─ Output: "### 📋 Plan\n- Localizar input color\n- Cambiar a #0066FF\n- ..."
│  │
│  ├─ runOpenCode() → opencode run "..."
│  │  └─ Output (limpio): "### 📋 Plan\n- Localizar..."
│  │
│  └─ saveSession(42, session)
│     {
│       "issueNumber": 42,
│       "lastCommentId": 5001,
│       "plans": [
│         {
│           "createdAt": "2026-03-04T10:30:00Z",
│           "body": "### 📋 Plan\n- Localizar...\n"
│         }
│       ],
│       "feedback": []
│     }

FASE 1B: USUARIO COMENTA FEEDBACK
─────────────────────────────────

┌─ Usuario comenta: "Preferiblemente que sea degradado"
│
├─ GitHub webhook: issue_comment.created
│  └─ REPLAN Flow
│     ├─ loadSession(42)
│     │  └─ JSON anterior (con 1 plan)
│     │
│     ├─ getComments() → [nuevo comentario]
│     ├─ updateSessionWithComments(session, comments)
│     │  └─ Agrega a session.feedback[]:
│     │     {
│     │       "id": 5002,
│     │       "author": "usuario",
│     │       "createdAt": "2026-03-04T10:35:00Z",
│     │       "body": "Preferiblemente que sea degradado"
│     │     }
│     │
│     └─ SESSION AHORA ES:
│        {
│          "issueNumber": 42,
│          "lastCommentId": 5002,
│          "plans": [
│            {
│              "createdAt": "2026-03-04T10:30:00Z",
│              "body": "### 📋 Plan\n- Localizar...\n"
│            }
│          ],
│          "feedback": [
│            {
│              "id": 5002,
│              "author": "usuario",
│              "body": "Preferiblemente que sea degradado"
│            }
│          ]
│        }

FASE 2: NUEVO PLAN (CON FEEDBACK)
──────────────────────────────────

┌─ PLAN Flow ejecuta DE NUEVO
│
├─ loadSession(42)
│  └─ Lee session anterior (con plan + feedback)
│
├─ buildPlanPrompt(issue, session, isNew=false)
│  │ Construye prompt INCLUYENDO:
│  ├─ "Plan previo:\n### 📋 Plan\n- Localizar...\n"
│  ├─ "Feedback reciente:\n- usuario: Preferiblemente que sea degradado"
│  └─ "Actualiza el plan técnico según el feedback..."
│  
│  Output: "### 📋 Plan ACTUALIZADO\n- Localizar...\n- Aplicar degradado...\n"
│
├─ runOpenCode() → opencode run "..."
│  └─ Output (limpio): "### 📋 Plan ACTUALIZADO\n..."
│
└─ saveSession(42, session)
   {
     "issueNumber": 42,
     "lastCommentId": 5002,
     "plans": [
       {
         "createdAt": "2026-03-04T10:30:00Z",
         "body": "### 📋 Plan\n- Localizar...\n"
       },
       {  ← NUEVO PLAN con feedback considerado
         "createdAt": "2026-03-04T10:40:00Z",
         "body": "### 📋 Plan ACTUALIZADO\n- Localizar...\n- Degradado...\n"
       }
     ],
     "feedback": [...]
   }

FASE 3: BUILD (DESARROLLO)
──────────────────────────

┌─ Usuario aprueba con "ready-for-development" label
│
├─ BUILD Flow
│  ├─ ensureWorktree(42)
│  │  └─ ~/openclaw-workspace/worktrees/v0-ferreteria/issue-42
│  │
│  ├─ loadSession(42)
│  │  └─ Lee session con 2 plans + feedback
│  │
│  ├─ const lastPlan = session.plans[-1]  ← PLAN ACTUALIZADO!
│  │  "### 📋 Plan ACTUALIZADO\n- Localizar...\n- Degradado...\n"
│  │
│  ├─ runOpenCode(programmer=true)
│  │  "Sigue este plan:\n{lastPlan}\n\nEJECUTA AHORA"
│  │  --dir {worktreePath}
│  │  ├─ OpenCode lee el plan ACTUALIZADO (con feedback)
│  │  ├─ OpenCode implementa degradado (no solo color)
│  │  └─ OpenCode escribe cambios en worktree
│  │
│  └─ session se mantiene (no se modifica)

RESULTADO:
✅ Plan evoluciona con feedback humano
✅ BUILD recibe plan más refinado
✅ Contexto persiste entre fases
✅ NO se pierde información entre ejecuciones
```

---

## DIAGRAMA 4: ARQUITECTURA DE MODELOS Y FALLBACKS

```
┌─────────────────────────────────────────────────────────────┐
│                MODELO AI Y FALLBACK STRATEGY                 │
└─────────────────────────────────────────────────────────────┘

PLAN MODE (Análisis, READ-ONLY)
────────────────────────────────

Configuración:
- PLANNER_PROVIDER = "auto" (u otro)
- PLANNER_PROFILE = "fast" (u otro)
- PLANNER_MODEL = null (usar defaults)

Selección de Modelo:
┌─ selectPlannerModel(provider, profile)
│  ├─ Profile "fast" → "opencode/trinity-large-preview-free"
│  └─ Profile "balanced" → "opencode/trinity-large-preview-free"
│
├─ Intenta: opencode run --model trinity-large-preview-free "..."
│
└─ Ejecución y validación:
   │
   ├─ runOpenCode() ejecuta
   │  ├─ spawn: opencode run --model trinity-large-preview-free ...
   │  └─ Captura output
   │
   ├─ detectWriteAttempts(output)
   │  │ Busca patrones:
   │  ├─ "← Edit", "← Write", "← Delete"
   │  ├─ "Index: /path", "--- /path", "+++ /path"
   │  └─ "@@ -1,5 +1,6 @@" (diff markers)
   │
   ├─ SI detecta intentos de escritura:
   │  ├─ Fuerza fallback
   │  └─ selectFallbackPlannerModel(planner)
   │     ├─ trinity-large-preview-free → minimax-m2.5-free
   │     ├─ minimax-m2.5-free → big-pickle
   │     └─ big-pickle → null (FALLBACK CHAIN END)
   │
   ├─ SI modelo falla (ProviderModelNotFoundError, TPM, etc.):
   │  └─ shouldFallbackToPlanner(output) → true
   │     └─ selectFallbackPlannerModel(planner)
   │        └─ Intenta siguiente en chain
   │
   └─ cleanOutput(output) → extrae solo plan

Fallback Chain PLAN:
┌────────────────────────────────────────┐
│ trinity-large-preview-free             │ PRIMARY
│ │                                       │
│ ├─ Error: model not found              │
│ ├─ Error: TPM limit                    │
│ ├─ Error: request too large            │
│ └─ OR: detectWriteAttempts() = true    │
│        ▼                                │
│    minimax-m2.5-free                   │ FALLBACK 1
│    │                                   │
│    ├─ Error: model not found           │
│    └─ OR: detectWriteAttempts() = true │
│           ▼                             │
│       big-pickle                       │ FALLBACK 2
│       │                                │
│       └─ SI falla: return output limpio│
│
└────────────────────────────────────────┘

BUILD MODE (Desarrollo, WRITE)
───────────────────────────────

Configuración:
- BUILD_MODEL = "github-copilot/claude-haiku-4.5" (de .env)

Selección:
┌─ buildBaseCommand(isProgrammer=true, model)
│  └─ "opencode --model github-copilot/claude-haiku-4.5 run"
│
├─ Intenta: opencode --model claude-haiku-4.5 run "..."
│
└─ Ejecución:
   │
   ├─ runOpenCode() ejecuta
   │  ├─ spawn: opencode --model claude-haiku-4.5 run ...
   │  ├─ Captura output
   │  └─ NO verifica detectWriteAttempts (modo WRITE es normal!)
   │
   ├─ shouldFallbackToPlanner(output) busca errores
   │  ├─ "model not found"
   │  ├─ "tpm limit"
   │  └─ "request too large"
   │
   ├─ SI detecta error:
   │  └─ selectFallbackBuildModel(currentModel)
   │     ├─ claude-haiku-4.5 → trinity-large-preview-free
   │     ├─ trinity-large-preview-free → minimax-m2.5-free
   │     └─ minimax-m2.5-free → null
   │
   └─ cleanOutput(output) → extrae resumen de cambios

Fallback Chain BUILD:
┌────────────────────────────────────────┐
│ github-copilot/claude-haiku-4.5        │ PRIMARY
│ │                                       │
│ └─ Error: model not found              │
│    Error: TPM limit                    │
│           ▼                             │
│    trinity-large-preview-free          │ FALLBACK 1
│    │                                   │
│    └─ Error: model not found           │
│           ▼                             │
│       minimax-m2.5-free                │ FALLBACK 2
│       │                                │
│       └─ SI falla: return output limpio│
│
└────────────────────────────────────────┘

EXECUTION STATE TRACKING
────────────────────────

execution_states/issue-42.json
{
  "issueNumber": 42,
  "status": "in_progress",
  "plansExecuted": [
    {
      "planHash": "abc123def456",
      "timestamp": "2026-03-04T10:30:00Z",
      "status": "completed",
      "model": "opencode/trinity-large-preview-free"
    },
    {
      "planHash": "xyz789uvw012",
      "timestamp": "2026-03-04T10:40:00Z",
      "status": "completed",
      "model": "opencode/trinity-large-preview-free",
      "wasFallback": false
    }
  ],
  "lastSuccessfulPlan": "xyz789uvw012",
  "buildAttempts": 1,
  "planAttempts": 2
}

Propósito:
- hasBeenExecuted(42, plan) → true si hash coincide
- Evita re-ejecutar planes idénticos
- Tracking de intentos para debugging
```

