#!/bin/sh
set -e

# Ensure instance root dirs exist (volumes may mount over them)
mkdir -p /app/projects /app/nginx-configs /app/uploads

# Nginx container includes /etc/nginx/sites-enabled/*.conf; empty dir breaks nginx.
# If no configs yet, write a placeholder so the shared volume has at least one .conf
if [ -z "$(ls -A /app/nginx-configs/*.conf 2>/dev/null)" ]; then
  echo '# Placeholder until first project is created; nginx include requires at least one .conf' > /app/nginx-configs/_placeholder.conf
  echo 'server { listen 127.0.0.1:65535; return 503; }' >> /app/nginx-configs/_placeholder.conf
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

# Run migrations and seed when DATABASE_URL is set
if [ -n "$DATABASE_URL" ]; then
  echo "Running database migrations..."
  npx prisma migrate deploy 2>/dev/null || npx prisma db push --accept-data-loss 2>/dev/null || true
  echo "Seeding default admin user (if none exists)..."
  npx prisma db seed 2>/dev/null || true
fi

# When nginx runs in Docker (NGINX_UPSTREAM_HOST=backend), rewrite existing configs so proxy_pass uses backend instead of localhost
if [ -n "$NGINX_UPSTREAM_HOST" ]; then
  for f in /app/nginx-configs/*.conf; do
    [ -f "$f" ] || continue
    if grep -q 'proxy_pass http://localhost:' "$f" 2>/dev/null; then
      sed -i "s|http://localhost:|http://${NGINX_UPSTREAM_HOST}:|g" "$f"
      echo "Updated $(basename "$f") to use upstream host $NGINX_UPSTREAM_HOST"
    fi
  done
fi

exec "$@"
