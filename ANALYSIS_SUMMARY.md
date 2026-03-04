# RESUMEN EJECUTIVO: OpenClaw Architecture Analysis

## 📋 Proyecto OpenClaw

OpenClaw es un **sistema de automatización end-to-end** que conecta Notion → GitHub → Desarrollo → Producción mediante:
- Webhooks de GitHub
- IA (OpenCode CLI)
- Git workflows (worktrees)
- System de colas FIFO con workers

---

## 1️⃣ ENDPOINTS Y WEBHOOKS (webhook-server.js)

| Endpoint | Eventos | Acción |
|----------|---------|--------|
| `POST /webhook` (puerto 3000) | `issues.opened` | Enqueue PLAN si label `from-notion` |
| | `issues.labeled` | Enqueue PLAN si label `from-notion` o `awaiting-ia-intervention` |
| | | Enqueue BUILD si label `ready-for-development` |
| | `issue_comment.created` | Enqueue REPLAN si comentario no es del bot |
| | `pull_request.closed` (merged) | Enqueue PR-CLOSE: actualiza Notion, limpia sesión |

**Autenticación:** HMAC-SHA256 con `GITHUB_WEBHOOK_SECRET`

**Cola:** FIFO, máx 3 workers concurrentes, 1 task por issue a la vez

---

## 2️⃣ FLUJOS PRINCIPALES

### **RUNPLANFLOW (Análisis)**
1. Carga sesión anterior
2. Descarga comentarios (feedback) desde GitHub
3. Construye prompt: issue + plan anterior + feedback
4. **Ejecuta OpenCode en READ-ONLY mode** (planner model: trinity-large-preview-free)
5. Limpia output → extrae solo "### 📋 Plan ..."
6. Publica plan como comentario en GitHub
7. Actualiza labels: `awaiting-human-intervention` (espera feedback)

### **RUNBUILDFLOW (Desarrollo)**
1. Crea worktree en `~/openclaw-workspace/worktrees/v0-ferreteria/issue-X`
2. Carga última sesión para obtener el plan
3. **Ejecuta OpenCode en WRITE mode** (build model: claude-haiku-4.5)
   - Prompt: "Sigue este plan: {plan}\n\nEJECUTA AHORA"
   - Directorio: worktree (NO repo principal)
4. Si hay cambios:
   - Git commit "feat: fix #X"
   - Git push a `task/issue-X`
   - Crea PR automático
5. Labels: `pr-generated`

### **HANDLEPRCLOSED (Post-merge)**
1. Busca issue asociado (por "Resolves #X" o branch name)
2. Descarga PR files, commits, comments
3. Crea resumen humano: "Se atendió el pedido..."
4. **Actualiza Notion**: Estado = "Completada"
5. Limpia:
   - Worktree local
   - Branch local + remota
   - Sesión (session_logs/issue-X.json)

---

## 3️⃣ PERSISTENCIA: PLANNING → DEVELOPMENT

### **SESSION STORAGE** (`session_logs/issue-X.json`)

```json
{
  "issueNumber": 42,
  "plans": [
    {
      "createdAt": "...",
      "body": "### 📋 Plan\n- Task 1\n- Task 2"
    }
  ],
  "feedback": [
    {
      "author": "usuario",
      "body": "Cambiar a rojo"
    }
  ]
}
```

**Cómo funciona:**
- PLAN Flow: Lee sesión → agrega feedback nuevo → genera plan → guarda sesión
- BUILD Flow: Lee sesión → obtiene último plan → lo ejecuta
- **El plan evoluciona con feedback humano antes de la ejecución**

---

## 4️⃣ SISTEMA DE COLAS

### **Estructura**
```javascript
const queue = [];               // Tasks pendientes
const maxConcurrent = 3;        // Máx workers
let activeWorkers = 0;          // Workers activos ahora
const inFlightIssues = new Set(); // Issues en ejecución (evita duplicados)
```

### **Comportamiento**
- **1 issue = 1 worker máximo** (secuencial: PLAN → BUILD)
- **Diferentes issues = paralelo** (máx 3 en paralelo)
- **Label cooldown: 2.5s** (evita spam de eventos GitHub)
- **traceId end-to-end** para tracking

**Ejemplo:**
```
Issue #1: PLAN (ejecutando) → enqueue BUILD (espera PLAN termine)
Issue #2: PLAN (ejecutando, paralelo a #1)
Issue #3: PLAN (ejecutando, paralelo a #1 y #2)
= 3 workers = FULL

Cuando #1 PLAN termina → Issue #1 BUILD se ejecuta
```

---

## 5️⃣ MANEJO DE SECRETOS Y CONFIGURACIÓN

### **.env (Texto plano)**
- `GITHUB_TOKEN` → Octokit
- `NOTION_TOKEN` → Notion Client
- `NOTION_DATABASE_ID` → DB de Notion
- `BUILD_MODEL` (default: `github-copilot/claude-haiku-4.5`)
- `PLANNER_MODEL` (default: `opencode/trinity-large-preview-free`)

### **Hardcoded en config/constants.js**
- `REPO_PATH` = `~/openclaw-workspace/repos/v0-ferreteria`
- `REPO_OWNER` = `zalazarnatanael`
- `REPO_NAME` = `v0-ferreteria`
- `LABELS` = 6 labels específicos

⚠️ **NO usa gestor de secretos (vault, AWS Secrets Manager, etc.)**

---

## 6️⃣ INTEGRACIÓN OPENCODE (IA)

### **Modos**

