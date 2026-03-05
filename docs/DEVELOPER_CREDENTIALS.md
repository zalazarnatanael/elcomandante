# Developer Credentials (GitHub Assignees)

Este documento explica cómo configurar credenciales de GitHub por developer para que los commits, pushes y PRs aparezcan como realizados por el programador asignado al issue.

## Reglas

- Si el issue **no tiene assignee**, el bot **bloquea** la ejecución.
- Si el assignee **no tiene credenciales configuradas**, el bot **bloquea** la ejecución.
- Los commits usan `username@users.noreply.github.com` para evitar exponer emails reales.

## Setup rápido

1. Cada developer crea un Personal Access Token con permisos `repo`.
2. Guardar el token cifrado en Supabase:

```bash
node scripts/manage-developers.js add \
  --github-username dev1 \
  --token "ghp_xxxxx" \
  --name "Dev One"
```

3. Validar credenciales:

```bash
node scripts/manage-developers.js validate --github-username dev1
```

## Auth para endpoints

Las rutas no-webhook requieren `Authorization: Bearer <supabase_jwt>`.

## Ver todos los developers

```bash
node scripts/manage-developers.js list
```

## Notas de seguridad

- Los tokens se guardan cifrados con `ENCRYPTION_MASTER_KEY` (o `MASTER_KEY`).
- Nunca almacenar tokens en plaintext.
- Se recomienda rotar tokens periódicamente.

## DB Connection

Las operaciones de datos usan `DATABASE_URL` via `postgres`.

## Auth JWT

Las rutas protegidas validan el token con `SUPABASE_JWT_SECRET`.

## Troubleshooting

### Error: "Credentials not found"

```bash
node scripts/manage-developers.js list
```

### Error: "Token does not match username"

El token corresponde a otro usuario. Generar uno nuevo con el usuario correcto.

### Error: "Supabase not configured"

Verificar variables:

```bash
DATABASE_URL
SUPABASE_JWT_SECRET
```
