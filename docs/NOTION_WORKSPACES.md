# Multi-Workspace Notion Configuration

Este documento explica cómo gestionar múltiples workspaces de Notion en OpenClaw.

## Overview

OpenClaw soporta una arquitectura **N:M** entre proyectos y workspaces de Notion:

- **Un proyecto** puede estar vinculado a **múltiples workspaces**
- **Un workspace** puede ser compartido por **múltiples proyectos**
- Cada vínculo puede designarse como **primario** o **secundario**

Ejemplo:
```
Proyecto 1 (Ferretería)  ─┐
                          ├──→ Workspace 1 (Main)
Proyecto 2 (Ecommerce)   ─┘

Proyecto 3 (Marketplace) ─┬──→ Workspace 1 (Main) - secundario
                          └──→ Workspace 2 (Marketplace) - primario
```

## Architecture

### Base de Datos

Tres tablas principales:

1. **`projects`** - Proyectos de GitHub/OpenClaw
2. **`notion_workspaces`** - Workspaces de Notion (credenciales cifradas)
3. **`project_notion_workspaces`** - Relación N:M

```sql
notion_workspaces
├── workspace_id (PK, unique)
├── workspace_name
├── api_key_encrypted  ← AES-256, descifrado con MASTER_KEY
├── is_active
└── ...

project_notion_workspaces
├── project_id (FK)
├── notion_workspace_id (FK)
├── database_id (optional)
├── is_primary
└── (project_id, notion_workspace_id) = unique
```

### Seguridad

- **API keys cifradas**: Almacenadas con AES-256-GCM en Supabase
- **Desencriptación local**: Solo ocurre en el servidor, usando `MASTER_KEY` (variable de entorno)
- **Cache**: Redis (TTL 1h) para evitar desencriptaciones repetidas
- **Auditoría**: Campo `created_by` en tabla `notion_workspaces`

## Setup Inicial

### 1. Generar MASTER_KEY

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Output: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6...
```

Agregar a `.env`:
```env
MASTER_KEY=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6...
```

### 2. Crear Notion Integrations

Por cada workspace de Notion que quieras usar:

1. Ir a https://www.notion.so/my-integrations
2. Crear una nueva integration
3. Copiar el API key (formato: `ntn_xxxxx`)

### 3. Registrar Workspaces en OpenClaw

Usar el script de gestión:

```bash
# Agregar workspace
node scripts/manage-notion-workspace.js add \
  --workspace-id ws-1 \
  --name "Main Workspace" \
  --api-key "ntn_xxxxx" \
  --notes "Prod - Ferretería + Ecommerce"

# Validar que funciona
node scripts/manage-notion-workspace.js validate --workspace-id ws-1
```

### 4. Vincular Proyectos a Workspaces

```bash
# Vincular proyecto a workspace (primario)
node scripts/manage-notion-workspace.js link-project \
  --project-id proyecto-1 \
  --workspace-id ws-1 \
  --database-id "db-ferreteria-1" \
  --is-primary

# Vincular segundo workspace al mismo proyecto (secundario)
node scripts/manage-notion-workspace.js link-project \
  --project-id proyecto-1 \
  --workspace-id ws-2 \
  --database-id "db-ferreteria-shared-1"

# Sin --is-primary, es automáticamente secundario
```

### 5. Verificar Configuración

```bash
# Listar todos los workspaces
node scripts/manage-notion-workspace.js list

# Ver workspaces de un proyecto
node scripts/manage-notion-workspace.js get-project --project-id proyecto-1
```

## Uso en el Código

### En `main.js` o servicios

```javascript
const notionCredentialsManager = require('./services/notionCredentialsManager');

// Obtener todos los workspaces de un proyecto
const workspaces = await notionCredentialsManager.getWorkspacesForProject('proyecto-1');
// Retorna: [{ workspace_id, api_key, database_id, is_primary }, ...]

// Obtener workspace primario
const primary = await notionCredentialsManager.getPrimaryWorkspaceForProject('proyecto-1');
// Retorna: { workspace_id, api_key, database_id, is_primary: true }

// Para cada workspace, crear cliente Notion
const { Client } = require('@notionhq/client');
for (const ws of workspaces) {
  const notionClient = new Client({ auth: ws.api_key });
  const db = await notionClient.databases.retrieve(ws.database_id);
  // ...
}
```

## Management Script

### Disponible Comandos

```bash
# Agregar workspace
node scripts/manage-notion-workspace.js add \
  --workspace-id <id> \
  --name <nombre> \
  --api-key <ntn_xxxxx> \
  [--notes <notas>]

