# Backend - Node.js API (Prisma + Express) + Nginx (same container; no separate nginx service)
FROM node:20-alpine AS base

WORKDIR /app

# Nginx for project subdomains on port 80; git for release upload (init, commit, push to GitHub).
# /run: nginx pid file (see nginx-docker.conf pid directive); /var/log/nginx: error/access logs.
# ffmpeg: feedback recording merge worker (docker-compose service feedback-recording-worker)
RUN apk add --no-cache nginx git ffmpeg \
    && mkdir -p /var/log/nginx /run \
    && rm -f /etc/nginx/http.d/default.conf 2>/dev/null || true

COPY nginx-docker.conf /etc/nginx/nginx.conf

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Prisma generate (needs schema at build time)
COPY prisma ./prisma/
RUN npx prisma generate

# Application code
COPY src ./src/

# Entrypoint and nginx configs for deployment
COPY entrypoint.sh ./
COPY worker-docker-entrypoint.sh ./
RUN chmod +x entrypoint.sh worker-docker-entrypoint.sh
RUN mkdir -p ./nginx-configs
COPY nginx-frontend.conf ./

# Nginx listens on 80 in-container (Compose maps e.g. 8888:80). API on 5000.
EXPOSE 80
EXPOSE 5000

# INSTANCE_ROOT: set to /app so projects/ and nginx-configs/ live here (mount volumes in compose)
ENV NODE_ENV=production
ENV PORT=5000
ENV INSTANCE_ROOT=/app
# Same binary entrypoint uses for `nginx`; Node reload uses this path (Alpine package).
ENV NGINX_BIN=/usr/sbin/nginx

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "src/server.js"]
