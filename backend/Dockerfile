# Backend - Node.js API (Prisma + Express)
FROM node:20-alpine AS base

WORKDIR /app

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
COPY nginx-configs ./nginx-configs/
COPY nginx-frontend.conf ./

EXPOSE 5000

# INSTANCE_ROOT: set to /app so projects/ and nginx-configs/ live here (mount volumes in compose)
ENV NODE_ENV=production
ENV PORT=5000
ENV INSTANCE_ROOT=/app

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "src/server.js"]
