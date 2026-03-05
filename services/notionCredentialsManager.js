/**
 * NotionCredentialsManager
 * Gestiona credenciales de Notion workspaces con soporte N:M (proyecto → múltiples workspaces)
 * - Carga desde tabla notion_workspaces (cifradas en BD)
 * - Descifra con MASTER_KEY
 * - Cachea en Redis (TTL 1h)
 */

const { getSupabaseClient } = require('./database');
const { encryptData, decryptData } = require('./encryptionService');
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
      const supabase = getSupabaseClient();
      
      const { data, error } = await supabase
        .from('project_notion_workspaces')
        .select(`
          notion_workspace_id,
          database_id,
          is_primary,
          notion_workspaces (
            workspace_id,
            workspace_name,
            api_key_encrypted,
            is_active
          )
        `)
        .eq('project_id', projectId)
        .eq('notion_workspaces.is_active', true);

      if (error) throw error;

      if (!data || data.length === 0) {
        logger.warn(`No Notion workspaces found for project ${projectId}`);
        return [];
      }

      // Descifrar API keys
      const workspaces = await Promise.all(
        data.map(async (row) => {
          const workspace = row.notion_workspaces;
          const apiKey = await this._decryptApiKey(workspace.api_key_encrypted);
          
          return {
            workspace_id: workspace.workspace_id,
            workspace_name: workspace.workspace_name,
            api_key: apiKey,
            database_id: row.database_id,
            is_primary: row.is_primary,
            is_active: workspace.is_active
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
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('notion_workspaces')
        .select('api_key_encrypted')
        .eq('workspace_id', workspaceId)
        .eq('is_active', true)
        .single();

      if (error) {
        logger.error(`Workspace ${workspaceId} not found:`, error);
        throw new Error(`Notion workspace ${workspaceId} not found`);
      }

      // Descifrar
      const apiKey = await this._decryptApiKey(data.api_key_encrypted);
      
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
      const supabase = getSupabaseClient();
      
      const { data, error } = await supabase
        .from('notion_workspaces')
        .select('*')
        .eq('is_active', true)
        .order('workspace_name', { ascending: true });

      if (error) throw error;

      return data || [];
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
      const supabase = getSupabaseClient();
      
      if (!process.env.MASTER_KEY) {
        throw new Error('MASTER_KEY not set in environment');
      }

      // Encriptar API key
      const encryptedKey = await encryptData(apiKey);

      const { data, error } = await supabase
        .from('notion_workspaces')
        .insert({
          workspace_id: workspaceId,
          workspace_name: workspaceName,
          api_key_encrypted: encryptedKey,
          notes: notes,
          created_by: process.env.USER || 'system'
        })
        .select();

      if (error) throw error;

      logger.info(`Notion workspace ${workspaceId} added successfully`);
      return data[0];
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
      const supabase = getSupabaseClient();

      const { data, error } = await supabase
        .from('project_notion_workspaces')
        .upsert({
          project_id: projectId,
          notion_workspace_id: workspaceId,
          database_id: databaseId,
          is_primary: isPrimary
        }, {
          onConflict: 'project_id,notion_workspace_id'
        })
        .select();

      if (error) throw error;

      logger.info(`Project ${projectId} linked to workspace ${workspaceId}`);
      
      // Limpiar cache del proyecto
      await this._clearProjectCache(projectId);
      
      return data[0];
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
      const supabase = getSupabaseClient();

      const { error } = await supabase
        .from('project_notion_workspaces')
        .delete()
        .eq('project_id', projectId)
        .eq('notion_workspace_id', workspaceId);

      if (error) throw error;

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
    return decryptData(encryptedKey);
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
