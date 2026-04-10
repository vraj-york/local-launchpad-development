module.exports = {
  apps: [
    {
      name: 'launchpad-feedback-recording-worker',
      script: 'src/workers/feedbackRecordingMerge.worker.js',
      cwd: process.cwd(),
      instances: 1,
      exec_mode: 'fork',
      env_development: {
        NODE_ENV: 'development',
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env_file: '.env',
    },
    {
      name: 'launchpad-backend',
      script: 'src/server.js',
      cwd: process.cwd(),
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        PORT: 5000,
        NODE_PATH: '/home/ubuntu/launchpad/backend/node_modules',
        PATH: process.env.PATH + ':/home/ubuntu/launchpad/backend/node_modules/.bin',
        HOME: process.env.HOME,
        USER: process.env.USER
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 5000
      },
      // Logging
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Auto restart configuration
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      
      // Advanced PM2 features
      min_uptime: '10s',
      max_restarts: 10,
      
      // Health monitoring
      health_check_grace_period: 3000,
      
      // Process management
      kill_timeout: 5000,
      listen_timeout: 3000,
      
      // Environment variables
      env_file: '.env'
    }
  ],
  
  // Deployment configuration for EC2
  deploy: {
    production: {
      user: 'ubuntu',
      host: '43.205.121.85',
      ref: 'origin/main',
      repo: 'git@github.com:your-repo/launchpad.git',
      path: '/home/ubuntu/launchpad',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    }
  }
};
