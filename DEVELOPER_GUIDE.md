# Zip-Sync Developer Guide

Welcome to Zip-Sync! This guide will help you get started quickly.

---

## 📁 Project Structure

```
zip-sync/
├── backend/                    # Express.js Backend
│   ├── src/
│   │   ├── config/
│   │   │   └── index.js       # ⭐ Backend configuration (URLs, ports)
│   │   ├── routes/
│   │   │   ├── project.routes.js
│   │   │   └── release.routes.js
│   │   ├── middleware/
│   │   ├── utils/
│   │   ├── app.js
│   │   └── server.js
│   ├── prisma/
│   │   └── schema.prisma      # Database schema
│   ├── projects/              # Uploaded project files
│   ├── ecosystem.config.cjs   # PM2 config for EC2
│   └── package.json
│
├── frontend/                   # React + Vite Frontend
│   ├── src/
│   │   ├── config/
│   │   │   └── index.js       # ⭐ Frontend configuration (API URL)
│   │   ├── api/
│   │   │   └── index.js       # API service (uses config)
│   │   ├── components/
│   │   ├── pages/
│   │   ├── context/
│   │   └── styles/
│   ├── ecosystem.config.cjs   # PM2 config for EC2
│   └── package.json
│
└── DEVELOPER_GUIDE.md         # This file
```

---

## 🚀 Quick Start (Local Development)

### 1. Start Backend

```bash
cd backend
npm install
npm start
```

Backend runs on: **http://localhost:5000**

### 2. Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on: **http://localhost:5173**

---

## ⚙️ Configuration System

All URLs are centralized in config files. **No more hunting for hardcoded URLs!**

### Backend Config: `backend/src/config/index.js`

```javascript
const config = {
  // Change this when deploying to EC2
  BASE_URL: process.env.BASE_URL || 'http://localhost:5000',
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
};
```

### Frontend Config: `frontend/src/config/index.js`

```javascript
const config = {
  // Change this when deploying to EC2
  API_URL: import.meta.env.VITE_API_URL || 'http://localhost:5000',
  NODE_ENV: import.meta.env.MODE || 'development',
};
```

---

## 🔄 Switching Between Environments

### Option 1: Edit Config Files Directly

| Environment | Backend `BASE_URL` | Frontend `API_URL` |
|-------------|--------------------|--------------------|
| **Local** | `http://localhost:5000` | `http://localhost:5000` |
| **EC2 Production** | `http://43.205.121.85:5000` | `http://43.205.121.85:5000` |

### Option 2: Use Environment Variables (Recommended for Production)

**Backend:**
```bash
export BASE_URL=http://43.205.121.85:5000
npm start
```

**Frontend:**
```bash
# Create .env file in frontend root
VITE_API_URL=http://43.205.121.85:5000
npm run dev
```

---

## 📋 Common Tasks

### Running Locally

```bash
# Terminal 1 - Backend
cd backend && npm start

# Terminal 2 - Frontend
cd frontend && npm run dev
```

### Deploying to EC2

```bash
# On EC2 instance
cd /home/ubuntu/zip-sync/backend
./deploy.sh

cd /home/ubuntu/zip-sync/frontend
./deploy.sh
```

---

## 🔄 PM2 Commands (Production)

PM2 is used to manage processes on EC2. Both backend and frontend have PM2 configured.

### Quick Reference

| Command | Description |
|---------|-------------|
| `npm run start` | Start the app with PM2 |
| `npm run stop` | Stop the app |
| `npm run restart` | Restart the app |
| `npm run reload` | Zero-downtime reload |
| `npm run delete` | Remove from PM2 |
| `npm run logs` | View live logs |
| `npm run monit` | Open PM2 dashboard |
| `npm run status` | Check process status |

### Backend PM2 Commands

```bash
cd /home/ubuntu/zip-sync/backend

# Start backend with PM2
pm2 start ecosystem.config.cjs --env production

# Or use npm scripts
npm run start              # Start with PM2
npm run stop               # Stop backend
npm run restart            # Restart backend
npm run logs               # View backend logs
npm run status             # Check status
```

### Frontend PM2 Commands

