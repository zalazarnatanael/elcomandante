/**
 * Simple Logger
 * Provides console logging with timestamp and level prefix
 */

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'];

const logger = {
  debug: (...args) => {
    if (currentLevel <= LOG_LEVELS.debug) {
      console.log(`[DEBUG] ${new Date().toISOString()}`, ...args);
    }
  },

  info: (...args) => {
    if (currentLevel <= LOG_LEVELS.info) {
      console.log(`[INFO] ${new Date().toISOString()}`, ...args);
    }
  },

  warn: (...args) => {
    if (currentLevel <= LOG_LEVELS.warn) {
      console.warn(`[WARN] ${new Date().toISOString()}`, ...args);
    }
  },

  error: (...args) => {
    if (currentLevel <= LOG_LEVELS.error) {
      console.error(`[ERROR] ${new Date().toISOString()}`, ...args);
    }
  }
};

module.exports = logger;
