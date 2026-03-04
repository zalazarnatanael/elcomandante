# 📖 START HERE - Guía de Lectura del Análisis OpenClaw

## ✅ Análisis Completo Disponible

Se ha realizado un análisis exhaustivo de la arquitectura OpenClaw. Los documentos están disponibles en este directorio:

```
/root/.openclaw/
├── ANALYSIS_README.md           ← Índice principal
├── ANALYSIS_SUMMARY.md          ← EMPIEZA AQUÍ (10-15 min)
├── ANALYSIS_DETAILED.md         ← Análisis profundo (20-30 min)
├── ANALYSIS_DIAGRAMS.md         ← Diagramas visuales (5 min)
└── ANALYSIS_RECOMMENDATIONS.md  ← Próximos pasos (15 min)
```

---

## 🚀 RUTAS DE LECTURA RECOMENDADAS

### Para desarrolladores nuevos (15 min)
```
1. Lee: ANALYSIS_SUMMARY.md (secciones 1-5)
2. Mira: ANALYSIS_DIAGRAMS.md - "DIAGRAMA 1: Flujo Completo"
3. Pronto sabrás: Cómo funciona el sistema end-to-end
```

### Para arquitectos/tech leads (45 min)
```
1. Lee: ANALYSIS_SUMMARY.md (todo)
2. Lee: ANALYSIS_DETAILED.md (secciones 1-3)
3. Consulta: ANALYSIS_DIAGRAMS.md (todos los diagramas)
4. Revisa: ANALYSIS_RECOMMENDATIONS.md (Phase 1)
5. Pronto sabrás: Qué mejorar y cómo hacerlo
```

### Para debugging (varía)
```
1. Consulta: ANALYSIS_DETAILED.md - "Sistema de Colas"
2. Revisa: ANALYSIS_DIAGRAMS.md - "DIAGRAMA 2"
3. Busca: Nombre de función en índices
4. Pronto sabrás: Dónde ocurre el problema
```

### Para refactoring multi-proyecto (1 hora)
```
1. Lee: ANALYSIS_DETAILED.md (sección 3: Diferencias)
2. Lee: ANALYSIS_RECOMMENDATIONS.md (sección 1: Multi-project)
3. Consulta: Code examples en RECOMMENDATIONS
4. Pronto sabrás: Cómo implementar multi-proyecto
```

---

## 🎯 CHEAT SHEET - Preguntas Frecuentes

### "¿Cuáles son los 5 archivos principales?"

```
1. webhook-server.js (535 líneas)
   └─ Recibe webhooks GitHub, maneja colas, ejecuta tasks

2. main.js (332 líneas)
   ├─ runPlanFlow() - Analiza issue
   └─ runBuildFlow() - Implementa cambios

3. services/aiService.js (363 líneas)
   └─ runOpenCode() - Interfaz con CLI de IA

4. services/sessionContext.js (157 líneas)
   └─ Persistencia de contexto (plans + feedback)

5. services/worktreeManager.js (60 líneas)
   └─ Manejo de git worktrees por issue
```

### "¿Cómo llega un Notion card a producción?"

```
Notion Card
   ↓ script externo
GitHub Issue + label "from-notion"
   ↓ webhook
PLAN Flow → OpenCode (análisis READ-ONLY)
   ↓ comentario + espera feedback
Usuario comenta + aprueba
   ↓ webhook + label "ready-for-dev"
BUILD Flow → OpenCode (desarrollo WRITE)
   ↓ git push + PR creado
Usuario revisa + MERGE
   ↓ webhook PR.closed
handlePrClosed() → Notion actualizada
   ✅ COMPLETADO EN PRODUCCIÓN
```

### "¿Cuántos workers corren en paralelo?"

**3 workers máximo** (hardcoded en línea 26 webhook-server.js)

Pero con restricciones:
- 1 issue = 1 worker (PLAN y BUILD secuenciales)
- Máx 3 issues diferentes en paralelo
- Label cooldown: 2.5 segundos

### "¿Dónde se guardan los planes?"

**En archivos JSON locales:**
```
session_logs/issue-X.json
{
  "plans": [ { "body": "### 📋 Plan ..." } ],
  "feedback": [ { "author": "usuario", "body": "..." } ]
}
```

Y **en comentarios de GitHub** (como fallback)

### "¿Qué pasa si IA falla?"

**Fallback chain de 3 modelos:**

PLAN Mode:
```
trinity-large-preview-free (default)
  → minimax-m2.5-free (si falla)
    → big-pickle (si falla)
      → FAIL
```

BUILD Mode:
```
github-copilot/claude-haiku-4.5 (default)
  → trinity-large-preview-free (si falla)
    → minimax-m2.5-free (si falla)
      → FAIL
```

### "¿Cómo se comunica con Notion?"

**En handlePrClosed():**
1. Busca page_id en: body del issue o query a DB
2. Actualiza propiedad "Estado" = "Completada"
3. Si falla: log warning, continúa (no bloquea)

### "¿Cómo se evitan cambios en el repo principal?"

**Git worktrees:**
- Cada issue = directorio separado
- Cambios aislados en `~/openclaw-workspace/worktrees/issue-X`
- Repo principal nunca se toca
- Limpieza automática después de merge

### "¿Qué labels son importantes?"

