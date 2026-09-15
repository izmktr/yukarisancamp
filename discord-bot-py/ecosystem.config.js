const path = require('path');

module.exports = {
  apps: [
    {
      name: 'discord-bot-py',
      script: 'main.py',
      interpreter: 'python3',
      cwd: path.join(__dirname, 'src'),
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      exp_backoff_restart_delay: 100,
      out_file: path.join(__dirname, 'logs/out.log'),
      error_file: path.join(__dirname, 'logs/error.log'),
      time: true,
    },
  ],
};