```bash
cd /home/ubuntu/zip-sync/frontend

# Start frontend with PM2 (runs Vite dev server)
pm2 start ecosystem.config.cjs --env production

# Or use npm scripts
npm run start              # Start with PM2
npm run stop               # Stop frontend
npm run restart            # Restart frontend
npm run logs               # View frontend logs
npm run status             # Check status
```

### Global PM2 Commands

```bash
# View all running processes
pm2 list

# View detailed status
pm2 show zip-sync-backend
pm2 show zip-sync-frontend

# View logs for all processes
pm2 logs

# View logs for specific process
pm2 logs zip-sync-backend
pm2 logs zip-sync-frontend

# Monitor all processes (CPU, Memory)
pm2 monit

# Restart all processes
pm2 restart all

# Stop all processes
pm2 stop all

# Delete all processes
pm2 delete all

# Save current process list (auto-start on reboot)
pm2 save

# Setup PM2 to start on system boot
pm2 startup

# Flush all logs
pm2 flush
```

### EC2 Deployment with PM2

```bash
# Initial setup (run once)
cd /home/ubuntu/zip-sync/backend
./setup-ec2.sh

cd /home/ubuntu/zip-sync/frontend
./setup-ec2.sh

# Deploy updates
cd /home/ubuntu/zip-sync/backend
./deploy.sh

cd /home/ubuntu/zip-sync/frontend
./deploy.sh
```

### PM2 Process Names

| Service | PM2 Process Name |
|---------|------------------|
| Backend | `zip-sync-backend` |
| Frontend | `zip-sync-frontend` |

### Useful PM2 Tips

```bash
# Check if processes are running
pm2 status

# Expected output:
# ┌─────────────────────┬────┬─────────┬──────┬───────┐
# │ Name                │ id │ status  │ cpu  │ memory│
# ├─────────────────────┼────┼─────────┼──────┼───────┤
# │ zip-sync-backend    │ 0  │ online  │ 0.1% │ 80MB  │
# │ zip-sync-frontend   │ 1  │ online  │ 0.2% │ 60MB  │
# └─────────────────────┴────┴─────────┴──────┴───────┘

# If a process shows 'errored' or 'stopped', check logs:
pm2 logs zip-sync-backend --lines 50

# Force restart a crashed process
pm2 restart zip-sync-backend --update-env
```

---

## 🗄️ Database

The project uses **PostgreSQL** with **Prisma ORM**.

### Prisma Commands

```bash
cd backend

# Generate Prisma client after schema changes
npx prisma generate

# Push schema to database
npx prisma db push

# Open Prisma Studio (GUI)
npx prisma studio
```

---

## 🔐 Authentication

- JWT-based authentication
- Token stored in `localStorage`
- Auto-logout on 401 errors

---

## 📍 Key Files to Know

| File | Purpose |
|------|---------|
| `backend/src/config/index.js` | **All backend URLs/ports** |
| `frontend/src/config/index.js` | **Frontend API URL** |
| `frontend/src/api/index.js` | All API calls to backend |
| `backend/src/routes/project.routes.js` | Project management APIs |
| `backend/src/routes/release.routes.js` | Release management APIs |
| `backend/prisma/schema.prisma` | Database schema |

---

## 🐛 Troubleshooting

### Frontend can't connect to backend

1. Check if backend is running: `curl http://localhost:5000/api/health`
2. Verify `frontend/src/config/index.js` has correct `API_URL`
3. Check CORS settings in `backend/src/app.js`

### Port already in use

```bash
# Find what's using the port
lsof -i :5000
lsof -i :5173

# Kill the process
kill -9 <PID>
```

### Database connection issues

```bash
cd backend
npx prisma db push
npx prisma generate
```

---

## 📞 Ports Reference

| Service | Local Port | EC2 Port |
|---------|------------|----------|
| Backend | 5000 | 5000 |
| Frontend | 5173 | 5173 |
| Database | 5432 | 5432 |

---

## 🎯 TL;DR for New Developers

1. **Clone the repo**
2. **Run `npm install` in both `backend/` and `frontend/`**
3. **Start backend:** `cd backend && npm start`
4. **Start frontend:** `cd frontend && npm run dev`
5. **Open browser:** http://localhost:5173
6. **Config files are in:** `*/src/config/index.js`

---

Happy coding! 🚀
