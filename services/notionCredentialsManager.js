/**
 * NotionCredentialsManager
 * Gestiona credenciales de Notion workspaces con soporte N:M (proyecto → múltiples workspaces)
 * - Carga desde tabla notion_workspaces (cifradas en BD)
 * - Descifra con ENCRYPTION_MASTER_KEY (fallback MASTER_KEY)
 * - Cachea en Redis (TTL 1h)
 */

const sql = require('../src/shared/config/db');
const { encrypt, decrypt } = require('./encryptionService');
const redis = require('redis');
const logger = require('../logger');

let redisClient = null;

const CACHE_TTL = 3600; // 1 hora
const CACHE_PREFIX = 'notion:workspace:';

class NotionCredentialsManager {
  constructor() {
    this.workspaceCache = new Map(); // Fallback si Redis no está disponible
  }

  /**
   * Inicializar Redis (opcional)
   */
  async initRedis() {
    try {
      if (process.env.REDIS_URL) {
        redisClient = redis.createClient({ url: process.env.REDIS_URL });
        redisClient.on('error', (err) => logger.error('Redis error:', err));
        await redisClient.connect();
        logger.info('Redis connected for Notion credentials cache');
      }
    } catch (error) {
      logger.warn('Redis not available, using in-memory cache:', error.message);
    }
  }

