# Docker deployment

Run the full stack (backend, frontend, nginx) with Docker Compose.

- **Production**: Use **Supabase** for PostgreSQL. Set `DATABASE_URL` to your Supabase connection string and run `docker compose up -d --build` (no `db` container). See [EC2_DEPLOYMENT.md](./EC2_DEPLOYMENT.md).
- **Local dev**: Use the Docker `db` service (`docker compose --profile with-db up -d --build`) or your existing Postgres and `DATABASE_URL`.

---

## Which .env file is used? (Why there are 3)

| File | When it’s used | Why it exists |
|------|----------------|----------------|
| **Repo root `.env`** | **Only when you run Docker** (`docker compose up` from repo root). | Compose runs from the root; `env_file: - .env` is relative to the folder that contains `docker-compose.yml`. One file feeds **all** services (db, backend, frontend) so you don’t have to duplicate DB URL, JWT_SECRET, VITE_* etc. in each app folder. |
| **`backend/.env`** | **Only when you run the backend without Docker** (e.g. `cd backend && npm start`). | Node loads it via `dotenv.config()` from the backend directory. Used for local dev only. |
| **`frontend/.env`** (or `.env.local`) | **Only when you run the frontend without Docker** (e.g. `cd frontend && npm run dev`). | Vite reads it when building/serving. Used for local dev or a non-Docker frontend deploy. |

**Summary:**  
- **Docker** → **only** the **root** `.env` is used. Backend and frontend containers do **not** read `backend/.env` or `frontend/.env`; they get env from Compose (which reads root `.env` and the `environment:` blocks).  
- **No Docker (local dev)** → use **`backend/.env`** and **`frontend/.env`**; the root `.env` is ignored by the apps.

Copy **`/.env.example`** to **`/.env`** in the repo root for Docker. For non-Docker runs, create `backend/.env` and `frontend/.env` as needed (see DEVELOPER_GUIDE.md).

---

## How to tell: Docker vs normal (local) run

| | **Docker** (`docker compose up`) | **Normal** (run backend/frontend on your machine) |
|---|----------------------------------|---------------------------------------------------|
| **How you start** | `docker compose up -d` from **repo root** | e.g. `cd backend && npm start`, `cd frontend && npm run dev` |
| **Where config is read** | **Repo root** `.env` (same folder as `docker-compose.yml`) | **Backend:** `backend/.env` — **Frontend:** `frontend/.env` (or `.env.local`) |
| **Database** | **Production:** Supabase (set `DATABASE_URL` in root `.env`; no `db` container). **Local:** optional `db` container (`--profile with-db`) or existing Postgres. | Your **existing** Postgres (local or remote). Credentials in `backend/.env` as `DATABASE_URL`. |
| **Backend env** | Set in `docker-compose.yml` + repo root `.env` (e.g. `DATABASE_URL` from Supabase or `POSTGRES_*` for local Docker DB). | Read from `backend/.env` (e.g. `DATABASE_URL`, `PORT`, `JWT_SECRET`). |
| **Frontend env** | Baked at **build time** from repo root `.env`: `VITE_API_URL`, `VITE_FRONTEND_URL`. | Read from `frontend/.env`: `VITE_API_URL`, etc. |

**Summary:**  
- **Docker** → use **repo root** `.env`. Production: `DATABASE_URL` = Supabase (no `db` container). Local: optional `db` service (`--profile with-db`) or existing Postgres.  
- **Normal** → use **backend/.env** and **frontend/.env**; backend uses your existing DB and its own env.

---

## Use the same database as local (fix "invalid credentials")

To use your **existing** Postgres (same DB as when you run the app normally) so you don’t get "invalid credentials" and don’t need a new DB in Docker:

1. In repo root **.env**, set `DATABASE_URL` to your existing DB. You can use the same URL as local (`localhost` is auto-rewritten to `host.docker.internal` inside the container):
   ```env
   DATABASE_URL=postgresql://YOUR_USER:YOUR_PASSWORD@localhost:5432/YOUR_DB_NAME
   ```
   Or set it explicitly with `host.docker.internal` if you prefer.
2. Start only backend and frontend (no `db` container):
   ```bash
   docker compose up -d --build
   ```
   The `db` service is under profile `with-db`, so it won’t start unless you use that profile. Your backend will use the URL above.

3. Ensure Postgres on your machine accepts TCP connections (e.g. `listen_addresses = '*'` or `localhost`) and allows password auth from the Docker network if needed.

---

## Quick start

**Production (Supabase):** Set `DATABASE_URL` in root `.env` to your Supabase connection string, then run `docker compose up -d --build`. No `db` container. See [EC2_DEPLOYMENT.md](./EC2_DEPLOYMENT.md).

**Local (with Docker DB):**

