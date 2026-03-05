/**
 * DeveloperCredentialsManager
 * Gestiona credenciales de GitHub por developer (assignee)
 * - Carga desde tabla developer_credentials (cifradas en BD)
 * - Descifra con ENCRYPTION_MASTER_KEY (fallback MASTER_KEY)
 * - Cachea en Redis (TTL 1h)
 */

const sql = require('../src/shared/config/db');
const { encrypt, decrypt } = require('./encryptionService');
const redis = require('redis');
const logger = require('../logger');

let redisClient = null;

const CACHE_TTL = 3600;
const CACHE_PREFIX = 'developer:github:';

class DeveloperCredentialsManager {
  constructor() {
    this.cache = new Map();
  }

  async initRedis() {
    try {
      if (process.env.REDIS_URL) {
        redisClient = redis.createClient({ url: process.env.REDIS_URL });
        redisClient.on('error', (err) => logger.error('Redis error:', err));
        await redisClient.connect();
        logger.info('Redis connected for developer credentials cache');
      }
    } catch (error) {
      logger.warn('Redis not available, using in-memory cache:', error.message);
    }
  }

  async getCredentialsByGithubUsername(username) {
    if (!username) return null;
    const normalized = username.trim().toLowerCase();

    const cached = await this._getFromCache(normalized);
    if (cached) return cached;

    const sql = getDb();
    const rows = await sql`
      SELECT github_username, api_token_encrypted, commit_name, commit_email, is_active
      FROM developer_credentials
      WHERE github_username = ${normalized}
        AND is_active = true
      LIMIT 1
    `;

    if (!rows || rows.length === 0) {
      logger.warn(`Developer credentials not found for ${normalized}`);
      return null;
    }

    const token = decrypt(rows[0].api_token_encrypted);
    const credentials = {
      github_username: rows[0].github_username,
      token,
      commit_name: rows[0].commit_name || rows[0].github_username,
      commit_email: rows[0].commit_email || `${rows[0].github_username}@users.noreply.github.com`
    };

    await this._setInCache(normalized, credentials);
    return credentials;
  }

  async addDeveloper({ githubUsername, token, commitName, commitEmail, notes }) {
    if (!githubUsername || !token) {
      throw new Error('githubUsername and token are required');
    }
    const normalized = githubUsername.trim().toLowerCase();
    const encryptedToken = encrypt(token);
    const email = commitEmail || `${normalized}@users.noreply.github.com`;

    const sql = getDb();
    const rows = await sql`
      INSERT INTO developer_credentials (github_username, api_token_encrypted, commit_name, commit_email, created_by, notes, updated_at)
      VALUES (${normalized}, ${encryptedToken}, ${commitName || normalized}, ${email}, ${process.env.USER || 'system'}, ${notes || null}, ${new Date().toISOString()})
      ON CONFLICT (github_username)
      DO UPDATE SET
        api_token_encrypted = EXCLUDED.api_token_encrypted,
        commit_name = EXCLUDED.commit_name,
        commit_email = EXCLUDED.commit_email,
        notes = EXCLUDED.notes,
        updated_at = EXCLUDED.updated_at
      RETURNING *
    `;

    await this._clearCache(normalized);
    logger.info(`Developer credentials upserted for ${normalized}`);
    return rows[0] || null;
  }

  async listDevelopers() {
    const rows = await sql`
      SELECT github_username, commit_name, commit_email, is_active, created_at
      FROM developer_credentials
      ORDER BY github_username ASC
    `;
    return rows || [];
  }

  async validateDeveloper(username) {
    const creds = await this.getCredentialsByGithubUsername(username);
    if (!creds) return { valid: false, username, error: 'Credentials not found' };

    try {
      const { Octokit } = require('@octokit/rest');
      const octokit = new Octokit({ auth: creds.token });
      const { data } = await octokit.rest.users.getAuthenticated();
      const ok = data && data.login && data.login.toLowerCase() === creds.github_username;
      if (!ok) {
        return { valid: false, username, error: 'Token does not match username' };
      }
      return { valid: true, username: creds.github_username };
    } catch (error) {
      return { valid: false, username, error: error.message };
    }
  }

  async _getFromCache(username) {
    try {
      const cacheKey = `${CACHE_PREFIX}${username}`;
      if (redisClient) {
        const cached = await redisClient.get(cacheKey);
        if (cached) return JSON.parse(cached);
      }
      if (this.cache.has(username)) {
        const entry = this.cache.get(username);
        if (entry.expiresAt > Date.now()) return entry.value;
        this.cache.delete(username);
      }
      return null;
    } catch (error) {
      logger.warn(`Cache read error for ${username}:`, error.message);
      return null;
    }
  }

  async _setInCache(username, value) {
    try {
      const cacheKey = `${CACHE_PREFIX}${username}`;
      if (redisClient) {
        await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(value));
      }
      this.cache.set(username, {
        value,
        expiresAt: Date.now() + CACHE_TTL * 1000
      });
    } catch (error) {
      logger.warn(`Cache write error for ${username}:`, error.message);
    }
  }

  async _clearCache(username) {
    const cacheKey = `${CACHE_PREFIX}${username}`;
    if (redisClient) {
      await redisClient.del(cacheKey);
    }
    this.cache.delete(username);
  }
}

module.exports = new DeveloperCredentialsManager();
