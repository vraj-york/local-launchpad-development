#!/bin/sh
set -e

# Ensure instance root dirs exist (volumes may mount over them)
mkdir -p /app/projects /app/nginx-configs /app/uploads

# Nginx runs inside this container; include /app/nginx-configs/*.conf requires at least one file
if [ -z "$(ls -A /app/nginx-configs/*.conf 2>/dev/null)" ]; then
  echo '# Placeholder until first project is created' > /app/nginx-configs/_placeholder.conf
  echo 'server { listen 127.0.0.1:65535; return 503; }' >> /app/nginx-configs/_placeholder.conf
fi

# HTTPS: generate ssl.conf when SSL_DOMAIN is set and certs exist (e.g. /etc/letsencrypt from host)
if [ -n "$SSL_DOMAIN" ] && [ -f "/etc/letsencrypt/live/${SSL_DOMAIN}/fullchain.pem" ]; then
  cat > /app/nginx-configs/ssl.conf << EOF
# Generated for SSL_DOMAIN=${SSL_DOMAIN} — / -> frontend, /api -> backend, /iframe-preview -> backend (same-origin for html2canvas)
server {
    listen 443 ssl;
    server_name ${SSL_DOMAIN};
    ssl_certificate /etc/letsencrypt/live/${SSL_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${SSL_DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    client_max_body_size 1024m;

    location /api/ {
        proxy_pass http://127.0.0.1:5000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_cache_bypass \$http_upgrade;
    }
    location /api {
        proxy_pass http://127.0.0.1:5000/api;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    location /iframe-preview/ {
        proxy_pass http://127.0.0.1:5000/iframe-preview/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    location /__iframe_backend {
        internal;
        rewrite ^/__iframe_backend(.*)\$ \$1 break;
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Referer \$http_referer;
    }
    location / {
        if (\$iframe_referer = 1) {
            rewrite ^ /__iframe_backend\$request_uri last;
        }
        proxy_pass http://frontend:80/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF
  echo "Generated /app/nginx-configs/ssl.conf for SSL_DOMAIN=${SSL_DOMAIN}"
else
  if [ -n "$SSL_DOMAIN" ]; then
    echo "[WARN] SSL_DOMAIN=${SSL_DOMAIN} set but cert not found at /etc/letsencrypt/live/${SSL_DOMAIN}/fullchain.pem — HTTPS disabled"
  fi
fi

# ssl.conf proxies / to Compose hostname "frontend". Backend starts before frontend (frontend depends_on
# backend); nginx resolves that name at startup, so without a wait you can get:
#   nginx: [emerg] host not found in upstream "frontend"
# UAT often avoids this by chance (slower starts / restarts); production EC2 commonly hits it on first boot.
if [ -f /app/nginx-configs/ssl.conf ] && grep -q 'proxy_pass http://frontend:80' /app/nginx-configs/ssl.conf 2>/dev/null; then
  echo "Waiting for Compose service 'frontend' (HTTPS reverse proxy to SPA)..."
  i=0
  ok=0
  while [ "$i" -lt 120 ]; do
    if wget -q -T 2 -O /dev/null http://frontend:80/ 2>/dev/null; then
      ok=1
      break
    fi
    i=$((i + 1))
    sleep 1
  done
  if [ "$ok" != 1 ]; then
    echo "[ERROR] http://frontend:80 not reachable after 120s. Is the frontend service up and on the same Docker Compose network?"
    exit 1
  fi
fi

# Start nginx (daemon mode) then Node; project configs proxy to 127.0.0.1:<port>
if command -v nginx >/dev/null 2>&1; then
  nginx
fi

# In Docker, localhost is the container. Use host.docker.internal to reach Postgres on the host.
if [ -n "$DATABASE_URL" ]; then
  case "$DATABASE_URL" in
    *@localhost:*|*@127.0.0.1:*)
      export DATABASE_URL="$(echo "$DATABASE_URL" | sed 's/@localhost:/@host.docker.internal:/g; s/@127\.0\.0\.1:/@host.docker.internal:/g')"
      echo "DATABASE_URL rewritten to use host.docker.internal for Docker"
      ;;
  esac
fi

# Migrations: run before Node starts so every `docker compose up` / deploy applies pending SQL.
# Fails fast on error (no db push fallback — that hid failures and could drift schema).
# Emergency only: set SKIP_PRISMA_MIGRATE=1 in Compose env to skip (not for production).
if [ -n "$DATABASE_URL" ]; then
  if [ "${SKIP_PRISMA_MIGRATE:-}" = "1" ] || [ "${SKIP_PRISMA_MIGRATE:-}" = "true" ]; then
    echo "[WARN] SKIP_PRISMA_MIGRATE is set — skipping prisma migrate deploy."
  else
    echo "Running database migrations (prisma migrate deploy)..."
    npx prisma migrate deploy
    echo "Database migrations completed."
  fi
  echo "Seeding default admin user (if none exists)..."
  npx prisma db seed 2>/dev/null || true
fi

# When nginx runs in same container as Node, keep proxy_pass http://localhost: (default).
# If NGINX_UPSTREAM_HOST is set (legacy separate nginx container), rewrite to that host.
if [ -n "$NGINX_UPSTREAM_HOST" ] && [ "$NGINX_UPSTREAM_HOST" != "localhost" ] && [ "$NGINX_UPSTREAM_HOST" != "127.0.0.1" ]; then
  for f in /app/nginx-configs/*.conf; do
    [ -f "$f" ] || continue
    if grep -q 'proxy_pass http://localhost:' "$f" 2>/dev/null; then
      sed -i "s|http://localhost:|http://${NGINX_UPSTREAM_HOST}:|g" "$f"
      echo "Updated $(basename "$f") to use upstream host $NGINX_UPSTREAM_HOST"
    fi
  done
fi

exec "$@"