```
from-notion          → Trigger PLAN
awaiting-human-*     → Espera feedback
ready-for-dev        → Trigger BUILD
bot-working          → Durante ejecución
pr-generated         → BUILD completado
completed            → Issue resuelto
```

---

## 🗺️ MAPA RÁPIDO DE ARCHIVOS

```
/root/.openclaw/
│
├── webhook-server.js              ⭐ MAIN: Webhooks + Queue
├── main.js                         ⭐ MAIN: Flows (PLAN + BUILD)
│
├── services/
│  ├── aiService.js                ⭐ IA: OpenCode integration
│  ├── sessionContext.js            ⭐ Context: Persistencia
│  ├── worktreeManager.js           ⭐ Git: Worktrees
│  ├── githubRetry.js               Retry logic
│  ├── executionStateManager.js     Tracking
│  └── telegramNotify.js            Notificaciones
│
├── config/
│  └── constants.js                 Configuración (hardcoded)
│
├── session_logs/                   📁 Sesiones JSON (plan + feedback)
├── execution_states/               📁 Estados de ejecución
│
└── ANALYSIS_*.md                   📊 Documentación (este análisis)
```

---

## 📊 ESTADÍSTICAS CLAVE

| Métrica | Valor |
|---------|-------|
| Puerto Webhook | 3000 |
| Evento GitHub | issues.opened, issues.labeled, issue_comment, pull_request.closed |
| Workers máximo | 3 |
| Labels del sistema | 7 |
| Archivos principales | 6 |
| Líneas de código | ~2,000 |
| Modelos IA (fallback chain) | 3 |
| Formato sesión | JSON |

---

## ⚠️ LIMITACIONES ACTUALES

```
❌ Single project (hardcoded repo)
❌ Sin dashboard (solo logs)
❌ Workers fijos (no dinámicos)
❌ Secretos en .env (no vault)
❌ Sin unit tests
✅ Worktrees (isolación buena)
✅ Session storage (contexto persiste)
✅ Fallback chain (3 modelos IA)
✅ FIFO queue (fair processing)
```

---

## 🎓 CONCEPTOS CLAVE

### Queue System
- **FIFO**: First-In-First-Out (fair)
- **1 issue = 1 worker**: Secuencial (PLAN → BUILD)
- **3 max workers**: Paralelo entre issues
- **Label cooldown**: 2.5s anti-spam

### Persistencia
- **Session**: JSON con plans[] + feedback[]
- **Evolución**: Plan se actualiza con feedback
- **Sharing**: BUILD lee plan de session

### AI Modes
- **PLAN**: READ-ONLY (solo análisis)
- **BUILD**: WRITE (implementa cambios)
- **Fallback**: 3 modelos en chain

### Git Workflow
- **Worktree**: Directorio aislado por issue
- **Branch**: task/issue-X
- **Push**: --force (overwrite si es necesario)
- **Cleanup**: Después de merge

---

## 🔗 REFERENCIAS RÁPIDAS

### Para entender Queue
→ Ver: ANALYSIS_DIAGRAMS.md - "DIAGRAMA 2: Sistema de Colas"

### Para entender Persistencia
→ Ver: ANALYSIS_DIAGRAMS.md - "DIAGRAMA 3: Persistencia de Contexto"

### Para entender IA + Fallback
→ Ver: ANALYSIS_DIAGRAMS.md - "DIAGRAMA 4: Modelos y Fallbacks"

### Para debugging específico
→ Consulta: ANALYSIS_DETAILED.md - índice de funciones

### Para próximos pasos
→ Lee: ANALYSIS_RECOMMENDATIONS.md - Phase 1, 2, 3

---

## 📞 CONTACTO / SOPORTE

Si tienes preguntas sobre:

- **Arquitectura**: Consulta ANALYSIS_DETAILED.md sección 1
- **Cómo funciona**: Consulta ANALYSIS_SUMMARY.md
- **Debugging**: Consulta ANALYSIS_DIAGRAMS.md
- **Mejoras**: Consulta ANALYSIS_RECOMMENDATIONS.md

---

## ✨ SIGUIENTES PASOS RECOMENDADOS

### Si desarrollas en OpenClaw:
1. Lee ANALYSIS_SUMMARY.md (10 min)
2. Corre el proyecto y observa logs
3. Consulta ANALYSIS_DETAILED.md si necesitas profundizar

### Si haces deployment:
1. Lee ANALYSIS_SUMMARY.md (10 min)
2. Revisa ANALYSIS_RECOMMENDATIONS.md - "Gestión de Secretos" (5 min)
3. Implementa mejor manejo de tokens

### Si escalas a multi-proyecto:
1. Lee ANALYSIS_RECOMMENDATIONS.md - "Multi-project Support" (10 min)
2. Consulta ejemplos de código
3. Estima ~500 líneas de refactoring

### Si crreas dashboard:
1. Lee ANALYSIS_RECOMMENDATIONS.md - "Dashboard" (5 min)
2. Elige: Socket.io vs SSE
3. Estima ~300 líneas de nuevo código

---

**Análisis generado:** 4 de Marzo de 2026  
**Versión:** 1.0  
**Estado:** COMPLETO Y LISTO PARA USAR

¡Bienvenido a OpenClaw! 🚀
