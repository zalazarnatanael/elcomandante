module.exports = {
  apps : [
    {
      name: "openclaw-webhook",
      script: "./src/server.js",
      watch: ["src", "services", "config"],
      ignore_watch: ["node_modules", "session_logs", "logs"],
      error_file: "./logs/webhook-err.log",
      out_file: "./logs/webhook-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      autorestart: true,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "openclaw-cron",
      script: "./scripts/auto_expand_multi_projects.js",
      cron_restart: "*/10 * * * *",
      watch: false,
      error_file: "./logs/cron-err.log",
      out_file: "./logs/cron-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      autorestart: false,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
