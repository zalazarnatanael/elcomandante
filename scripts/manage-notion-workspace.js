#!/usr/bin/env node

/**
 * Manage Notion Workspaces
 * 
 * Usage:
 *   node scripts/manage-notion-workspace.js add --workspace-id ws-1 --name "Workspace 1" --api-key "ntn_xxxxx"
 *   node scripts/manage-notion-workspace.js link-project --project-id v0-ferreteria --workspace-id ws-1 --is-primary
 *   node scripts/manage-notion-workspace.js list
 *   node scripts/manage-notion-workspace.js validate --workspace-id ws-1
 *   node scripts/manage-notion-workspace.js get-project --project-id v0-ferreteria
 */

require('dotenv').config();
const notionCredentialsManager = require('../services/notionCredentialsManager');
const logger = require('../logger');

const command = process.argv[2];

async function main() {
  try {
    await notionCredentialsManager.initRedis();

    switch (command) {
      case 'add':
        await handleAdd();
        break;
      
      case 'link-project':
        await handleLinkProject();
        break;
      
      case 'unlink-project':
        await handleUnlinkProject();
        break;
      
      case 'list':
        await handleList();
        break;
      
      case 'validate':
        await handleValidate();
        break;
      
      case 'get-project':
        await handleGetProject();
        break;
      
      case 'help':
      default:
        showHelp();
    }
  } catch (error) {
    logger.error('Error:', error.message);
    process.exit(1);
  }
}

// ============================================================================
// COMMAND HANDLERS
// ============================================================================

async function handleAdd() {
  const workspaceId = getArg('--workspace-id');
  const name = getArg('--name');
  const apiKey = getArg('--api-key');
  const notes = getArg('--notes');

  if (!workspaceId || !name || !apiKey) {
    console.error('Missing required arguments: --workspace-id, --name, --api-key');
    process.exit(1);
  }

  try {
    const result = await notionCredentialsManager.addWorkspace(workspaceId, name, apiKey, notes);
    console.log('✓ Workspace added successfully:');
    console.log(`  ID: ${result.workspace_id}`);
    console.log(`  Name: ${result.workspace_name}`);
    console.log(`  Created: ${result.created_at}`);
  } catch (error) {
    console.error('✗ Failed to add workspace:', error.message);
    process.exit(1);
  }
}

async function handleLinkProject() {
  const projectId = getArg('--project-id');
  const workspaceId = getArg('--workspace-id');
  const databaseId = getArg('--database-id');
  const isPrimary = !!getArg('--is-primary');

  if (!projectId || !workspaceId) {
    console.error('Missing required arguments: --project-id, --workspace-id');
    process.exit(1);
  }

  try {
    const result = await notionCredentialsManager.linkProjectToWorkspace(
      projectId,
      workspaceId,
      databaseId,
      isPrimary
    );
    console.log('✓ Project linked to workspace:');
    console.log(`  Project: ${projectId}`);
    console.log(`  Workspace: ${workspaceId}`);
    console.log(`  Primary: ${isPrimary ? 'yes' : 'no'}`);
    console.log(`  Database ID: ${databaseId || 'not set'}`);
  } catch (error) {
    console.error('✗ Failed to link project:', error.message);
    process.exit(1);
  }
}

async function handleUnlinkProject() {
  const projectId = getArg('--project-id');
  const workspaceId = getArg('--workspace-id');

  if (!projectId || !workspaceId) {
    console.error('Missing required arguments: --project-id, --workspace-id');
    process.exit(1);
  }

  try {
    await notionCredentialsManager.unlinkProjectFromWorkspace(projectId, workspaceId);
    console.log('✓ Project unlinked from workspace:');
    console.log(`  Project: ${projectId}`);
    console.log(`  Workspace: ${workspaceId}`);
  } catch (error) {
    console.error('✗ Failed to unlink project:', error.message);
    process.exit(1);
  }
}

async function handleList() {
  try {
    const workspaces = await notionCredentialsManager.getAllWorkspaces();
    
    if (workspaces.length === 0) {
      console.log('No Notion workspaces found.');
      return;
    }

    console.log('\n📚 Notion Workspaces:\n');
    console.log('ID'.padEnd(15), 'Name'.padEnd(30), 'Active', 'Created');
    console.log('-'.repeat(80));
    
    for (const ws of workspaces) {
      const created = new Date(ws.created_at).toLocaleDateString();
      console.log(
        ws.workspace_id.padEnd(15),
        ws.workspace_name.padEnd(30),
        ws.is_active ? '✓' : '✗',
        created
      );
    }
  } catch (error) {
    console.error('✗ Failed to list workspaces:', error.message);
    process.exit(1);
  }
}

async function handleValidate() {
  const workspaceId = getArg('--workspace-id');

  if (!workspaceId) {
    console.error('Missing required argument: --workspace-id');
    process.exit(1);
  }

  try {
    const result = await notionCredentialsManager.validateWorkspaceCredentials(workspaceId);
    
    if (result.valid) {
      console.log(`✓ Workspace ${workspaceId} credentials are valid!`);
    } else {
      console.error(`✗ Workspace ${workspaceId} credentials invalid: ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('✗ Validation error:', error.message);
    process.exit(1);
  }
}

async function handleGetProject() {
  const projectId = getArg('--project-id');

  if (!projectId) {
    console.error('Missing required argument: --project-id');
    process.exit(1);
  }

  try {
    const workspaces = await notionCredentialsManager.getWorkspacesForProject(projectId);
    
    if (workspaces.length === 0) {
      console.log(`No workspaces linked to project ${projectId}`);
      return;
    }

    console.log(`\n📚 Workspaces for project: ${projectId}\n`);
    console.log('Workspace ID'.padEnd(15), 'Name'.padEnd(30), 'Primary', 'Database ID');
    console.log('-'.repeat(90));
    
    for (const ws of workspaces) {
      console.log(
        ws.workspace_id.padEnd(15),
        ws.workspace_name.padEnd(30),
        ws.is_primary ? '✓' : '✗',
        ws.database_id || '(not set)'
      );
    }
  } catch (error) {
    console.error('✗ Failed to get project workspaces:', error.message);
    process.exit(1);
  }
}

function showHelp() {
  console.log(`
📚 Notion Workspace Manager

Commands:
  add                 Add a new Notion workspace
  link-project        Link a project to a Notion workspace
  unlink-project      Remove project-workspace link
  list                List all Notion workspaces
  validate            Test credentials for a workspace
  get-project         Show workspaces linked to a project
  help                Show this help message

Examples:
  # Add a new workspace
  node scripts/manage-notion-workspace.js add \\
    --workspace-id ws-1 \\
    --name "Main Workspace" \\
    --api-key "ntn_xxxxx"

  # Link project to workspace as primary
  node scripts/manage-notion-workspace.js link-project \\
    --project-id v0-ferreteria \\
    --workspace-id ws-1 \\
    --database-id "db-id-1" \\
    --is-primary

  # Unlink project from workspace
  node scripts/manage-notion-workspace.js unlink-project \\
    --project-id v0-ferreteria \\
    --workspace-id ws-1

  # List all workspaces
  node scripts/manage-notion-workspace.js list

  # Validate credentials
  node scripts/manage-notion-workspace.js validate \\
    --workspace-id ws-1

  # Get workspaces for a project
  node scripts/manage-notion-workspace.js get-project \\
    --project-id v0-ferreteria
  `);
}

// ============================================================================
// UTILITIES
// ============================================================================

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  return index !== -1 ? process.argv[index + 1] : null;
}

// ============================================================================
// RUN
// ============================================================================

main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
