module.exports = {
  apps: [
    {
      name: 'launchpad-frontend',
      script: 'npm',
      args: 'run dev -- --host 0.0.0.0 --port 5173',
      cwd: '/home/ubuntu/launchpad/frontend',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 5173,
        NODE_PATH: '/home/ubuntu/launchpad/frontend/node_modules',
        PATH: process.env.PATH + ':/home/ubuntu/launchpad/frontend/node_modules/.bin',
        HOME: process.env.HOME,
        USER: process.env.USER
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 5173
      },
      // Logging
      log_file: '/home/ubuntu/launchpad/frontend/logs/combined.log',
      out_file: '/home/ubuntu/launchpad/frontend/logs/out.log',
      error_file: '/home/ubuntu/launchpad/frontend/logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Auto restart configuration
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      
      // Advanced PM2 features
      min_uptime: '10s',
      max_restarts: 10,
      
      // Health monitoring
      health_check_grace_period: 3000,
      
      // Process management
      kill_timeout: 5000,
      listen_timeout: 3000,
      
      // Environment variables
      env_file: '/home/ubuntu/launchpad/frontend/.env'
    }
  ],
  
  // Deployment configuration for EC2
  deploy: {
    production: {
      user: 'ubuntu',
      host: '43.205.121.85',
      ref: 'origin/main',
      repo: 'git@github.com:your-repo/launchpad.git',
      path: '/home/ubuntu/launchpad/frontend',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.cjs --env production',
      'pre-setup': ''
    }
  }
};
