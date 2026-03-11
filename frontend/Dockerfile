# Frontend - Build and serve with Nginx
# Build context must be repo root (.) so we can COPY backend/nginx-frontend.conf.
# Build stage: Vite app
FROM node:20-alpine AS build

WORKDIR /app

# Build-time API URL (used by Vite at build time for import.meta.env.VITE_API_URL)
ARG VITE_API_URL=http://localhost:5000
ARG VITE_FRONTEND_URL=http://localhost
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_FRONTEND_URL=$VITE_FRONTEND_URL

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

COPY frontend/ .
RUN npm run build

# Production stage: Nginx serves static files (config from backend only)
FROM nginx:alpine

RUN rm -f /etc/nginx/conf.d/default.conf
COPY backend/nginx-frontend.conf /etc/nginx/conf.d/default.conf

# Copy built assets from build stage
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
