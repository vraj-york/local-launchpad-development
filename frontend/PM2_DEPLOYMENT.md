# PM2 Deployment Guide for Zip Sync Frontend (EC2)

This guide explains how to deploy and manage the Zip Sync frontend application using PM2 on EC2.

## Prerequisites

1. **EC2 Instance** running Ubuntu
2. **Node.js and npm** installed
3. **PM2** installed globally: `npm install -g pm2`
4. **Build tools** available (Vite handles this)

## EC2 Quick Start

### 1. Initial Setup (Run once on EC2)

```bash
# Run the setup script
./setup-ec2.sh
```

### 2. Deploy Updates

```bash
# Use the deployment script for updates
./deploy.sh
```

### 3. Manual Commands

```bash
# Install dependencies
npm install

# Start with PM2 (runs Vite dev server)
npm run start
```

## Available Scripts

| Script              | Description                                |
| ------------------- | ------------------------------------------ |
| `npm run start`     | Start the app in production mode with PM2  |
| `npm run start:dev` | Start the app in development mode with PM2 |
| `npm run stop`      | Stop the PM2 process                       |
| `npm run restart`   | Restart the PM2 process                    |
| `npm run reload`    | Reload the PM2 process (zero-downtime)     |
| `npm run delete`    | Delete the PM2 process                     |
| `npm run logs`      | View application logs                      |
| `npm run monit`     | Open PM2 monitoring dashboard              |
| `npm run status`    | Show PM2 process status                    |

## Configuration

The PM2 configuration is defined in `ecosystem.config.cjs`:

- **App Name**: `zip-sync-frontend`
- **Script**: Uses `npm run dev -- --host 0.0.0.0 --port 5173` to run Vite dev server
- **Port**: 5173 (both production and development)
- **Working Directory**: `/home/ubuntu/zip-sync/frontend`
- **Memory Limit**: 512MB
- **Auto Restart**: Enabled
- **Logging**: Configured to write to `/home/ubuntu/zip-sync/frontend/logs/` directory
- **EC2 Optimized**: Paths configured for EC2 Ubuntu environment

## Environment Variables

Create a `.env` file in the frontend directory for environment-specific variables:

```env
NODE_ENV=production
PORT=5173
VITE_API_URL=http://43.205.121.85:5000
```

## Logs

Logs are stored in the `/home/ubuntu/zip-sync/frontend/logs/` directory:

- `combined.log` - All logs combined
- `out.log` - Standard output
- `error.log` - Error logs

View logs in real-time:

```bash
npm run logs
```

## Monitoring

### PM2 Dashboard

```bash
npm run monit
```

### Process Status

```bash
npm run status
```

### System Monitoring

```bash
pm2 show zip-sync-frontend
```

## EC2 Production Deployment

### 1. Initial EC2 Setup

```bash
# Run the setup script (one-time setup)
./setup-ec2.sh
```

### 2. Deploy Updates

```bash
# Use the deployment script for updates
./deploy.sh
```

### 3. Set up PM2 to start on system boot

```bash
pm2 startup
pm2 save
```

### 4. Configure reverse proxy (nginx example)

```nginx
server {
    listen 80;
    server_name 43.205.121.85;

    location / {
        proxy_pass http://localhost:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Troubleshooting

### Common Issues

1. **Port already in use**

   ```bash
   # Check what's using the port
   lsof -i :5173
   # Kill the process or change port in ecosystem.config.cjs
   ```

2. **Dependencies fail to install**

   ```bash
   # Clear node_modules and reinstall
   rm -rf node_modules package-lock.json
   npm install
   ```

3. **PM2 process not starting**

   ```bash
   # Check PM2 logs
   pm2 logs zip-sync-frontend

   # Check if node_modules exists
   ls -la node_modules/
   ```

4. **Memory issues**

   ```bash
   # Monitor memory usage
   pm2 monit

   # Restart if needed
   pm2 restart zip-sync-frontend
   ```

### Useful Commands

```bash
# View all PM2 processes
pm2 list

# Restart all processes
pm2 restart all

# Stop all processes
pm2 stop all

# Delete all processes
pm2 delete all

# View system information
pm2 show zip-sync-frontend

# Flush logs
pm2 flush
```

## Development vs Production

### Development Mode

- Uses Vite dev server with `--host 0.0.0.0`
- Hot reload enabled
- Port 5173
- Accessible from external connections
- More verbose logging

### Production Mode

- Uses Vite dev server with `--host 0.0.0.0`
- Hot reload enabled
- Port 5173
- Accessible from external connections
- Optimized for development workflow

## Security Considerations

1. **Environment Variables**: Never commit `.env` files with sensitive data
2. **HTTPS**: Use HTTPS in production with proper SSL certificates
3. **Firewall**: Configure firewall rules appropriately
4. **Updates**: Keep dependencies updated for security patches

## Performance Optimization

1. **Build Optimization**: Vite automatically optimizes the build
2. **Caching**: Configure proper caching headers
3. **CDN**: Consider using a CDN for static assets
4. **Monitoring**: Use PM2 monitoring to track performance

## Backup and Recovery

1. **Configuration Backup**: Keep `ecosystem.config.cjs` in version control
2. **Log Rotation**: Configure log rotation to prevent disk space issues
3. **Process Backup**: Use `pm2 save` to save current process list

## EC2 Deployment Steps

### Complete EC2 Setup Process

1. **Connect to your EC2 instance**

   ```bash
   ssh -i your-key.pem ubuntu@43.205.121.85
   ```

2. **Navigate to the frontend directory**

   ```bash
   cd /home/ubuntu/zip-sync/frontend
   ```

3. **Run the initial setup (one-time)**

   ```bash
   ./setup-ec2.sh
   ```

4. **For future deployments, just run**
   ```bash
   ./deploy.sh
   ```

### EC2 Security Group Configuration

Ensure your EC2 security group allows:

- **Port 5173** (Frontend) - Source: 0.0.0.0/0
- **Port 5000** (Backend) - Source: 0.0.0.0/0
- **Port 22** (SSH) - Source: Your IP

### EC2 File Structure

```
/home/ubuntu/zip-sync/
├── frontend/
│   ├── ecosystem.config.cjs
│   ├── deploy.sh
│   ├── setup-ec2.sh
│   ├── logs/
│   └── dist/ (built files)
└── backend/
    └── (existing backend files)
```

## Support

For issues related to:

- **PM2**: Check [PM2 documentation](https://pm2.keymetrics.io/docs/)
- **Vite**: Check [Vite documentation](https://vitejs.dev/)
- **React**: Check [React documentation](https://reactjs.org/)
- **EC2**: Check [AWS EC2 documentation](https://docs.aws.amazon.com/ec2/)
