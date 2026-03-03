module.exports = {
  apps : [{
    name: "bot-ferreteria",
    script: "./main.js",
    watch: ["main.js", "services", "config"],
    ignore_watch: ["node_modules", "session_logs", "logs"], // No reiniciar cuando escriba logs
    error_file: "./logs/err.log",
    out_file: "./logs/out.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    autorestart: true,
    max_memory_restart: '300M',
    env: {
      NODE_ENV: "production",
    }
  }]
};
