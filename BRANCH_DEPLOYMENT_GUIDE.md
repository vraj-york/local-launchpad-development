# Branch-based deployment guide (UAT + Production)

This repository now supports branch-driven deployments:

- `development` -> UAT instance
- `main` -> Production instance

Both environments can use the same Docker Compose setup, but they must use different infrastructure values (`DATABASE_URL`, domains, secrets) in each server's repo root `.env`.

## 1) Prepare both servers

Run these once on each instance:

1. Install Docker + Docker Compose plugin.
2. Clone this repo to a fixed path (for example `/home/ubuntu/launchpad`).
3. Create `.env` in repo root:
   - UAT server: copy `.env.uat.example` -> `.env`
   - Prod server: copy `.env.prod.example` -> `.env`
4. Confirm `docker compose up -d --build` works manually once.

## 2) Configure GitHub Actions secrets

Set these repository secrets:

### UAT workflow secrets

- `UAT_HOST` - public IP or DNS of UAT instance
- `UAT_USER` - SSH user (for example `ubuntu`)
- `UAT_SSH_PRIVATE_KEY` - private key that can SSH to UAT
- `UAT_PORT` - optional SSH port (default `22`)
- `UAT_APP_PATH` - absolute path of repo on UAT server (for example `/home/ubuntu/launchpad`)

### Production workflow secrets

- `PROD_HOST` - public IP or DNS of production instance
- `PROD_USER` - SSH user
- `PROD_SSH_PRIVATE_KEY` - private key that can SSH to production
- `PROD_PORT` - optional SSH port (default `22`)
- `PROD_APP_PATH` - absolute path of repo on production server

## 3) Deployment behavior

Each workflow runs over SSH in this order:

1. **Preflight** – `UAT_APP_PATH` / `PROD_APP_PATH` is non-empty, directory exists, `docker` and `docker compose` are available.
2. **Deploy** – checkout branch, pull, `docker compose up -d --build`. The backend image entrypoint runs `prisma migrate deploy` before starting Node, so you do not need a separate `exec` migration step unless you intentionally skip migrations at boot (`SKIP_PRISMA_MIGRATE`).
3. **Verify** – `docker compose ps`, then up to 10 attempts (3s apart) to `GET http://127.0.0.1:5000/api/health` on the server. On failure, the last 100 lines of backend logs are printed and the job fails.

- On push to `development`, workflow **Deploy UAT** runs the steps above on the UAT host.
- On push to `main`, workflow **Deploy Production** runs the same on the production host.

**Note:** The deploy script uses `curl` on the target server for the health check. Ubuntu images usually include it; if yours is minimal, install `curl`.

## 4) Release flow

1. Merge feature branches into `development`.
2. Validate on UAT.
3. Merge `development` into `main`.
4. Production deploy runs automatically from `main`.

## 5) Important notes

- Keep UAT and production databases separate.
- Keep JWT/API/Cloud secrets separate between UAT and production.
- Frontend variables (`VITE_*`) are build-time values, so each deploy rebuilds frontend with that environment's `.env`.