1. **Create env file** (optional; defaults work for local):

   ```bash
   cp .env.example .env
   # Edit .env and set POSTGRES_PASSWORD, JWT_SECRET, VITE_API_URL if needed (or use Supabase for DATABASE_URL)
   ```

2. **Build and start** (this starts the `db` container too; for local dev only):

   ```bash
   docker compose --profile with-db up -d --build
   ```

   Or use Supabase/local Postgres and run without the profile: `docker compose up -d --build`.

3. **Open**:
   - Frontend: http://localhost:3000  
   - Backend API: http://localhost:5000  
   - **Nginx** (project subdomains): http://localhost:80 — each project is reachable at `http://<project-name>.localhost` (see below).

4. **First-time login** (after a fresh DB):  
   A default admin user is created by the seed. Use:
   - **Email:** `admin@example.com`
   - **Password:** `Admin@123`  
   Or use the Register page to create a new account. Change the default password after first login.

## Environment variables

| Variable | Used by | Description |
|----------|---------|-------------|
| `POSTGRES_USER` | db, backend | PostgreSQL user (default: postgres) |
| `POSTGRES_PASSWORD` | db, backend | PostgreSQL password (default: postgres) |
| `POSTGRES_DB` | db, backend | Database name (default: zipsync) |
| `VITE_API_URL` | frontend (build) | URL the **browser** uses to call the API (e.g. http://localhost:5000 or https://api.yourdomain.com) |
| `VITE_FRONTEND_URL` | frontend (build) | Frontend base URL (e.g. http://localhost:3000) |
| `JWT_SECRET` | backend | Secret for JWT (set in production) |
| `BASE_URL` | backend | Backend base URL for generated links |
| `NGINX_BASE_DOMAIN` | backend | Base domain for project subdomains (see INSTANCE_SETUP.md) |
| `NGINX_UPSTREAM_HOST` | (optional) | Only if you use a **separate** nginx container; otherwise nginx runs **inside** backend and proxies to `localhost:<port>`. |
| `PROJECT_PORT_END` | docker-compose | Last port in the published project port range (default 8100 → 8001–8100). Only needed for direct host access; nginx uses the Docker network. Increase if you have many projects (e.g. 8999). |

For production, set `VITE_API_URL` and `VITE_FRONTEND_URL` to your public URLs **before** building the frontend image (e.g. in `.env` when running `docker compose build`).

## Nginx only inside backend (no separate nginx service)

There is **no** standalone `nginx` service and **no** nginx in the **frontend** image. The **backend** image installs nginx and starts it in the entrypoint; it listens on **port 80** and includes **`/app/nginx-configs/*.conf`** (same volume the app writes when you create projects). Project static servers run in the same container on `127.0.0.1:<port>`, so `proxy_pass` stays `http://localhost:<port>`.

- **Port 80** → backend container (nginx for project subdomains).
- **Port 5000** → API.
- **Port 3000** → frontend static app (served with `serve`, not nginx).

Main nginx config is **`backend/nginx-docker.conf`** (copied into the image at `/etc/nginx/nginx.conf`). The repo `nginx/nginx.conf` is unused by the current compose file.

## Supabase + `FATAL: role "postgres" does not exist` (db-1 logs)

That message comes from the **local** Postgres container (`db-1`), **not** from Supabase. Supabase already has a `postgres` role; you don’t need to change anything in the Supabase dashboard for this.

**Why it happens:** The `postgres_data` volume was first created with a different `POSTGRES_USER` (e.g. `pmuser`). The official image only creates that user, so role `postgres` never exists in that volume. Anything connecting to the local container as `postgres` then logs `FATAL`.

**What to do:**

1. **Using Supabase only** – Don’t start the local `db` service. With the current compose file, run:
   ```bash
   docker compose up -d --build
   ```
   (`db` is behind profile `with-db`; backend uses your `DATABASE_URL` to Supabase.)

2. **If you still need the local DB container** – Either:
   - Recreate the volume so it initializes with `POSTGRES_USER=postgres`:
     ```bash
     docker compose --profile with-db down -v
     docker compose --profile with-db up -d --build
     ```
     (**`-v` deletes that Postgres data.**)
   - Or set `POSTGRES_USER` / healthcheck to match whatever user actually exists in the existing volume.

## Supabase: `Can't reach database server at db....supabase.co:5432`

Prisma/Node is failing to open a **TCP connection** to Supabase (timeout or connection refused). Nothing is wrong with Supabase itself until connectivity works.

### 1. **Require SSL in the URL** (most common fix)

Supabase expects TLS. Add **`?sslmode=require`** (or `?sslmode=no-verify` only for debugging):

```env
DATABASE_URL="postgresql://postgres.[ref]:YOUR_PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?sslmode=require"
```

Or for the **direct** host (`db.xxx.supabase.co:5432`):

```env
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@db.xxx.supabase.co:5432/postgres?sslmode=require"
```

Restart backend after changing `.env`:

```bash
docker compose up -d --force-recreate backend
```

### 2. **Use the pooler (port 6543)** for app servers

In the Supabase Dashboard → **Project Settings → Database**, copy the **URI** under **Connection pooling** (Transaction mode). It uses port **6543** and host like `aws-0-REGION.pooler.supabase.com`. Many Docker/host networks block or throttle long-lived connections on 5432; the pooler is intended for apps like this.

### 3. **`nc: bad address 'db....supabase.co'`** (DNS inside the container)

That means **name resolution failed**—the container never got an IP for the hostname. The host is fine; **Docker’s DNS** for that container is broken or empty.

**Fix (already in `docker-compose.yml`):** the **backend** service has:

```yaml
dns:
  - 8.8.8.8
  - 8.8.4.4
```

Recreate the backend so it picks this up:

```bash
docker compose up -d --force-recreate backend
```

**Verify DNS inside the container:**

```bash
docker compose exec backend getent hosts db.rszxokarhatrtnqpwxdn.supabase.co
# or
docker compose exec backend nslookup db.rszxokarhatrtnqpwxdn.supabase.co
```

If that returns an IP, `nc` and Prisma can proceed (then ensure `?sslmode=require` and pooler if needed).

**Host-level fix:** On Linux, check `/etc/resolv.conf` and Docker daemon DNS (`/etc/docker/daemon.json` → `"dns": ["8.8.8.8"]`), then `sudo systemctl restart docker`.

### 4. **Check TCP from inside the container** (after DNS works)

```bash
docker compose exec backend sh -c 'nc -zv db.rszxokarhatrtnqpwxdn.supabase.co 5432 || true'
docker compose exec backend sh -c 'wget -qO- --timeout=5 https://db.rszxokarhatrtnqpwxdn.supabase.co 2>&1 | head -1 || true'
```

If `nc` times out, outbound **5432** is blocked (firewall, security group, or provider). Allow outbound TCP 5432 or switch to pooler **6543**.

### 5. **Supabase project paused**

On the free tier, projects pause after inactivity. Open the Supabase dashboard and **resume** the project.

### 6. **Password / user**

Use the **database password** from Supabase (Settings → Database), not the anon key. For pooler URIs, the username is often `postgres.[project-ref]`.

---

**Quick checklist:** **DNS** (`dns: 8.8.8.8` + recreate backend) → `?sslmode=require` → **pooler 6543** → open outbound ports → resume project → correct password.

## Nginx and project ports (automatic with Docker)

When you run `docker compose up`, **nginx starts inside the backend container** and reads per-project configs from `/app/nginx-configs` (volume `backend_nginx_configs`). Configs use `proxy_pass http://localhost:<port>` because static servers run in the same container.

- **Port 80** is published; nginx listens there.
- **Project ports** are assigned **dynamically from the DB** (`Project.port`): each new project gets the next free port (8001, 8002, 8003, …). The backend publishes a configurable range (default 8001–8100); set `PROJECT_PORT_END` in `.env` to extend it. Nginx reaches backend via the Docker network, so any number of DB-assigned ports work.
- Each project gets a subdomain: `http://<project-name>.<NGINX_BASE_DOMAIN>`. With default `NGINX_BASE_DOMAIN=localhost`, use `http://my-project.localhost` (ensure `/etc/hosts` or DNS resolves that, or use a real domain in production).

Project apps must still be **run** (e.g. dev server or process) inside the backend container or elsewhere and listen on the assigned port; the platform only creates the folder and nginx config. Once a process listens on that port, nginx will proxy to it.

## Volumes

- `postgres_data` – database files (only when using `--profile with-db` for local dev; production uses Supabase)
- `./backend/projects` → `/app/projects` – **bind mount**: project folders (same as repo’s `backend/projects`, so dynamic port and API serve the same files)
- `backend_nginx_configs` → `/app/nginx-configs` in backend (nginx includes these files from the same container)
- `backend_uploads` – upload temp files

## Runtime directories (do not commit)

These paths are in **.gitignore** and must **not** be pushed. They are created at runtime and filled by the app:

| Directory | Created when | What goes in it |
|-----------|--------------|------------------|
| **`backend/projects/`** | Container start (`entrypoint.sh`: `mkdir -p /app/projects`) and when you create a project in the platform. | One folder per project (e.g. `my-project/`). When you **upload a release**, the built app (dist/build) is copied here. The live app and nginx serve from these folders. **Empty** after a fresh clone or image build. |
| **`backend/uploads/`** | Container start. | Temporary files from release uploads; cleared after processing. |
| **`backend/_preview/`** | When someone uses **Switch version** (preview). | One folder per project (`project_<id>/serve/`) with the built preview. **Removed after 1 hour** (periodic cleanup + on next switch). Preview cookie also expires in 1 hour. |
| **`backend/nginx-configs/`** | Container start; backend also writes per-project configs here. | Sample configs are in the image; the backend adds/updates configs when projects are created. |

**Summary:** You do **not** need to push `backend/projects`. After deploy, the directory exists (empty or via volume); creating projects and uploading releases from the platform fills it. Same idea as `node_modules` or the database—runtime data, not source code.

## Check database entries

**When using Supabase:** Use the Supabase Dashboard (SQL Editor, Table Editor) or any PostgreSQL client with your `DATABASE_URL` to inspect data.

**When using the Docker `db` service** (local dev with `--profile with-db`): the DB is exposed on **localhost:5432** (use the same `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` from your `.env`).

**1. Command line (psql inside container)**  
No port needed; run from repo root:

```bash
docker compose exec db psql -U postgres -d zipsync -c "SELECT id, name, email, role FROM \"User\";"
```

Interactive shell:

```bash
docker compose exec db psql -U postgres -d zipsync
```

Then run SQL, e.g. `SELECT * FROM "User";` and `\q` to quit.

**2. Prisma Studio (web UI)**  
From your machine (with Docker stack running), use the same DB URL as the backend:

```bash
cd backend
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/zipsync" npx prisma studio
```

Opens http://localhost:5555 — browse and edit tables.

**3. Any PostgreSQL client**  
Connect with:

- **Host:** localhost  
- **Port:** 5432  
- **User / Password / Database:** from `.env` (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`)

Examples: DBeaver, pgAdmin, TablePlus, DataGrip, etc.

## Commands

```bash
# Logs
docker compose logs -f backend
docker compose logs -f frontend

# Stop
docker compose down

# Stop and remove volumes (resets DB and projects)
docker compose down -v
```

## Checking project ports (nginx + dynamic ports)

Projects in `projects/` use **dynamic ports** (stored in DB, written into `nginx-configs/*.conf`). Nginx proxies each subdomain to `http://localhost:<port>`. Use the following to see which ports exist and whether they respond.

### 1. List ports from the database

From repo root (stack running):

```bash
docker compose exec db psql -U postgres -d zipsync -c 'SELECT id, name, port FROM "Project" ORDER BY port;'
```

### 2. List ports from nginx configs (inside backend container)

Configs are in the backend container at `/app/nginx-configs`:

```bash
docker compose exec backend sh -c 'for f in /app/nginx-configs/*.conf; do [ -f "$f" ] && echo "=== $f ===" && grep -E "proxy_pass|server_name" "$f"; done'
```

Or only extract port numbers:

```bash
docker compose exec backend sh -c 'grep -h proxy_pass /app/nginx-configs/*.conf 2>/dev/null | sed -n "s/.*localhost:\([0-9]*\).*/\1/p" | sort -n'
```

### 3. Check if a specific port is open (inside backend container)

From **inside** the backend container, `localhost:<port>` is where nginx (when running in the same network/container) would send traffic. To test if something is listening on a port:

```bash
# Replace 8001 with the project port you care about
docker compose exec backend wget -q -O- --timeout=2 http://localhost:8001/ || echo "Port 8001 not responding"
```

Or with `curl` (if available in the image):

```bash
docker compose exec backend curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 http://localhost:8001/
```

- **200/301/302** → port is working.
- **000** or timeout → nothing is listening on that port inside the container.

### 4. Check all project ports at once

Run from repo root (requires `backend` and `db` running):

```bash
# Get ports from DB and test each from inside the backend container
docker compose exec db psql -U postgres -d zipsync -t -c 'SELECT port FROM "Project" WHERE port IS NOT NULL ORDER BY port;' | while read port; do
  port=$(echo "$port" | tr -d ' ')
  [ -z "$port" ] && continue
  code=$(docker compose exec -T backend wget -q -O- --timeout=2 http://localhost:$port/ 2>/dev/null && echo "OK" || echo "FAIL")
  echo "Port $port: $code"
done
```

**Note:** If your **nginx runs on the host** (not in Docker) and proxies to `localhost:<port>`, those ports must be open on the **host**. Project ports are assigned from the DB (8001, 8002, …). With Docker Compose we publish a configurable range (8001–`PROJECT_PORT_END`, default 8100). So either:

- Run the project dev servers on the host and point nginx to host `localhost`, or  
- Run nginx inside Docker (as in this compose) so it uses the Docker network (`backend:<port>`), or  
- Publish a range from the backend container (we do: `8001-${PROJECT_PORT_END:-8100}`) and run project servers inside the container so host nginx can proxy to `localhost:8001`, etc.

## Images

- **backend**: Node 20 Alpine, Prisma, runs `src/server.js` after migrations.  
- **frontend**: Build with Vite, then Nginx serves the built app.  
- **db**: PostgreSQL 16 Alpine.
