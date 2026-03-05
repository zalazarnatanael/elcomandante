-- ============================================================================
-- NOTION WORKSPACES - EXAMPLE SEEDING
-- ============================================================================
-- 
-- This file contains SQL examples for seeding Notion workspaces and their
-- project links into Supabase.
--
-- IMPORTANT: API keys are stored ENCRYPTED in the database.
-- Use the management script to add/update credentials:
--
--   node scripts/manage-notion-workspace.js add \
--     --workspace-id ws-1 \
--     --name "Main Workspace" \
--     --api-key "ntn_xxxxx"
--
-- ============================================================================

-- ============================================================================
-- STEP 1: Insert Notion Workspaces (API keys are encrypted by the script)
-- ============================================================================
-- These are example entries. In production, use the management script above.

-- ============================================================================
-- STEP 0: Create mock projects (required for foreign keys)
-- ============================================================================
-- These are minimal entries to satisfy project_notion_workspaces FK constraints.

INSERT INTO projects (
  id,
  name,
  github_owner,
  github_repo,
  notion_database_id,
  is_active
) VALUES
  ('proyecto-1', 'Ferreteria', 'acme', 'ferreteria', 'db-ferreteria-1', true),
  ('proyecto-2', 'Ecommerce', 'acme', 'ecommerce', 'db-ecommerce-1', true),
  ('proyecto-3', 'Marketplace', 'acme', 'marketplace', 'db-marketplace-1', true),
  ('proyecto-4', 'Proyecto 4', 'acme', 'proyecto-4', 'db-proyecto4-1', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO notion_workspaces (
  workspace_id,
  workspace_name,
  api_key_encrypted,
  is_active,
  notes
) VALUES
  -- Workspace 1: Shared by ferretería and ecommerce projects
  ('ws-1', 'Main Workspace', '[ENCRYPTED_KEY_1]', true, 'Prod - Ferretería + Ecommerce'),
  -- Workspace 2: Marketplace only
  ('ws-2', 'Marketplace Workspace', '[ENCRYPTED_KEY_2]', true, 'Prod - Marketplace')
ON CONFLICT (workspace_id) DO NOTHING;

-- ============================================================================
-- STEP 2: Link Projects to Notion Workspaces (N:M Mapping)
-- ============================================================================
-- This establishes which projects have access to which Notion workspaces.
-- Multiple projects can share a workspace, and one project can access multiple workspaces.

INSERT INTO project_notion_workspaces (
  project_id,
  notion_workspace_id,
  database_id,
  is_primary
) VALUES
  -- Ferretería project → ws-1 (primary)
  ('proyecto-1', 'ws-1', 'db-ferreteria-1', true),
  
  -- Ecommerce project → ws-1 (primary)
  ('proyecto-2', 'ws-1', 'db-ecommerce-1', true),
  
  -- Marketplace project → ws-2 (primary)
  ('proyecto-3', 'ws-2', 'db-marketplace-1', true),
  
  -- Marketplace project → ws-1 (secondary, for shared data)
  ('proyecto-3', 'ws-1', 'db-marketplace-shared-1', false),
  
  -- Proyecto 4 → ws-2 (primary)
  ('proyecto-4', 'ws-2', 'db-proyecto4-1', true)
ON CONFLICT (project_id, notion_workspace_id) DO NOTHING;

-- ============================================================================
-- STEP 3: VERIFY SETUP
-- ============================================================================

-- View all Notion workspaces
SELECT 
  workspace_id,
  workspace_name,
  is_active,
  created_at
FROM notion_workspaces
ORDER BY workspace_name;

-- View all project-workspace links
SELECT 
  pnw.project_id,
  pnw.notion_workspace_id,
  pnw.database_id,
  pnw.is_primary,
  nw.workspace_name
FROM project_notion_workspaces pnw
JOIN notion_workspaces nw ON pnw.notion_workspace_id = nw.workspace_id
ORDER BY pnw.project_id, pnw.is_primary DESC;

-- View workspaces for a specific project (e.g., proyecto-3)
SELECT 
  pnw.notion_workspace_id,
  nw.workspace_name,
  pnw.database_id,
  pnw.is_primary
FROM project_notion_workspaces pnw
JOIN notion_workspaces nw ON pnw.notion_workspace_id = nw.workspace_id
WHERE pnw.project_id = 'proyecto-3'
ORDER BY pnw.is_primary DESC;

-- ============================================================================
-- CLEANUP (if needed)
-- ============================================================================

-- Remove a project-workspace link
-- DELETE FROM project_notion_workspaces
-- WHERE project_id = 'proyecto-1' AND notion_workspace_id = 'ws-1';

-- Deactivate a workspace (soft delete)
-- UPDATE notion_workspaces SET is_active = false WHERE workspace_id = 'ws-1';

-- Remove a workspace entirely (cascades to project links)
-- DELETE FROM notion_workspaces WHERE workspace_id = 'ws-1';

-- ============================================================================
-- DEVELOPER CREDENTIALS - EXAMPLE SEEDING
-- ============================================================================
-- IMPORTANT: Use the management script to add/update credentials:
--
--   node scripts/manage-developers.js add \
--     --github-username username \
--     --token "ghp_xxxxx"
--
-- ============================================================================

INSERT INTO developer_credentials (
  github_username,
  api_token_encrypted,
  commit_name,
  commit_email,
  is_active,
  notes
) VALUES
  ('dev-1', '[ENCRYPTED_TOKEN_1]', 'Dev One', 'dev-1@users.noreply.github.com', true, 'Primary developer'),
  ('dev-2', '[ENCRYPTED_TOKEN_2]', 'Dev Two', 'dev-2@users.noreply.github.com', true, 'Backup developer')
ON CONFLICT (github_username) DO NOTHING;
