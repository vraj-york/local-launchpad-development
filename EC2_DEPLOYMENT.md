# Deploy Launchpad on EC2 (Docker + Supabase)

This guide walks you through deploying **Launchpad** on a single **Amazon EC2** instance using **Docker** only. The database is **Supabase** (hosted PostgreSQL); you do **not** install or run PostgreSQL on EC2.

- **EC2**: runs frontend + backend in Docker (nginx runs **inside** the backend container on port 80). No PM2, no PostgreSQL on the instance.
- **Supabase**: hosted PostgreSQL. Backend connects via `DATABASE_URL`.

---

## 1. Prerequisites on EC2

- **AMI**: Ubuntu 22.04 LTS (or Amazon Linux 2023).
- **Instance**: At least 2 GB RAM; 4 GB+ recommended for production.
- **Security group**: Open the ports in step 5.
- **SSH**: You can log in with `ssh -i your-key.pem ubuntu@<EC2-PUBLIC-IP>`.

---

## 2. Free port 80 (if “port already in use”)

If `docker compose up` fails with “port 80 already in use”, something on the host is using it (e.g. Apache or nginx). Free it with:

```bash
# See what is using port 80
sudo lsof -i :80
# or
sudo ss -tlnp | grep :80
```

**Ubuntu / Debian** – stop and disable the service that uses 80:

```bash
# If Apache (apache2) is using 80:
sudo systemctl stop apache2
sudo systemctl disable apache2

# If nginx on the host is using 80:
sudo systemctl stop nginx
sudo systemctl disable nginx
```

**Amazon Linux 2023** – same idea:

```bash
# Apache (httpd)
sudo systemctl stop httpd
sudo systemctl disable httpd

# Or nginx
sudo systemctl stop nginx
sudo systemctl disable nginx
```

Then start your stack again: `docker compose up -d --build`.

---

## 3. Install Docker and Docker Compose

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

## 4. Clone the repo and set environment

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
| `BASE_URL` | Same as backend URL (e.g. `http://YOUR_EC2_IP:5000`). **Required for correct build URLs:** upload/release and live URLs use the host from this (or `BASE_DOMAIN` if set). |
| `NGINX_BASE_DOMAIN` | Your base domain (e.g. `yourdomain.com`) or leave `localhost` for IP-only access |
| `SSL_DOMAIN` | **(Optional)** Your domain for HTTPS (e.g. `launchpad.yorkdevs.link`). Requires Let's Encrypt certs on the host at `/etc/letsencrypt/live/<domain>/`. Nginx then serves `https://<domain>/` (frontend) and `https://<domain>/api/` (API). |
| `JWT_SECRET` | Long random secret (e.g. `openssl rand -base64 32`) |

**Do not** set `POSTGRES_*` or start the Docker `db` service in production; the database is Supabase only.

---

## 5. Build and start the stack

```bash
cd /home/ubuntu/launchpad

# Start backend + frontend (nginx is inside backend on port 80; DATABASE_URL points to Supabase)
docker compose up -d --build
```

This starts:

- **Backend** on port `5000`
- **Frontend** (Nginx serving built app) on port `3000`
- **Nginx** (project subdomains) on port `8888` (host; avoids port 80 and project port range 8001–8100)

No PostgreSQL runs on EC2; the backend uses Supabase via `DATABASE_URL`.

---

## 6. EC2 security group

Open these ports in the instance security group:

| Port | Service   | Inbound rule        |
|------|-----------|----------------------|
| 22   | SSH       | Your IP (or restrict as needed) |
| 443  | HTTPS     | 0.0.0.0/0 (when using `SSL_DOMAIN` and Let's Encrypt) |
| 8888 | Nginx     | 0.0.0.0/0 (or your LB/domain) |
| 3000 | Frontend  | 0.0.0.0/0 (or your LB/domain) |
| 5000 | Backend   | 0.0.0.0/0 (or your LB/domain) |

---

## 7. HTTPS with your domain (optional)

If you have a domain (e.g. `launchpad.yorkdevs.link`) and Let's Encrypt certs on the host:

1. **Get certs** (if needed) — e.g. `sudo certbot certonly --standalone -d launchpad.yorkdevs.link` (stop Docker first so port 80 is free), then start Docker again.
2. **In `.env`** set:
   - `SSL_DOMAIN=launchpad.yorkdevs.link`
   - `BASE_URL=https://launchpad.yorkdevs.link`
   - `VITE_API_URL=https://launchpad.yorkdevs.link`
   - `VITE_FRONTEND_URL=https://launchpad.yorkdevs.link`
3. **Rebuild frontend** so the browser uses HTTPS URLs: `docker compose build --no-cache frontend && docker compose up -d`.
4. **Open port 443** in the EC2 security group (see table above).
5. **Point DNS** for your domain to the EC2 public IP.

Nginx in the backend will serve `https://<SSL_DOMAIN>/` (frontend) and `https://<SSL_DOMAIN>/api/` (API) using the certs from `/etc/letsencrypt`.

**Release upload / 504:** Generated HTTPS nginx uses **7200s** `proxy_read_timeout` / `proxy_send_timeout` for `/api`. An extra reverse proxy in front must allow long reads too.

### HTTPS: backend vs frontend startup (UAT vs production)

Docker Compose starts **backend before frontend** (`frontend` has `depends_on: backend`). The generated HTTPS config proxies `/` to the hostname **`frontend`** inside the Compose network. Nginx resolves that name when it starts, so if nginx loaded **before** the frontend container existed, you could see:

`nginx: [emerg] host not found in upstream "frontend"`

**UAT** often still works because of timing (slower image pulls, manual restarts, or the frontend already running from a previous deploy). **Production EC2** cold starts are more likely to hit this race.

The backend **entrypoint** waits until `http://frontend:80` responds (up to 120s) before starting nginx whenever `ssl.conf` proxies to the frontend service—so a normal `docker compose up -d --build` should succeed without a manual `docker compose restart backend`.

If you run an **older image** without that wait and see the error above, run once after both containers are up:

```bash
docker compose restart backend
```

---

## 8. Verify

- **Frontend**: `http://YOUR_EC2_IP:3000` (or `https://YOUR_DOMAIN` when `SSL_DOMAIN` is set)
- **Backend API**: `http://YOUR_EC2_IP:5000` (or `https://YOUR_DOMAIN/api` when using HTTPS)
- **Nginx** (project subdomains): `http://YOUR_EC2_IP:8888`
- **Default login** (after first start): `admin@example.com` / `Admin@123` (change after first login)

---

## 9. Useful Docker commands

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
