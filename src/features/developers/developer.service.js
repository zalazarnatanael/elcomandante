const developerRepository = require('./developer.repository');
const { encrypt } = require('../../../services/encryptionService');

async function listDevelopers() {
  return developerRepository.listDevelopers();
}

async function getDeveloper(username) {
  return developerRepository.getDeveloper(username);
}

async function upsertDeveloper(payload) {
  const record = {
    github_username: payload.github_username?.toLowerCase(),
    commit_name: payload.commit_name,
    commit_email: payload.commit_email || `${payload.github_username}@users.noreply.github.com`,
    is_active: payload.is_active !== undefined ? payload.is_active : true,
    notes: payload.notes || null,
    updated_at: new Date().toISOString()
  };
  if (payload.token) {
    record.api_token_encrypted = encrypt(String(payload.token));
  }
  return developerRepository.upsertDeveloper(record);
}

async function deleteDeveloper(username) {
  return developerRepository.deleteDeveloper(username);
}

module.exports = {
  listDevelopers,
  getDeveloper,
  upsertDeveloper,
  deleteDeveloper
};
