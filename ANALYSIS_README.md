# 📊 Análisis Completo de OpenClaw

Este directorio contiene análisis detallado de la estructura y funcionamiento del proyecto OpenClaw.

## 📄 Documentos Disponibles

### 1. **ANALYSIS_SUMMARY.md** (Inicio aquí)
   - Resumen ejecutivo
   - Tablas de referencia
   - Estadísticas principales
   - 10 secciones clave
   - **Duración de lectura:** 10-15 min

### 2. **ANALYSIS_DETAILED.md** (Análisis profundo)
   - Diagrama actual del sistema
   - Endpoints y webhooks
   - runPlanFlow y runBuildFlow detallados
   - Sistema de colas (FIFO con workers)
   - Manejo de secretos
   - Flujos actuales (Notion → GitHub → Build)
   - Persistencia de contexto
   - Diferencias (actual vs deseado)
   - Puntos de integración
   - **Duración de lectura:** 20-30 min

### 3. **ANALYSIS_DIAGRAMS.md** (Diagramas visuales)
   - Flujo completo (Notion → Producción)
   - Sistema de colas y workers
   - Persistencia de contexto
   - Arquitectura de modelos y fallbacks
   - **Mejor para:** Entender visualmente el flujo

## 🗺️ Mapa Mental Rápido

```
OPENCLAW
├─ WEBHOOK-SERVER (:3000)
│  ├─ Recibe 5 tipos de eventos GitHub
│  ├─ Valida firma HMAC-SHA256
│  └─ Enqueue tasks en cola FIFO (máx 3 workers)
│
├─ FLUJOS PRINCIPALES
│  ├─ PLAN Flow → IA análisis (READ-ONLY)
│  ├─ BUILD Flow → IA desarrollo (WRITE)
│  └─ PR-CLOSE → Actualiza Notion + limpia
│
├─ PERSISTENCIA
│  └─ Session storage (session_logs/issue-X.json)
│     ├─ Plans: [histórico de planes]
│     └─ Feedback: [comentarios usuarios]
│
├─ INTEGRACIÓN IA
│  ├─ OpenCode (CLI tool)
│  ├─ Modo PLAN: trinity-large-preview-free
│  ├─ Modo BUILD: claude-haiku-4.5
│  └─ Fallback chain de 3 modelos
│
└─ LIMITACIONES ACTUALES
   ├─ Single project (hardcoded)
   ├─ No dashboard
   └─ 3 workers fijos
```

## 🎯 Cómo Usar Este Análisis

### Para entender el proyecto rápido:
1. Lee **ANALYSIS_SUMMARY.md** (10 min)
2. Mira **ANALYSIS_DIAGRAMS.md** (5 min)

### Para desarrollo/refactoring:
1. Lee **ANALYSIS_DETAILED.md** completo
2. Consulta **ANALYSIS_DIAGRAMS.md** para puntos específicos
3. Usa tablas de referencia en SUMMARY

### Para debugging:
1. Busca en DETAILED.md por función/archivo
2. Consulta diagrama de "Sistema de Colas" en DIAGRAMS.md
3. Revisa "Persistencia de Contexto" en DIAGRAMS.md

## 📊 Estadísticas Clave

| Métrica | Valor |
|---------|-------|
| Puerto Webhook | 3000 |
| Workers concurrentes | 3 (máx) |
| Tasks por issue | Secuencial |
| Issues en paralelo | 3 (máx) |
| Label cooldown | 2.5s |
| Modelos IA (PLAN) | 3 (fallback chain) |
| Modelos IA (BUILD) | 3 (fallback chain) |
| Eventos GitHub escuchados | 5 tipos |
| Labels del sistema | 7 |

## 🔑 Términos Clave

- **runPlanFlow**: Análisis de issue (READ-ONLY, IA modo planner)
- **runBuildFlow**: Implementación de cambios (WRITE, IA modo programmer)
- **handlePrClosed**: Post-merge, actualiza Notion y limpia
- **Worktree**: Directorio separado para cada issue (git worktree)
- **Session**: Almacenamiento JSON con plans + feedback
- **traceId**: ID único para tracking end-to-end
- **FIFO Queue**: First-In-First-Out con 1 issue = 1 worker

## ⚠️ Decisiones Arquitectónicas

✅ **Aciertos:**
- Worktrees: evita conflictos en repo principal
- Session storage: contexto persiste entre PLAN y BUILD
- Fallback chain: redundancia en modelos IA
- READ-ONLY validation: asegura que PLAN no modifique

❌ **Limitaciones:**
- Hardcoded project config
- Sin dashboard en tiempo real
- Tokens en .env (no vault)
- Workers fijos (no dinámicos)

---

**Última actualización:** 4 de Marzo de 2026  
**Versión del análisis:** 1.0  
**Estado:** COMPLETE
