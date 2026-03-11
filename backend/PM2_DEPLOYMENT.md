# Launchpad Backend PM2 Deployment Guide

**Note:** Production deployment for Launchpad uses **Docker + Supabase** only; see [EC2_DEPLOYMENT.md](../EC2_DEPLOYMENT.md) in the repo root. This PM2 guide is for alternative setups where you run the backend without Docker.

This guide explains how to deploy the Launchpad backend using PM2 on EC2.

## Prerequisites

- Ubuntu EC2 instance
- Node.js 18+ installed
- Git access to the repository
- Database configured (PostgreSQL)

## Quick Setup

### 1. Initial Setup on EC2

```bash
# Clone the repository (if not already done)
git clone <your-repo-url> /home/ubuntu/launchpad

# Navigate to backend directory
cd /home/ubuntu/launchpad/backend

# Make setup script executable and run it
chmod +x setup-ec2.sh
./setup-ec2.sh
```

### 2. Manual Setup (Alternative)

```bash
# Install PM2 globally
sudo npm install -g pm2

# Install dependencies
npm install

# Setup Prisma
npx prisma generate
npx prisma db push

# Start with PM2
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

# Setup PM2 startup
pm2 startup
```

## Configuration Files

### ecosystem.config.js

- Main PM2 configuration
- Defines app settings, environment variables, and logging
- Configured for production deployment

### start.sh

- Startup script that handles initial setup
- Creates logs directory, installs dependencies, runs migrations
- Starts the application with PM2

### deploy.sh

- Deployment script for updates
- Handles dependency updates, migrations, and service restart

### launchpad-backend.service

- Systemd service file for better system integration
- Enables automatic startup on boot

## Service Management

### PM2 Commands

```bash
# Check status
pm2 status

# View logs
pm2 logs launchpad-backend

# Restart service
pm2 restart launchpad-backend

# Stop service
pm2 stop launchpad-backend

# Delete service
pm2 delete launchpad-backend

# Monitor processes
pm2 monit
```

### Systemd Commands (Alternative)

```bash
# Start service
sudo systemctl start launchpad-backend

# Stop service
sudo systemctl stop launchpad-backend

# Restart service
sudo systemctl restart launchpad-backend

# Check status
sudo systemctl status launchpad-backend

# Enable auto-start
sudo systemctl enable launchpad-backend
```

## Environment Variables

Create a `.env` file in the backend directory with:

```env
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/zipsync"

# JWT
JWT_SECRET="your-jwt-secret"

# Server
PORT=5000
NODE_ENV=production

# Jira (if using)
JIRA_BASE_URL="https://your-company.atlassian.net"
JIRA_USERNAME="your-email@company.com"
JIRA_API_TOKEN="your-api-token"
JIRA_PROJECT_KEY="PROJ"
JIRA_ISSUE_TYPE="Task"
```

## Deployment Process

### Initial Deployment

1. Run `./setup-ec2.sh` on your EC2 instance
2. Configure your `.env` file
3. The service will start automatically

### Updates

1. Pull latest changes: `git pull origin main`
2. Run `./deploy.sh` to update the service
3. Or manually: `pm2 restart launchpad-backend`

## Monitoring

### Log Files

- Combined logs: `./logs/combined.log`
- Output logs: `./logs/out.log`
- Error logs: `./logs/error.log`

### Health Checks

- PM2 automatically restarts failed processes
- Memory limit: 1GB (configurable in ecosystem.config.js)
- Max restarts: 10 (configurable)

## Troubleshooting

### Common Issues

1. **Port already in use**

   ```bash
   sudo lsof -i :5000
   sudo kill -9 <PID>
   ```

2. **Permission issues**

   ```bash
   sudo chown -R ubuntu:ubuntu /home/ubuntu/launchpad
   ```

3. **Database connection issues**

   - Check DATABASE_URL in .env
   - Ensure PostgreSQL is running
   - Run `npx prisma db push`

4. **PM2 not starting**
   ```bash
   pm2 kill
   pm2 start ecosystem.config.js --env production
   ```

### Useful Commands

```bash
# Check if service is running
curl http://43.205.121.85:5000/api/health

# View real-time logs
pm2 logs launchpad-backend --lines 100

# Check system resources
pm2 monit

# Restart all PM2 processes
pm2 restart all
```

## Security Considerations

1. **Firewall**: Ensure port 5000 is open in security groups
2. **Environment**: Keep .env file secure and never commit it
3. **Updates**: Regularly update dependencies and system packages
4. **Monitoring**: Set up log monitoring and alerting

## Production Checklist

- [ ] Environment variables configured
- [ ] Database migrations run
- [ ] PM2 process running
- [ ] Logs directory created
- [ ] Firewall rules configured
- [ ] SSL/TLS configured (if needed)
- [ ] Monitoring setup
- [ ] Backup strategy in place
