# Frontend - build only; serve static files with Node (no Nginx in this image)
# Build context must be repo root (.)
FROM node:20-alpine AS build

WORKDIR /app

ARG VITE_API_URL=http://127.0.0.1:5000
ARG VITE_FRONTEND_URL=http://127.0.0.1:3000
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_FRONTEND_URL=$VITE_FRONTEND_URL

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

COPY frontend/ .
RUN npm run build

# Serve dist on port 80 (no nginx)
FROM node:20-alpine
RUN npm install -g serve
COPY --from=build /app/dist /app/dist
WORKDIR /app
EXPOSE 80
CMD ["serve", "-s", "dist", "-l", "80"]
