# Logica de negocio - OpenClaw

Este documento explica el contexto completo, flujo de negocio y arquitectura del bot OpenClaw para continuar el desarrollo sin perder contexto.

## 1. Objetivo del sistema

Automatizar el ciclo Notion -> GitHub -> PR -> Merge, con un bot que:

- Analiza tareas y propone un plan tecnico.
- Itera con humanos hasta acordar el plan.
- Desarrolla en un worktree aislado.
- Genera PR y actualiza Notion/GitHub.

## 2. Flujo end-to-end (resumen)

1. Cliente mueve card en Notion de "TAREAS" a "READY".
2. Cron (`webhook-server.js` o `scripts/auto_expand_multi_projects.js`) detecta.
3. Se crea Issue en GitHub con label `from-notion`.
4. Bot analiza, genera plan y agrega label `awaiting-human-intervention`.
5. Humano comenta ajustes; el bot replanifica (loop).
6. Humano marca `ready-for-development`.
7. Bot desarrolla en worktree y genera PR.
8. PR mergeado -> Notion pasa a DONE, issue se cierra.

### 2.1 Diagrama del flujo

```text
Notion READY
   |
   v
Cron Notion -> GitHub Issue + label from-notion
   |
   v
Webhook GitHub -> PLAN (bot-working)
   |
   v
Plan + complexity -> awaiting-human-intervention
   |
   +--> Comentario humano -> awaiting-ia-intervention -> REPLAN (loop)
   |
   v
Label ready-for-development
   |
   v
BUILD en worktree -> PR generado
   |
   v
PR merged -> Notion DONE + close issue + cleanup
```

## 3. Estados y labels de negocio

GitHub labels:

- `from-notion`: issue creado desde Notion.
- `bot-working`: el bot esta procesando.
- `awaiting-human-intervention`: esperando feedback humano.
- `awaiting-ia-intervention`: esperando a la IA.
- `ready-for-development`: aprobado para desarrollo.
- `pr-generated`: PR creado.

Notion status (ejemplo):

- READY
- GH ISSUE
- PLANNING
- READY FOR DEVELOP
- IN PROGRESS
- PR CHECK EN GH
- DONE

## 4. Arquitectura tecnica

### 4.1 Entrypoints

- `webhook-server.js`: recibe webhooks GitHub, encola tasks y expone API de secretos.
- `scripts/auto_expand_multi_projects.js`: cron para Notion -> GitHub.

### 4.2 Persistencia y cola

- Supabase guarda tareas en tabla `tasks`.
- Al iniciar, el bot rehidrata tareas pendientes.
- Cada task tiene `project_id`, `task_type`, payload y metadata.

### 4.3 Sesion OpenCode

- Se crea al inicio (planning) para mantener contexto.
- Se reutiliza en replanificacion y desarrollo.
- Logs en `session_logs/issue-X.json`.

### 4.4 Worktrees

- Un worktree por issue: `worktrees/{projectId}/issue-XX`.
- Aislacion completa del repo base.

## 5. Seleccion de modelos

El modelo se elige segun complejidad de la tarea:

- `simple`
- `medium`
- `complex`

El LLM clasifica la complejidad y se guarda en el comentario del plan:

```text
### 📋 Plan

```complexity
medium
```
```

Modelos configurables por proyecto en `config/projects.js`.

## 6. Supabase

Tablas principales:

- `projects`
- `project_secrets`
- `tasks`
- `task_logs`
- `plan_history`

Las tablas se definen en `db/schema.sql`.

## 7. Secrets

- Se cifran localmente con AES (`ENCRYPTION_MASTER_KEY`).
- Se guardan cifrados en `project_secrets`.
- El bot descifra en runtime.

## 8. Reintentos y recuperacion

- Tasks con status `pending/processing/failed` se rehidratan al reiniciar.
- Se re-encolan en la cola FIFO.

## 9. Configuracion y deployment

### 9.1 Variables de entorno

Ver `config/projects.example.env`.

### 9.2 PM2

`ecosystem.config.js` levanta:

- `openclaw-webhook`
- `openclaw-cron`

## 10. Puntos de integracion

- GitHub Webhooks: `POST /webhook/:projectId`
- Secrets API: `GET /api/projects/:projectId/secrets`
- Supabase: Service Role Key

## 11. Criterios de exito

- Las tasks no se pierden si el bot reinicia.
- Los proyectos son aislados.
- El bot comenta plan y complejidad.
- El PR siempre contiene `Summary`, `Notas`, `Resolves #issue`.

## 12. Roadmap recomendado

1. Dashboard con visualizacion de estado.
2. Observabilidad estructurada (logs JSON).
3. Alertas y notificaciones en tiempo real.
