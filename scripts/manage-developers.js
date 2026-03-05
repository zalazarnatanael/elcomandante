#!/usr/bin/env node

/**
 * Manage Developer GitHub Credentials
 *
 * Usage:
 *   node scripts/manage-developers.js add --github-username dev1 --token "ghp_xxxxx" [--name "Dev One"]
 *   node scripts/manage-developers.js list
 *   node scripts/manage-developers.js validate --github-username dev1
 */

require('dotenv').config();
const developerCredentialsManager = require('../services/developerCredentialsManager');
const logger = require('../logger');

const command = process.argv[2];

async function main() {
  try {
    await developerCredentialsManager.initRedis();

    switch (command) {
      case 'add':
        await handleAdd();
        break;
      case 'list':
        await handleList();
        break;
      case 'validate':
        await handleValidate();
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

async function handleAdd() {
  const githubUsername = getArg('--github-username');
  const token = getArg('--token');
  const name = getArg('--name');
  const email = getArg('--email');
  const notes = getArg('--notes');

  if (!githubUsername || !token) {
    console.error('Missing required arguments: --github-username, --token');
    process.exit(1);
  }

  const result = await developerCredentialsManager.addDeveloper({
    githubUsername,
    token,
    commitName: name,
    commitEmail: email,
    notes
  });

  console.log('✓ Developer credentials saved:');
  console.log(`  Username: ${result.github_username}`);
  console.log(`  Name: ${result.commit_name}`);
  console.log(`  Email: ${result.commit_email}`);
}

async function handleList() {
  const developers = await developerCredentialsManager.listDevelopers();
  if (!developers.length) {
    console.log('No developers configured.');
    return;
  }

  console.log('\n👩‍💻 Developers:\n');
  console.log('Username'.padEnd(20), 'Name'.padEnd(25), 'Email'.padEnd(35), 'Active');
  console.log('-'.repeat(90));
  for (const dev of developers) {
    console.log(
      dev.github_username.padEnd(20),
      (dev.commit_name || '').padEnd(25),
      (dev.commit_email || '').padEnd(35),
      dev.is_active ? '✓' : '✗'
    );
  }
}

async function handleValidate() {
  const githubUsername = getArg('--github-username');
  if (!githubUsername) {
    console.error('Missing required argument: --github-username');
    process.exit(1);
  }

  const result = await developerCredentialsManager.validateDeveloper(githubUsername);
  if (result.valid) {
    console.log(`✓ Token valid for ${result.username}`);
  } else {
    console.error(`✗ Invalid token for ${result.username}: ${result.error}`);
    process.exit(1);
  }
}

function showHelp() {
  console.log(`
👩‍💻 Developer Credentials Manager

Commands:
  add         Add or update developer credentials
  list        List all developers
  validate    Validate a developer token
  help        Show this help message

Examples:
  node scripts/manage-developers.js add \
    --github-username dev1 \
    --token "ghp_xxxxx" \
    --name "Dev One"

  node scripts/manage-developers.js list

  node scripts/manage-developers.js validate \
    --github-username dev1
  `);
}

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  return index !== -1 ? process.argv[index + 1] : null;
}

main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
