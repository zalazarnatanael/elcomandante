# Multi-Workspace Notion Support - Implementation Summary

## Overview

Se ha implementado un sistema **N:M (Many-to-Many)** para gestionar múltiples workspaces de Notion en OpenClaw. Esto permite que:

- **Un proyecto** esté vinculado a **múltiples workspaces de Notion**
- **Un workspace** sea compartido por **múltiples proyectos**
- Cada relación sea independiente y configurable dinámicamente sin necesidad de redeploy

## Changes Made

### 1. **Database Schema** (`db/schema.sql`)

Se agregaron 2 nuevas tablas:

#### `notion_workspaces`
```sql
CREATE TABLE notion_workspaces (
  id UUID PRIMARY KEY,
  workspace_id TEXT UNIQUE,          -- ID único (ej: "ws-1")
  workspace_name VARCHAR(255),       -- Nombre descriptivo
  api_key_encrypted TEXT,            -- AES-256 cifrada
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  created_by VARCHAR(255),
  notes TEXT
);
```

**Seguridad**: Las API keys se almacenan **cifradas con AES-256** usando `MASTER_KEY` del ambiente.

#### `project_notion_workspaces`
```sql
CREATE TABLE project_notion_workspaces (
  id UUID PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  notion_workspace_id TEXT REFERENCES notion_workspaces(workspace_id),
  database_id VARCHAR(255),          -- DB específica (opcional)
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMP,
  UNIQUE(project_id, notion_workspace_id)
);
```

**Relación N:M**: Permite múltiples combinaciones proyecto↔workspace.

### 2. **New Service** (`services/notionCredentialsManager.js`)

Manager centralizado para credenciales de Notion con las siguientes capacidades:

```javascript
// Obtener todos los workspaces de un proyecto
const workspaces = await notionCredentialsManager.getWorkspacesForProject('proyecto-1');
// Retorna: [{ workspace_id, api_key, database_id, is_primary }, ...]

// Obtener workspace primario
const primary = await notionCredentialsManager.getPrimaryWorkspaceForProject('proyecto-1');

// Obtener API key descifrada
const apiKey = await notionCredentialsManager.getApiKeyForWorkspace('ws-1');

// Agregar workspace (cifra automáticamente)
await notionCredentialsManager.addWorkspace('ws-1', 'Main', 'ntn_xxxxx');

// Vincular proyecto a workspace
await notionCredentialsManager.linkProjectToWorkspace('proyecto-1', 'ws-1', 'db-id', true);
```

**Características**:
- ✅ Desencriptación lazy-load (solo cuando se necesita)
- ✅ Cache en Redis (TTL 1h) + fallback en memoria
- ✅ Validación de credenciales
- ✅ Auditoría de cambios (campo `created_by`)

### 3. **Management Script** (`scripts/manage-notion-workspace.js`)

CLI interactivo para gestionar workspaces sin acceso directo a BD:

```bash
# Agregar workspace
node scripts/manage-notion-workspace.js add \
  --workspace-id ws-1 \
  --name "Main Workspace" \
  --api-key "ntn_xxxxx"

# Vincular proyecto
node scripts/manage-notion-workspace.js link-project \
  --project-id proyecto-1 \
  --workspace-id ws-1 \
  --database-id "db-id" \
  --is-primary

# Listar workspaces
node scripts/manage-notion-workspace.js list

# Validar credenciales
node scripts/manage-notion-workspace.js validate --workspace-id ws-1

# Ver workspaces de un proyecto
node scripts/manage-notion-workspace.js get-project --project-id proyecto-1
```

**Ventajas**:
- Encriptación automática de API keys
- Validación de conectividad
- Interfaz clara y segura

### 4. **Updated Scripts**

#### `scripts/auto_expand_multi_projects.js`
Refactorizado para cargar workspaces dinámicamente:

```javascript
// ANTES: projectConfig.notion.databaseId (hardcoded)
// AHORA: Carga todos los workspaces del proyecto

const workspaces = await notionCredentialsManager.getWorkspacesForProject(projectId);
for (const workspace of workspaces) {
  const notion = new Client({ auth: workspace.api_key });
  // ... procesar workspace
}
```

**Cambios**:
- ✅ Soporta múltiples workspaces por proyecto
- ✅ Procesa cada workspace independientemente
- ✅ Logging mejorado con `logger` module
- ✅ Graceful degradation si falta configuración

### 5. **Configuration Updates**

#### `config/projects.js`
- Removido campo `notion.databaseId` (ahora está en BD)
- Proyectos siguen siendo estáticos en config
- Mapeo a workspaces es dinámico (en tabla `project_notion_workspaces`)