  /**
   * Obtener todos los workspaces de un proyecto
   * Retorna: [{ workspace_id, workspace_name, api_key, database_id, is_primary }, ...]
   */
  async getWorkspacesForProject(projectId) {
    try {
      const rows = await sql`
        SELECT
          pnw.notion_workspace_id,
          pnw.database_id,
          pnw.is_primary,
          nw.workspace_id,
          nw.workspace_name,
          nw.api_key_encrypted,
          nw.is_active
        FROM project_notion_workspaces pnw
        JOIN notion_workspaces nw ON pnw.notion_workspace_id = nw.workspace_id
        WHERE pnw.project_id = ${projectId}
          AND nw.is_active = true
      `;

      if (!rows || rows.length === 0) {
        logger.warn(`No Notion workspaces found for project ${projectId}`);
        return [];
      }

      // Descifrar API keys
      const workspaces = await Promise.all(
        rows.map(async (row) => {
          const apiKey = await this._decryptApiKey(row.api_key_encrypted);
          
          return {
            workspace_id: row.workspace_id,
            workspace_name: row.workspace_name,
            api_key: apiKey,
            database_id: row.database_id,
            is_primary: row.is_primary,
            is_active: row.is_active
          };
        })
      );

      return workspaces;
    } catch (error) {
      logger.error(`Error loading workspaces for project ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Obtener workspace primario de un proyecto
   */
  async getPrimaryWorkspaceForProject(projectId) {
    try {
      const workspaces = await this.getWorkspacesForProject(projectId);
      const primary = workspaces.find((w) => w.is_primary);
      
      if (!primary) {
        logger.warn(`No primary workspace found for project ${projectId}`);
        return workspaces[0] || null; // Fallback al primero si no hay marcado
      }
      
      return primary;
    } catch (error) {
      logger.error(`Error getting primary workspace for ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Obtener API key descifrada para un workspace específico
   */
  async getApiKeyForWorkspace(workspaceId) {
    try {
      // Intentar cargar del cache
      const cached = await this._getFromCache(workspaceId);
      if (cached) return cached;

      // Cargar de BD
      const rows = await sql`
        SELECT api_key_encrypted
        FROM notion_workspaces
        WHERE workspace_id = ${workspaceId}
          AND is_active = true
        LIMIT 1
      `;

      if (!rows || rows.length === 0) {
        logger.error(`Workspace ${workspaceId} not found`);
        throw new Error(`Notion workspace ${workspaceId} not found`);
      }

      // Descifrar
      const apiKey = await this._decryptApiKey(rows[0].api_key_encrypted);
      
      // Guardar en cache
      await this._setInCache(workspaceId, apiKey);

      return apiKey;
    } catch (error) {
      logger.error(`Error getting API key for workspace ${workspaceId}:`, error);
      throw error;
    }
  }

  /**
   * Listar todos los workspaces activos
   */
  async getAllWorkspaces() {
    try {
      const rows = await sql`
        SELECT *
        FROM notion_workspaces
        WHERE is_active = true
        ORDER BY workspace_name ASC
      `;

      return rows || [];
    } catch (error) {
      logger.error('Error listing workspaces:', error);
      throw error;
    }
  }

  /**
   * Agregar un nuevo workspace (admin only)
   * Encripta la API key automáticamente
   */
  async addWorkspace(workspaceId, workspaceName, apiKey, notes = null) {
    try {
      if (!process.env.MASTER_KEY) {
        throw new Error('MASTER_KEY not set in environment');
      }

      // Encriptar API key
      const encryptedKey = await encrypt(apiKey);

      const rows = await sql`
        INSERT INTO notion_workspaces (workspace_id, workspace_name, api_key_encrypted, notes, created_by)
        VALUES (${workspaceId}, ${workspaceName}, ${encryptedKey}, ${notes}, ${process.env.USER || 'system'})
        RETURNING *
      `;

      logger.info(`Notion workspace ${workspaceId} added successfully`);
      return rows[0];
    } catch (error) {
      logger.error(`Error adding workspace ${workspaceId}:`, error);
      throw error;
    }
  }

  /**
   * Vincular proyecto a workspace
   */
  async linkProjectToWorkspace(projectId, workspaceId, databaseId = null, isPrimary = false) {
    try {
      const rows = await sql`
        INSERT INTO project_notion_workspaces (project_id, notion_workspace_id, database_id, is_primary)
        VALUES (${projectId}, ${workspaceId}, ${databaseId}, ${isPrimary})
        ON CONFLICT (project_id, notion_workspace_id)
        DO UPDATE SET
          database_id = EXCLUDED.database_id,
          is_primary = EXCLUDED.is_primary,
          updated_at = ${new Date().toISOString()}
        RETURNING *
      `;

      logger.info(`Project ${projectId} linked to workspace ${workspaceId}`);
      
      // Limpiar cache del proyecto
      await this._clearProjectCache(projectId);
      
      return rows[0];
    } catch (error) {
      logger.error(`Error linking project ${projectId} to workspace ${workspaceId}:`, error);
      throw error;
    }
  }

  /**
   * Remover vínculo entre proyecto y workspace
   */
  async unlinkProjectFromWorkspace(projectId, workspaceId) {
    try {
      await sql`
        DELETE FROM project_notion_workspaces
        WHERE project_id = ${projectId}
          AND notion_workspace_id = ${workspaceId}
      `;

      logger.info(`Project ${projectId} unlinked from workspace ${workspaceId}`);
      
      // Limpiar cache
      await this._clearProjectCache(projectId);
    } catch (error) {
      logger.error(`Error unlinking project ${projectId} from workspace ${workspaceId}:`, error);
      throw error;
    }
  }

  /**
   * Validar credenciales de un workspace (test connection)
   */
  async validateWorkspaceCredentials(workspaceId) {
    try {
      const { Client } = require('@notionhq/client');
      const apiKey = await this.getApiKeyForWorkspace(workspaceId);
      
      const notionClient = new Client({ auth: apiKey });
      
      // Test simple: obtener versión de BD de usuario
      await notionClient.users.me();
      
      logger.info(`Workspace ${workspaceId} credentials validated successfully`);
      return { valid: true, workspaceId };
    } catch (error) {
      logger.error(`Workspace ${workspaceId} credentials invalid:`, error.message);
      return { valid: false, workspaceId, error: error.message };
    }
  }

  // =========================================================================
  // PRIVATE METHODS
  // =========================================================================

  /**
   * Descifrar API key con manejo de errores
   */
  async _decryptApiKey(encryptedKey) {
    if (!process.env.MASTER_KEY) {
      throw new Error('MASTER_KEY not set in environment');
    }
    return decrypt(encryptedKey);
  }

  /**
   * Obtener del cache (Redis o memoria)
   */
  async _getFromCache(workspaceId) {
    try {
      const cacheKey = `${CACHE_PREFIX}${workspaceId}`;
      
      // Intentar Redis primero
      if (redisClient) {
        const cached = await redisClient.get(cacheKey);
        if (cached) return cached;
      }
      
      // Fallback a memoria
      if (this.workspaceCache.has(workspaceId)) {
        const entry = this.workspaceCache.get(workspaceId);
        if (entry.expiresAt > Date.now()) {
          return entry.value;
        }
        this.workspaceCache.delete(workspaceId);
      }
      
      return null;
    } catch (error) {
      logger.warn(`Cache read error for workspace ${workspaceId}:`, error.message);
      return null;
    }
  }

  /**
   * Guardar en cache (Redis o memoria)
   */
  async _setInCache(workspaceId, value) {
    try {
      const cacheKey = `${CACHE_PREFIX}${workspaceId}`;
      
      // Guardar en Redis
      if (redisClient) {
        await redisClient.setEx(cacheKey, CACHE_TTL, value);
      }
      
      // Guardar en memoria como fallback
      this.workspaceCache.set(workspaceId, {
        value,
        expiresAt: Date.now() + CACHE_TTL * 1000
      });
    } catch (error) {
      logger.warn(`Cache write error for workspace ${workspaceId}:`, error.message);
    }
  }

  /**
   * Limpiar cache de un proyecto (todas sus relaciones)
   */
  async _clearProjectCache(projectId) {
    try {
      const workspaces = await this.getWorkspacesForProject(projectId);
      
      for (const ws of workspaces) {
        const cacheKey = `${CACHE_PREFIX}${ws.workspace_id}`;
        
        if (redisClient) {
          await redisClient.del(cacheKey);
        }
        
        this.workspaceCache.delete(ws.workspace_id);
      }
      
      logger.debug(`Cache cleared for project ${projectId}`);
    } catch (error) {
      logger.warn(`Error clearing cache for project ${projectId}:`, error.message);
    }
  }
}

// Singleton instance
const instance = new NotionCredentialsManager();

module.exports = instance;
