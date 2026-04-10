#!/bin/sh
set -e
cd /app

# Match backend entrypoint.sh: host Postgres on laptop + Docker uses localhost in .env
if [ -n "$DATABASE_URL" ]; then
  case "$DATABASE_URL" in
    *@localhost:*|*@127.0.0.1:*)
      export DATABASE_URL="$(echo "$DATABASE_URL" | sed 's/@localhost:/@host.docker.internal:/g; s/@127\.0\.0\.1:/@host.docker.internal:/g')"
      echo "[feedback-recording-worker] DATABASE_URL rewritten for Docker (host.docker.internal)"
      ;;
  esac
fi

exec "$@"
