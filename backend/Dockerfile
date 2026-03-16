# Backend - Node.js API (Prisma + Express) + Nginx (same container; no separate nginx service)
FROM node:20-alpine AS base

WORKDIR /app

# Nginx for project subdomains on port 80; git for release upload (init, commit, push to GitHub)
RUN apk add --no-cache nginx git \
    && mkdir -p /var/log/nginx \
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
COPY ecosystem.config.cjs ./

# Entrypoint and nginx configs for deployment
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh
RUN mkdir -p ./nginx-configs
COPY nginx-frontend.conf ./

EXPOSE 5000

# INSTANCE_ROOT: set to /app so projects/ and nginx-configs/ live here (mount volumes in compose)
ENV NODE_ENV=production
ENV PORT=5000
ENV INSTANCE_ROOT=/app

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "src/server.js"]