| Modo | Propósito | Modelo | Comando |
|------|-----------|--------|---------|
| **PLAN** (READ-ONLY) | Analizar, generar plan | trinity-large-preview-free | `opencode run "..."` |
| **BUILD** (WRITE) | Implementar cambios | claude-haiku-4.5 | `opencode --model X run "..."` |

### **Fallback Chain**
```
PLAN:
  trinity-large-preview-free
    ↓ (error/timeout/write-attempt)
  minimax-m2.5-free
    ↓ (error)
  big-pickle
    ↓ (error)
  FAIL

BUILD:
  claude-haiku-4.5
    ↓ (error)
  trinity-large-preview-free
    ↓ (error)
  minimax-m2.5-free
    ↓ (error)
  FAIL
```

### **Validación READ-ONLY (PLAN Mode)**
- `detectWriteAttempts(output)` busca: `← Edit`, `← Write`, `← Delete`
- Si detecta: **fuerza fallback** a modelo diferente
- Asegura que PLAN sea solo análisis

---

## 7️⃣ DIFERENCIAS: ACTUAL vs DESEADO

### ❌ Actual: Single Project
- REPO_PATH, REPO_OWNER, REPO_NAME **hardcoded**
- 1 solo webhook en :3000
- 1 sola BD de Notion
- Si quieres 2 proyectos = 2 instancias de webhook-server

### ❌ Sin Dashboard
- `/root/.openclaw/canvas/index.html` = solo test page
- NO muestra: estado issues, cola, workers, logs en tiempo real

### ✅ Actual: 3 Workers Fijos
- Configurables pero hardcoded (línea 26 webhook-server.js)
- FIFO inteligente: respeta secuencia pero paraleliza diferentes issues

---

## 8️⃣ PUNTOS DE INTEGRACIÓN CLAVE

### **Detección de Labels (GitHub)**
```
webhook-server.js:404-445
events.labeled → busca labels específicos → enqueue task
```

### **Comunicación Notion**
```
webhook-server.js:296-368 (handlePrClosed)
1. findNotionPageIdByIssueUrl() → query Notion database
2. notion.pages.update() → actualiza Estado = "Completada"
```

### **Integración OpenCode**
```
services/aiService.js:10-162
spawn opencode --model X run "$(cat prompt.txt)" --dir {cwd}
Captura output → cleanOutput() → limpia logs/tool-output
```

---

## 9️⃣ ESTADÍSTICAS

- **Archivos principales:** 6 (main.js, webhook-server.js, + 4 services)
- **Líneas de código:** ~2,000 (core logic)
- **Servicios:** aiService, sessionContext, githubRetry, worktreeManager, telegramNotify, executionStateManager
- **Dependencias NPM:** @octokit/rest, @notionhq/client, express, simple-git, dotenv, openai

---

## 🔟 FLUJO VISUAL COMPLETO

```
Notion Card
    ↓ (script externo)
GitHub Issue + "from-notion" label
    ↓ WEBHOOK
webhook-server.js:3000
    ↓ ENQUEUE PLAN
runPlanFlow() → OpenCode (READ-ONLY)
    ↓ comentario + "awaiting-human-intervention"
Usuario revisa + comenta feedback
    ↓ WEBHOOK (issue_comment)
REPLAN: nuevo plan CON feedback
    ↓
Usuario aprueba: "ready-for-development" label
    ↓ WEBHOOK → ENQUEUE BUILD
runBuildFlow() → OpenCode (WRITE) en worktree
    ↓ git push task/issue-X + PR creado
Usuario revisa PR + MERGE
    ↓ WEBHOOK (pull_request.closed + merged)
handlePrClosed()
    ├─ Resumen en GitHub issue
    ├─ Notion: Estado = "Completada"
    ├─ Limpia worktree + branch
    └─ Limpia sesión local
✅ ISSUE COMPLETADO + PRODUCCIÓN
```

---

## 📊 TABLAS DE REFERENCIA

### **Labels del Sistema**
| Label | Significado | Cuándo |
|-------|-------------|--------|
| `from-notion` | Issue viene de Notion | Al crear issue |
| `awaiting-ia-intervention` | Esperando que IA genere plan | Cuando hay feedback |
| `awaiting-human-intervention` | Plan listo, espera revisión | Después de PLAN flow |
| `ready-for-development` | Usuario aprobó, listo para BUILD | Usuario agrega label |
| `bot-working` | Bot está ejecutando task | Durante PLAN/BUILD |
| `pr-generated` | PR creado automáticamente | Después de BUILD flow |
| `completed` | Issue resuelto | Después de merge |

### **Task Types**
| Task | Flow | Trigger |
|------|------|---------|
| PLAN | runPlanFlow | issues.opened/labeled |
| BUILD | runBuildFlow | issues.labeled (ready-for-dev) |
| REPLAN | runPlanFlow con feedback | issue_comment.created |
| PR-CLOSE | handlePrClosed | pull_request.closed (merged) |
| READY-LABELS | updateLabels | issues.labeled (ready-for-dev) |

---

## 🎯 CONCLUSIONES

1. **Sistema robusto**: Webhooks + colas + worktrees + AI
2. **Contexto persistente**: Session storage permite feedback iterativo
3. **Fallback strategy**: 3 modelos de IA en cada modo
4. **Single project**: Ideal para 1 repo, necesita refactoring para multi-proyecto
5. **Sin dashboard**: Logs solo en consola/archivos
6. **OpenCode central**: `opencode run` es el engine que ejecuta todo

---

**Generado:** 4 de Marzo de 2026 | **Proyecto:** OpenClaw | **Versión:** Analysis v1.0