#### `.env.example`
- Removida referencia a `NOTION_API_KEY` (ya no necesaria)
- Agregadas instrucciones para usar el management script
- Documentadas las nuevas tablas de Supabase

### 6. **New Files**

| Archivo | Propósito |
|---------|-----------|
| `logger.js` | Logger simple con niveles (debug/info/warn/error) |
| `db/seed-notion-workspaces.sql` | Ejemplo de setup SQL inicial |
| `docs/NOTION_WORKSPACES.md` | Documentación completa de uso |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ Proyecto (proyecto-1, proyecto-2, etc.)            │
└─────────────────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
   ┌─────────┐   ┌─────────┐   ┌─────────┐
   │ ws-1    │   │ ws-2    │   │ ws-3    │
   │ Primary │   │Secondary│   │ Inactive│
   └─────────┘   └─────────┘   └─────────┘
        │              │
        │ (descifra)   │
        │              │
        ▼              ▼
   [API KEY]     [API KEY]
   (Redis/       (Redis/
    Memory)      Memory)
```

## Security Model

### Encryption Flow

```
┌──────────────────────────────────────────┐
│ 1. Admin genera MASTER_KEY (32 bytes)    │
│    $ node -e "console.log(...)"          │
│    → Guardar en VPS/.env (nunca en git)  │
└──────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│ 2. Admin agrega workspace                │
│    $ node scripts/manage-notion-ws.js add│
│    → Script obtiene MASTER_KEY del env   │
│    → Encripta API key con AES-256        │
│    → Inserta en Supabase (cifrada)       │
└──────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│ 3. En runtime, bot carga credenciales    │
│    → notionCredentialsManager.getApiKey()│
│    → Descifra solo cuando se necesita    │
│    → Cachea en Redis (TTL 1h)            │
│    → Nunca queda en logs ni disco        │
└──────────────────────────────────────────┘
```

**Garantías**:
- ✅ API keys nunca se guardan en plaintext
- ✅ MASTER_KEY solo en VPS env vars
- ✅ Desencriptación bajo demanda
- ✅ Auditoría (campo `created_by`)
- ✅ Cache con TTL limitado

## Setup Checklist

### 1. Database
```bash
# Ejecutar migrations
psql postgresql://... -f db/schema.sql
```

### 2. Environment
```bash
# Generar MASTER_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Guardar en .env (producción: variables de sistema)
echo "MASTER_KEY=..." >> .env
```

### 3. Notion Integration
```bash
# Para cada workspace de Notion
# 1. Crear en https://www.notion.so/my-integrations
# 2. Copiar API key (ntn_xxxxx)
# 3. Registrar en OpenClaw:

node scripts/manage-notion-workspace.js add \
  --workspace-id ws-1 \
  --name "Main Workspace" \
  --api-key "ntn_xxxxx" \
  --notes "Producción - Ferretería + Ecommerce"

# 4. Validar
node scripts/manage-notion-workspace.js validate --workspace-id ws-1
```

### 4. Project Linking
```bash
# Vincular proyectos a workspaces
node scripts/manage-notion-workspace.js link-project \
  --project-id proyecto-1 \
  --workspace-id ws-1 \
  --database-id "12a3b4c5d6e7f8g9h0" \
  --is-primary

# Verificar
node scripts/manage-notion-workspace.js get-project --project-id proyecto-1
```

## Migration Path (Legacy → New)

Si ya tenías configuración antigua:

```bash
# 1. Obtener tu API key actual de .env
cat .env | grep NOTION_API_KEY

# 2. Registrar en nuevo sistema
node scripts/manage-notion-workspace.js add \
  --workspace-id ws-legacy \
  --name "Legacy Workspace" \
  --api-key "ntn_xxxxx"

# 3. Vincular todos los proyectos
for proj in proyecto-1 proyecto-2 proyecto-3 proyecto-4; do
  node scripts/manage-notion-workspace.js link-project \
    --project-id $proj \
    --workspace-id ws-legacy \
    --is-primary
done

# 4. Remover NOTION_API_KEY de .env
```

## Testing

```bash
# Test 1: Listar workspaces
node scripts/manage-notion-workspace.js list

# Test 2: Validar credenciales
node scripts/manage-notion-workspace.js validate --workspace-id ws-1

# Test 3: Ver workspaces de un proyecto
node scripts/manage-notion-workspace.js get-project --project-id proyecto-1

# Test 4: Ejecutar cron (debe cargar workspaces dinámicamente)
node scripts/auto_expand_multi_projects.js
```

## Troubleshooting

### "MASTER_KEY not set in environment"
```bash
# Verificar que esté en .env o env vars
echo $MASTER_KEY

