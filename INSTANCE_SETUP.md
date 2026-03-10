# Instance root setup (frontend, backend, projects, nginx)

When you deploy this app on a single server (EC2 or VM), the **instance root** is the directory that contains the platform and all project assets. Nginx is used so every project inside the `projects` folder runs on a **dynamic port** and is reachable by **subdomain**.

## Instance root layout

At the instance root you should have:

```
<INSTANCE_ROOT>/
├── frontend/           # Platform frontend app
├── backend/            # Platform backend API
├── projects/           # One folder per project (created by the app; dynamic ports via nginx)
├── nginx-configs/      # Generated nginx configs per project (one per subdomain)
└── nginx/
    └── sites-enabled/  # Symlinks to nginx-configs (local dev); on Linux use /etc/nginx/sites-enabled
```

- **`projects/`** is required: the backend creates a subfolder per project here and serves built apps from it. This folder is shared by the instance (frontend and backend both assume it lives at instance root).
- **`nginx-configs/`** is populated by the backend when a project is created. Each file is a nginx `server` block for one project (subdomain → proxy to that project’s dynamic port).

## How it works

1. **Project creation**  
   When a project is created, the backend:
   - Assigns a **dynamic port** (e.g. 8001, 8002, …).
   - Creates `projects/<project-name>/`.
   - Writes `nginx-configs/<project-name>.conf` with a `server_name <project-name>.<BASE_DOMAIN>` and `proxy_pass http://localhost:<port>`.
   - On Linux, symlinks that config into `/etc/nginx/sites-enabled/` and reloads nginx.

2. **Subdomain access**  
   Each project is accessed via subdomain, e.g. `my-app.localhost` (dev) or `my-app.example.com` (production). The base domain is set with:

   - **`NGINX_BASE_DOMAIN`** or **`BASE_DOMAIN`** (e.g. `example.com`). If unset, it defaults to `localhost`.

3. **Nginx**  
   - **Linux:** System nginx should include configs from `/etc/nginx/sites-enabled/` (e.g. `include /etc/nginx/sites-enabled/*.conf;`). The backend writes per-project configs under `nginx-configs/` and symlinks them into `sites-enabled`.
   - **Local (e.g. Mac):** Backend uses `<INSTANCE_ROOT>/nginx/sites-enabled` and writes configs under `<INSTANCE_ROOT>/nginx-configs/`. Use a local nginx that includes that `sites-enabled` path if you want subdomain routing locally.

## Environment variables

Set these on the server (e.g. in backend `.env` or systemd):

| Variable          | Description |
|-------------------|-------------|
| `INSTANCE_ROOT`   | Absolute path to the instance root (e.g. `/home/ubuntu/launchpad`). Backend and nginx use this for `projects/` and `nginx-configs/`. If unset, the backend uses its current working directory. |
| `NGINX_BASE_DOMAIN` or `BASE_DOMAIN` | Base domain for subdomains (e.g. `example.com`). Default: `localhost`. |

## Checklist for a new instance

1. Clone or deploy the repo so the instance root has `frontend/`, `backend/`, and (after first run) `projects/` and `nginx-configs/`.
2. Set **`INSTANCE_ROOT`** to that root path when running the backend (e.g. in Docker env or `.env`). Production uses Docker; see EC2_DEPLOYMENT.md.
3. Set **`NGINX_BASE_DOMAIN`** (or `BASE_DOMAIN`) if you are not using `localhost`.
4. Install and configure nginx so it includes the dynamic project configs (e.g. `include /etc/nginx/sites-enabled/*.conf;` on Linux).
5. Run backend (and frontend) from the usual setup; the backend will create `projects/<name>` and `nginx-configs/<name>.conf` and, on Linux, symlink into `sites-enabled` and reload nginx so each project runs on its dynamic port and subdomain.
