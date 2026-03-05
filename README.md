# OpenClaw

OpenClaw es un bot que automatiza un flujo de trabajo Notion -> GitHub -> PR, con planning asistido por LLM, ejecucion en worktree y cierre automatico. Este repo contiene el webhook server, la logica del bot, y un cron para sincronizar Notion.

## Contexto rapido

- Multi-proyecto (4 proyectos configurables).
- Persistencia de tareas en Supabase (reintento al reiniciar).
- Secrets cifrados en BD con clave maestra en ENV.
- Planning y desarrollo con OpenCode (modelos por complejidad).

## Flujo end-to-end

1) Notion: el cliente mueve una card a "READY".
2) Cron: crea Issue en GitHub con label `from-notion`.
3) Webhook: dispara planning y el bot comenta el plan con complejidad.
4) Humano ajusta; el bot replanifica hasta acordar.
5) Label `ready-for-development` -> build en worktree.
6) Bot crea PR y deja label `pr-generated`.
7) Merge -> actualiza Notion a DONE y limpia worktree/sesion.

## Componentes

- `src/server.js`: entrypoint, webhooks GitHub, cola FIFO, API admin.
- `main.js`: runPlanFlow y runBuildFlow.
- `services/aiService.js`: integra OpenCode, modelos y fallbacks.
- `services/taskQueue.js`: persistencia y rehidratacion en Supabase.
- `scripts/auto_expand_multi_projects.js`: cron Notion -> GitHub.

## Instalacion

1) Dependencias

```bash
npm install
```

2) Configurar variables de entorno

Usa `config/projects.example.env` como base.

3) Crear tablas en Supabase

```sql
db/schema.sql
```

4) Levantar con PM2

```bash
pm2 reload ecosystem.config.js
```

## Archivos clave

- `config/projects.js`
- `config/projects.example.env`
- `db/schema.sql`
- `src/server.js`
- `main.js`

## Documentacion extendida

Ver `docs/LOGICA_NEGOCIO.md`.