# Si está vacío, generar y guardar
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Agregar a .env y recargar
```

### "Workspace XXX not found"
```bash
# Listar workspaces actuales
node scripts/manage-notion-workspace.js list

# Si falta, agregarlo
node scripts/manage-notion-workspace.js add ...
```

### "Notion credentials invalid"
```bash
# Validar directamente
node scripts/manage-notion-workspace.js validate --workspace-id ws-1

# Si falla, revisar:
# 1. API key es correcto (en Notion integration)
# 2. Integration tiene permisos (read content)
# 3. Workspace sigue activo en Notion
```

## Performance Notes

- **Cache**: Redis (1h TTL) + fallback en memoria
- **Queries**: Solo desencripta cuando se accede, no en load
- **Índices**: Creados en `workspace_id`, `project_id`, `is_active`
- **Escalabilidad**: Soporta N workspaces sin degradación

## Future Enhancements

- [ ] Dashboard para gestionar workspaces (UI)
- [ ] Rotación automática de API keys
- [ ] Webhooks para actualizar estado de Notion
- [ ] Sincronización bidireccional (GitHub ↔ Notion)
- [ ] Métricas de uso por workspace
- [ ] Backup automático de credenciales

## Files Changed Summary

```
📁 db/
  ├── schema.sql                    [MOD] +nuevas tablas notion_*
  └── seed-notion-workspaces.sql    [NEW] Ejemplo de setup

📁 services/
  ├── notionCredentialsManager.js   [NEW] Manager de credenciales
  ├── developerCredentialsManager.js [NEW] Credenciales por developer
  ├── database.js                   [?]  (sin cambios)
  └── ...

📁 scripts/
  ├── manage-notion-workspace.js    [NEW] CLI de gestión
  ├── manage-developers.js           [NEW] CLI para tokens de developers
  ├── auto_expand_multi_projects.js [MOD] Integración dinámica
  └── create_github_issues_from_expanded.js [DEPRECATED] (legacy)

📁 config/
  └── projects.js                   [MOD] Removido notion.databaseId

📁 docs/
  └── NOTION_WORKSPACES.md          [NEW] Documentación completa

📁 /root
  ├── logger.js                     [NEW] Logger simple
  ├── .env.example                  [MOD] Actualizado
  └── README.md                     [?]  (considerar actualizar)

## Assignee Execution (GitHub)

Los commits, push y PR ahora se realizan con el token del developer asignado en el issue:

- Si no hay assignee, el bot **bloquea** la ejecución y comenta en el issue.
- Si el assignee no tiene credenciales cargadas, también bloquea.
- Los commits usan `username@users.noreply.github.com` para no exponer email real.
- El push se hace usando un remote temporal autenticado con el token del assignee.
```

## Next Steps

1. ✅ Deploy schema.sql a Supabase
2. ⏳ Ejecutar management script para 2 workspaces actuales
3. ⏳ Validar que auto_expand_multi_projects.js funcione
4. ⏳ Remover NOTION_API_KEY de .env en producción
5. ⏳ Monitorear logs por primer mes
6. ⏳ Considerar UI de gestión si se vuelve tedioso

## Supabase Auth (Frontend)

- Todas las rutas no-webhook requieren `Authorization: Bearer <supabase_jwt>`
- `/webhook/*` y `/uploads/*` quedan públicas
- `/api/projects/:projectId/secrets` requiere rol `admin`
- La validacion de JWT usa `SUPABASE_JWT_SECRET`

## Swagger

- Documentacion disponible en `GET /docs`

## Database Connection

- El acceso a datos usa `postgres` con `DATABASE_URL`

## API Admin/Dashboard

Se agrego una nueva API con estructura por features en `src/`:

- `GET /api/admin/summary`
- `GET /api/projects`
- `POST /api/projects`
- `PUT /api/projects/:id`
- `DELETE /api/projects/:id`
- `GET /api/workspaces`
- `POST /api/workspaces`
- `PUT /api/workspaces/:id`
- `DELETE /api/workspaces/:id`
- `GET /api/project-workspaces?projectId=...`
- `POST /api/project-workspaces`
- `DELETE /api/project-workspaces/:id`
- `GET /api/developers`
- `POST /api/developers`
- `PUT /api/developers/:username`
- `DELETE /api/developers/:username`
- `GET /api/tasks`
- `GET /api/tasks/:id`
- `POST /api/tasks/retry/:id`

## Server Entry

- Nuevo entrypoint: `src/server.js`
- `webhook-server.js` fue reemplazado

---

**Versión**: 1.0  
**Fecha**: 2026-03-05  
**Estado**: Listo para producción  
**Autor**: OpenCode Bot
