# Frontend - build only; serve static files with Node (no Nginx in this image)
# Build context must be repo root (.)
FROM node:20-alpine AS build

WORKDIR /app


ARG VITE_API_URL=http://15.206.209.185:5000
ARG VITE_FRONTEND_URL=http://15.206.209.185:3000

ARG VITE_MODE=production
# Optional; empty = app uses config fallback for Google ARG VITE_GOOGLE_CLIENT_ID=
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_FRONTEND_URL=$VITE_FRONTEND_URL
ENV VITE_MODE=$VITE_MODE
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_IDARG VITE_GOOGLE_CLIENT_ID=

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