# Vincular proyecto a workspace
node scripts/manage-notion-workspace.js link-project \
  --project-id <proyecto-id> \
  --workspace-id <workspace-id> \
  [--database-id <db-id>] \
  [--is-primary]

# Desvincular proyecto de workspace
node scripts/manage-notion-workspace.js unlink-project \
  --project-id <proyecto-id> \
  --workspace-id <workspace-id>

# Listar workspaces
node scripts/manage-notion-workspace.js list

# Validar credenciales
node scripts/manage-notion-workspace.js validate \
  --workspace-id <workspace-id>

# Ver workspaces de un proyecto
node scripts/manage-notion-workspace.js get-project \
  --project-id <proyecto-id>

# Ayuda
node scripts/manage-notion-workspace.js help
```

## Troubleshooting

### Error: "Workspace XXX not found"

El workspace no está registrado. Verificar:
```bash
node scripts/manage-notion-workspace.js list
```

Agregarlo si falta:
```bash
node scripts/manage-notion-workspace.js add --workspace-id ws-1 --name "..." --api-key "..."
```

### Error: "MASTER_KEY not set in environment"

`MASTER_KEY` no está en `.env` o variables de sistema. Generar y agregar:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Copiar output a .env: MASTER_KEY=...
```

### Error: "Notion credentials invalid"

Las credenciales no funcionan. Verificar:
1. API key es correcto (copiar de https://www.notion.so/my-integrations)
2. Integration tiene permisos (al menos `read content`)
3. Validar directamente:
   ```bash
   node scripts/manage-notion-workspace.js validate --workspace-id ws-1
   ```

### Workspace está inactivo

Si un workspace está marcado `is_active = false`:
```bash
# Reactivar
UPDATE notion_workspaces SET is_active = true WHERE workspace_id = 'ws-1';
```

## Auth para endpoints

Las rutas no-webhook requieren `Authorization: Bearer <supabase_jwt>`.

## Migración desde versión anterior

Si anteriormente usabas `NOTION_API_KEY` hardcodeado:

1. Copiar tu API key de Notion
2. Ejecutar:
   ```bash
   node scripts/manage-notion-workspace.js add \
     --workspace-id ws-legacy \
     --name "Legacy Workspace" \
     --api-key "ntn_xxxxx"
   ```
3. Vincular proyectos:
   ```bash
   for project in proyecto-1 proyecto-2 proyecto-3 proyecto-4; do
     node scripts/manage-notion-workspace.js link-project \
       --project-id $project \
       --workspace-id ws-legacy \
       --is-primary
   done
   ```
4. Remover `NOTION_API_KEY` de `.env`

## Best Practices

1. **Usar workspace IDs descriptivos**: `ws-main`, `ws-marketplace`, etc.
2. **Designar un workspace primario**: Facilita lógica de sincronización
3. **Validar después de agregar**: `--validate` siempre
4. **Rotar API keys regularmente**: Crear nueva integration, reemplazar en Supabase
5. **Documentar el mapeo**: Guardar en `LOGICA_NEGOCIO.md` qué proyecto usa cuál workspace

## Seguridad en Producción

- `MASTER_KEY` en variable de entorno (nunca en `.env`)
- Restringir acceso a tabla `notion_workspaces` (usar RLS policies)
- Auditar cambios con logs del script
- Rotar `MASTER_KEY` anualmente
- Monitorear accesos a Supabase

## DB Connection

Las operaciones de datos usan `DATABASE_URL` via `postgres`.

## Auth JWT

Las rutas protegidas validan el token con `SUPABASE_JWT_SECRET`.

## Referencias

- **Notion API**: https://developers.notion.com
- **Supabase**: https://app.supabase.com
- **Encryption Service**: `services/encryptionService.js`
- **Credentials Manager**: `services/notionCredentialsManager.js`
- **Schema**: `db/schema.sql`
- **Seed Example**: `db/seed-notion-workspaces.sql`

---

# Developer Credentials (GitHub Assignee)

OpenClaw puede crear commits/PRs con la cuenta del developer asignado en el issue.

## Configuracion

1. Cada developer crea un Personal Access Token con permisos `repo`.
2. Registrar el token (cifrado) en Supabase usando el script:

```bash
node scripts/manage-developers.js add \
  --github-username dev1 \
  --token "ghp_xxxxx" \
  --name "Dev One"
```

## Reglas

- Si el issue no tiene assignee, el bot **bloquea** el build.
- Si el assignee no tiene credenciales, el bot **bloquea** el build.
- Los commits usan email `username@users.noreply.github.com`.
- El PR se crea usando el token del assignee.

## Validar tokens

```bash
node scripts/manage-developers.js validate --github-username dev1
```
