module.exports = {
  apps: [
    {
      name: 'web-app-ts',
      script: 'dist/index.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      exp_backoff_restart_delay: 100,
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      time: true,
    },
  ],
};
