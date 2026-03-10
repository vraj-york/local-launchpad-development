# Deploy Launchpad on EC2 (Docker + Supabase)

This guide walks you through deploying **Launchpad** on a single **Amazon EC2** instance using **Docker** only. The database is **Supabase** (hosted PostgreSQL); you do **not** install or run PostgreSQL on EC2.

- **EC2**: runs frontend + backend + nginx in Docker. No PM2, no PostgreSQL on the instance.
- **Supabase**: hosted PostgreSQL. Backend connects via `DATABASE_URL`.

---

## 1. Prerequisites on EC2

- **AMI**: Ubuntu 22.04 LTS (or Amazon Linux 2023).
- **Instance**: At least 2 GB RAM; 4 GB+ recommended for production.
- **Security group**: Open the ports in step 5.
- **SSH**: You can log in with `ssh -i your-key.pem ubuntu@<EC2-PUBLIC-IP>`.

---

## 2. Install Docker and Docker Compose

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Allow your user to run Docker (optional; or use sudo for docker commands)
sudo usermod -aG docker ubuntu
# Log out and back in for the group to take effect
```

---

## 3. Clone the repo and set environment

```bash
# Clone (replace with your repo URL)
git clone <your-repo-url> /home/ubuntu/launchpad
cd /home/ubuntu/launchpad

# Create .env from example
cp .env.example .env

# Edit .env with your production values
nano .env
```

**Production `.env`** – use **Supabase** for the database. Set at least:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Your **Supabase** connection string (Supabase Dashboard → Project Settings → Database). Use the URI, e.g. `postgresql://postgres.[project-ref]:[YOUR-PASSWORD]@aws-0-[region].pooler.supabase.com:5432/postgres`. Use **Session** (direct) connection if the pooler causes migration issues. |
| `VITE_API_URL` | URL the browser uses for the API (e.g. `http://YOUR_EC2_IP:5000` or `https://api.yourdomain.com`) |
| `VITE_FRONTEND_URL` | Frontend base URL (e.g. `http://YOUR_EC2_IP:3000` or `https://app.yourdomain.com`) |
| `BASE_URL` | Same as backend URL (e.g. `http://YOUR_EC2_IP:5000`) |
| `NGINX_BASE_DOMAIN` | Your base domain (e.g. `yourdomain.com`) or leave `localhost` for IP-only access |
| `JWT_SECRET` | Long random secret (e.g. `openssl rand -base64 32`) |

**Do not** set `POSTGRES_*` or start the Docker `db` service in production; the database is Supabase only.

---

## 4. Build and start the stack

```bash
cd /home/ubuntu/launchpad

# Start backend + frontend + nginx (no db container; DATABASE_URL points to Supabase)
docker compose up -d --build
```

This starts:

- **Backend** on port `5000`
- **Frontend** (Nginx serving built app) on port `3000`
- **Nginx** (project subdomains) on port `80`

No PostgreSQL runs on EC2; the backend uses Supabase via `DATABASE_URL`.

---

## 5. EC2 security group

Open these ports in the instance security group:

| Port | Service   | Inbound rule        |
|------|-----------|----------------------|
| 22   | SSH       | Your IP (or restrict as needed) |
| 80   | Nginx     | 0.0.0.0/0 (or your LB/domain) |
| 3000 | Frontend  | 0.0.0.0/0 (or your LB/domain) |
| 5000 | Backend   | 0.0.0.0/0 (or your LB/domain) |

---

## 6. Verify

- **Frontend**: `http://YOUR_EC2_IP:3000`
- **Backend API**: `http://YOUR_EC2_IP:5000`
- **Default login** (after first start): `admin@example.com` / `Admin@123` (change after first login)

---

## 7. Useful Docker commands

```bash
cd /home/ubuntu/launchpad

# Logs
docker compose logs -f backend
docker compose logs -f frontend

# Stop
docker compose down

# Restart after editing .env
docker compose up -d --build
```

---

## Summary

| Item | Production setup |
|------|-------------------|
| **Deploy method** | Docker only (no PM2) |
| **Database** | Supabase only (no PostgreSQL on EC2) |
| **Start command** | `docker compose up -d --build` |
| **Config** | Repo root `.env` with `DATABASE_URL` from Supabase |

For **local development** with Docker you can still use a local Postgres or the Docker `db` service; see [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md).
